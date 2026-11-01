import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  SecurityHeadersBuildCsp,
  SecurityHeadersComputeScriptHashes,
  SecurityHeadersRegister,
} from "./SecurityHeaders";

const importMapBody = '{"imports":{"#app":"/_nuxt/app.js"}}';
const configBody = 'window.__NUXT__={data:{value:"x"}}';
const importMapHash = "sha256-sbCM7LmNg4fnPjrBbIdrO4SFsRF69RV8kAPgxNiD2mg=";
const configHash = "sha256-iPSBTeBcFN08PK/Pw3sM9DdLYn3PPBJedLPObw/DULw=";

const fixtureHtml = `<!doctype html>
<html>
  <head>
    <script type="importmap">${importMapBody}</script>
    <script>${configBody}</script>
    <script type="module" src="/_nuxt/entry.js"></script>
    <script type="application/json">{"payload":true}</script>
    <script></script>
  </head>
  <body></body>
</html>
`;

describe("SecurityHeadersComputeScriptHashes", () => {
  let dir: string;

  beforeAll(async () => {
    dir = path.join(os.tmpdir(), `planner-csp-${Date.now()}`);
    await fs.ensureDir(path.join(dir, "nested"));
    await fs.writeFile(path.join(dir, "index.html"), fixtureHtml);
    await fs.writeFile(
      path.join(dir, "nested", "page.html"),
      '<script>window.__NUXT__={data:{value:"x"}}</script>',
    );
  });

  afterAll(async () => {
    await fs.remove(dir);
  });

  it("should hash executable inline scripts and skip the rest", async () => {
    const hashes = await SecurityHeadersComputeScriptHashes(dir);
    expect(hashes).toEqual([
      `'${configHash}'`,
      `'${importMapHash}'`,
    ]);
  });

  it("should return no hashes when the directory is missing", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const hashes = await SecurityHeadersComputeScriptHashes(
      path.join(dir, "does-not-exist"),
    );
    expect(hashes).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("SecurityHeadersBuildCsp", () => {
  it("should pin the given hashes and close the usual vectors", () => {
    const csp = SecurityHeadersBuildCsp([`'${configHash}'`]);
    expect(csp).toContain(`script-src 'self' 'wasm-unsafe-eval' '${configHash}'`);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("should build a valid policy without hashes", () => {
    const csp = SecurityHeadersBuildCsp([]);
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(csp.trim().endsWith("frame-ancestors 'none'")).toBe(true);
  });
});

describe("SecurityHeadersRegister", () => {
  let app: FastifyInstance;
  let dir: string;

  beforeAll(async () => {
    dir = path.join(os.tmpdir(), `planner-csp-inject-${Date.now()}`);
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, "index.html"), fixtureHtml);

    app = Fastify();
    await SecurityHeadersRegister(app, dir);
    app.get("/", async (_req, reply) => {
      return reply.type("text/html").send(fixtureHtml);
    });
    app.get("/attachment", async (_req, reply) => {
      return reply
        .type("text/html")
        .header("Content-Security-Policy", "sandbox")
        .send("<html><body>attachment</body></html>");
    });
    app.get("/pdf", async (_req, reply) => {
      return reply
        .type("application/pdf")
        .header("X-Content-Type-Options", "nosniff")
        .send("pdf");
    });
    app.get("/json", async (_req) => {
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await fs.remove(dir);
  });

  it("should add the CSP and the security headers to HTML responses", async () => {
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toContain(`'${importMapHash}'`);
    expect(csp).toContain(`'${configHash}'`);
  });

  it("should never override an existing CSP (attachment sandbox)", async () => {
    const res = await app.inject({ method: "GET", url: "/attachment" });

    expect(res.headers["content-security-policy"]).toBe("sandbox");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("should keep a route's own nosniff header", async () => {
    const res = await app.inject({ method: "GET", url: "/pdf" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("should add no CSP to non-HTML responses", async () => {
    const pdf = await app.inject({ method: "GET", url: "/pdf" });
    expect(pdf.headers["content-security-policy"]).toBeUndefined();

    const json = await app.inject({ method: "GET", url: "/json" });
    expect(json.headers["content-security-policy"]).toBeUndefined();
    expect(json.headers["x-frame-options"]).toBe("DENY");
  });
});
