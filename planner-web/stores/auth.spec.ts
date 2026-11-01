// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useAuthStore } from "./auth";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../utils/api", () => ({ default: api }));

function makeToken(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function validToken(): string {
  return makeToken({ exp: Math.floor(Date.now() / 1000) + 3600 });
}

function expiredToken(): string {
  return makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
}

beforeEach(() => {
  localStorage.clear();
  api.post.mockReset();
  setActivePinia(createPinia());
});

describe("auth store session handling", () => {
  it("reports an expired token as unauthenticated", () => {
    const store = useAuthStore();
    store.token = expiredToken();
    expect(store.isAuthenticated).toBe(false);
  });

  it("reports a valid token as authenticated", () => {
    const store = useAuthStore();
    store.token = validToken();
    expect(store.isAuthenticated).toBe(true);
  });

  it("logs out an expired local token without calling the server", async () => {
    localStorage.setItem("token", expiredToken());
    localStorage.setItem("user", JSON.stringify({ id: "u1" }));
    const store = useAuthStore();
    await store.init();
    expect(api.post).not.toHaveBeenCalled();
    expect(store.token).toBe("");
    expect(store.user).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
    expect(store.initialized).toBe(true);
  });

  it.each([400, 401, 403])(
    "logs out when the server rejects the session with %i",
    async (status) => {
      const token = validToken();
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify({ id: "u1" }));
      const store = useAuthStore();
      api.post.mockRejectedValueOnce({ response: { status } });
      await store.init();
      expect(store.token).toBe("");
      expect(store.user).toBeNull();
      expect(localStorage.getItem("token")).toBeNull();
      expect(store.initialized).toBe(true);
    },
  );

  it("keeps a locally valid session when the network fails", async () => {
    const token = validToken();
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify({ id: "u1", name: "Ann" }));
    const store = useAuthStore();
    api.post.mockRejectedValueOnce(new Error("offline"));
    await store.init();
    expect(store.token).toBe(token);
    expect(store.user).toEqual({ id: "u1", name: "Ann" });
    expect(localStorage.getItem("token")).toBe(token);
    expect(store.initialized).toBe(true);
  });

  it("stores the server user on a successful verification", async () => {
    localStorage.setItem("token", validToken());
    const store = useAuthStore();
    api.post.mockResolvedValueOnce({
      data: { user: { id: "u1", name: "Ann", role: "admin" } },
    });
    await store.init();
    expect(store.user).toEqual({ id: "u1", name: "Ann", role: "admin" });
    expect(JSON.parse(localStorage.getItem("user") as string)).toEqual({
      id: "u1",
      name: "Ann",
      role: "admin",
    });
    expect(store.initialized).toBe(true);
  });
});
