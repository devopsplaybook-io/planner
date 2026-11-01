// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isTokenExpired } from "./jwt";

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("isTokenExpired", () => {
  it("treats an empty token as expired", () => {
    expect(isTokenExpired("")).toBe(true);
  });

  it("treats a malformed token as expired", () => {
    expect(isTokenExpired("not-a-jwt")).toBe(true);
  });

  it("treats a token without exp as expired", () => {
    expect(isTokenExpired(makeToken({ userId: "u1" }))).toBe(true);
  });

  it("detects an expired token", () => {
    const now = 1_800_000_000_000;
    const token = makeToken({ exp: now / 1000 - 60 });
    expect(isTokenExpired(token, now)).toBe(true);
  });

  it("treats the exact expiry instant as expired", () => {
    const now = 1_800_000_000_000;
    const token = makeToken({ exp: now / 1000 });
    expect(isTokenExpired(token, now)).toBe(true);
  });

  it("accepts a valid token", () => {
    const now = 1_800_000_000_000;
    const token = makeToken({ exp: now / 1000 + 60 });
    expect(isTokenExpired(token, now)).toBe(false);
  });
});
