import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { FastifyInstance } from "fastify";

/**
 * Defense in depth for the static SPA: a Content-Security-Policy that allows
 * only the generated inline scripts (through build-time SHA-256 hashes) and
 * the same-origin assets, plus the usual anti-sniffing/framing headers.
 *
 * The policy is applied to text/html responses only and never replaces a
 * Content-Security-Policy already set by a route (the attachment routes set
 * sandbox / none deliberately).
 */

const EXECUTABLE_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
  // Import maps are subject to script-src in browsers and must be allowed
  "importmap",
]);

/** SHA-256 hashes of every executable inline <script> in the generated HTML. */
export async function SecurityHeadersComputeScriptHashes(
  webRoot: string,
): Promise<string[]> {
  let htmlFiles: string[];
  try {
    htmlFiles = await listHtmlFiles(webRoot);
  } catch {
    console.warn(
      `[SecurityHeaders] No web build found in ${webRoot}, serving without script hashes`,
    );
    return [];
  }

  const hashes = new Set<string>();
  for (const file of htmlFiles) {
    const html = await fs.readFile(file, "utf-8");
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptPattern.exec(html)) !== null) {
      const attributes = match[1];
      const body = match[2];
      if (/\bsrc\s*=/i.test(attributes)) {
        continue;
      }
      const typeMatch = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
        attributes,
      );
      const type = (
        typeMatch?.[1] ??
        typeMatch?.[2] ??
        typeMatch?.[3] ??
        ""
      ).toLowerCase();
      if (!EXECUTABLE_SCRIPT_TYPES.has(type)) {
        continue;
      }
      if (body.trim().length === 0) {
        continue;
      }
      hashes.add(
        `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
      );
    }
  }

  return [...hashes].sort();
}

export function SecurityHeadersBuildCsp(hashes: string[]): string {
  const scriptHashes = hashes.length > 0 ? ` ${hashes.join(" ")}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${scriptHashes}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function SecurityHeadersRegister(
  fastify: FastifyInstance,
  webRoot: string,
): Promise<void> {
  const csp = SecurityHeadersBuildCsp(
    await SecurityHeadersComputeScriptHashes(webRoot),
  );

  fastify.addHook("onSend", async (_request, reply, payload) => {
    if (!reply.hasHeader("x-content-type-options")) {
      reply.header("X-Content-Type-Options", "nosniff");
    }
    if (!reply.hasHeader("referrer-policy")) {
      reply.header("Referrer-Policy", "no-referrer");
    }
    if (!reply.hasHeader("x-frame-options")) {
      reply.header("X-Frame-Options", "DENY");
    }

    const contentType = String(
      reply.getHeader("content-type") ?? "",
    ).toLowerCase();
    if (
      contentType.startsWith("text/html") &&
      !reply.hasHeader("content-security-policy")
    ) {
      reply.header("Content-Security-Policy", csp);
    }
    return payload;
  });
}

async function listHtmlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listHtmlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}
