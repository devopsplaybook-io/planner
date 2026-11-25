// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useAuthStore } from "../stores/auth";
import { createPlannerLoginCodeService } from "./loginCodes";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("./api", () => ({ default: api }));

const TIMEOUT = 10_000;

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.post.mockReset();
  setActivePinia(createPinia());
});

describe("Planner login-code service wiring", () => {
  it("calls the API under the app base URL without credentials for capabilities", async () => {
    api.get.mockResolvedValueOnce({
      data: {
        enabled: true,
        available: true,
        codeLength: 8,
        rotationSeconds: 30,
        graceSeconds: 60,
        ttlSeconds: 300,
        pollIntervalMs: 2000,
        approveRequiresPassword: false,
        serverTime: new Date().toISOString(),
      },
    });
    const service = createPlannerLoginCodeService();

    const capabilities = await service.capabilities();

    expect(capabilities.enabled).toBe(true);
    expect(api.get).toHaveBeenCalledWith(
      "users/login-codes/capabilities",
      expect.objectContaining({ timeout: TIMEOUT }),
    );
  });

  it("creates a request on the collection route", async () => {
    api.post.mockResolvedValueOnce({
      data: {
        requestToken: "request-token",
        code: "BCDFGHJK",
        codeExpiresAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
      },
    });
    const service = createPlannerLoginCodeService();

    const request = await service.create();

    expect(request.code).toBe("BCDFGHJK");
    expect(api.post).toHaveBeenCalledWith(
      "users/login-codes/",
      undefined,
      expect.objectContaining({ timeout: TIMEOUT }),
    );
  });

  it("sends the interactive token when previewing and approving", async () => {
    const store = useAuthStore();
    store.token = "jwt-token";
    api.post.mockResolvedValue({ data: { userName: "Ann" } });
    const service = createPlannerLoginCodeService();

    await service.preview("BCDFGHJK");
    expect(api.post).toHaveBeenLastCalledWith(
      "users/login-codes/preview",
      { code: "BCDFGHJK" },
      expect.objectContaining({
        headers: { Authorization: "Bearer jwt-token" },
      }),
    );

    await service.approve({ code: "BCDFGHJK" });
    expect(api.post).toHaveBeenLastCalledWith(
      "users/login-codes/approve",
      { code: "BCDFGHJK" },
      expect.objectContaining({
        headers: { Authorization: "Bearer jwt-token" },
      }),
    );
  });

  it("omits the authorization header without a local session", async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    const service = createPlannerLoginCodeService();

    await service.preview("BCDFGHJK");

    const config = api.post.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(config.headers).toBeUndefined();
  });

  it("installs the redeemed session in the auth store", async () => {
    const store = useAuthStore();
    const user = { id: "u1", name: "Ann", role: "user" };
    api.post.mockResolvedValueOnce({
      data: {
        status: "approved",
        token: "minted-token",
        user,
        expiresAt: new Date().toISOString(),
        serverTime: new Date().toISOString(),
      },
    });
    const service = createPlannerLoginCodeService();

    const result = await service.poll("request-token");

    expect(result.status).toBe("approved");
    expect(store.token).toBe("minted-token");
    expect(store.user).toEqual(user);
    expect(localStorage.getItem("token")).toBe("minted-token");
    expect(JSON.parse(localStorage.getItem("user") as string)).toEqual(user);
  });
});
