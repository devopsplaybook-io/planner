// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { handleResponseError } from "./api";

describe("api response interceptor", () => {
  beforeEach(() => {
    localStorage.clear();
    // Stay on the login route so a 401 does not attempt a real navigation
    // (jsdom does not implement navigation)
    window.history.pushState({}, "", "/login");
  });

  it("clears the stored session on 401", async () => {
    localStorage.setItem("token", "jwt-token");
    localStorage.setItem("user", '{"id":"u1"}');
    const error = { response: { status: 401 } };
    await expect(handleResponseError(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("keeps the stored session on 403 (permission error, not a session end)", async () => {
    localStorage.setItem("token", "jwt-token");
    const error = { response: { status: 403 } };
    await expect(handleResponseError(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBe("jwt-token");
  });

  it("keeps the stored session on network errors", async () => {
    localStorage.setItem("token", "jwt-token");
    const error = new Error("Network Error");
    await expect(handleResponseError(error)).rejects.toBe(error);
    expect(localStorage.getItem("token")).toBe("jwt-token");
  });
});
