// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authStore = {
  initialized: false,
  isAuthenticated: false,
  token: "",
  init: vi.fn(),
  logout: vi.fn(),
};
const navigateTo = vi.fn((path: string) => ({ path }));

vi.stubGlobal("defineNuxtRouteMiddleware", (fn: unknown) => fn);
vi.stubGlobal("useAuthStore", () => authStore);
vi.stubGlobal("navigateTo", navigateTo);

type Middleware = (to: { path: string }) => unknown | Promise<unknown>;

let middleware: Middleware;

beforeAll(async () => {
  const module = await import("./auth.global");
  middleware = module.default as unknown as Middleware;
});

beforeEach(() => {
  authStore.initialized = false;
  authStore.isAuthenticated = false;
  authStore.token = "";
  authStore.init.mockReset();
  authStore.init.mockImplementation(async () => {
    authStore.initialized = true;
  });
  authStore.logout.mockReset();
  navigateTo.mockClear();
});

describe("auth global middleware", () => {
  it("initializes the session once across route changes", async () => {
    authStore.init.mockImplementation(async () => {
      authStore.initialized = true;
      authStore.isAuthenticated = true;
    });
    await middleware({ path: "/tasks" });
    await middleware({ path: "/notes" });
    expect(authStore.init).toHaveBeenCalledTimes(1);
  });

  it("redirects an unauthenticated user to the login page", async () => {
    await middleware({ path: "/tasks" });
    expect(navigateTo).toHaveBeenCalledWith("/login");
  });

  it("lets an unauthenticated user open the login page", async () => {
    const result = await middleware({ path: "/login" });
    expect(result).toBeUndefined();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("redirects an authenticated user away from the login page", async () => {
    authStore.init.mockImplementation(async () => {
      authStore.initialized = true;
      authStore.isAuthenticated = true;
    });
    await middleware({ path: "/login" });
    expect(navigateTo).toHaveBeenCalledWith("/");
  });

  it("lets an authenticated user open an authenticated page", async () => {
    authStore.init.mockImplementation(async () => {
      authStore.initialized = true;
      authStore.isAuthenticated = true;
    });
    const result = await middleware({ path: "/tasks" });
    expect(result).toBeUndefined();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("clears a still-stored token when the session is not authenticated", async () => {
    authStore.token = "expired-token";
    await middleware({ path: "/tasks" });
    expect(authStore.logout).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith("/login");
  });
});
