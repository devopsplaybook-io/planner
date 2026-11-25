// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

import AuthorizeDeviceCard from "@devopsplaybook.io/common-web/components/AuthorizeDeviceCard.vue";
import type { LoginCodeService } from "@devopsplaybook.io/common-web/services/LoginCodeService";

const CAPABILITIES = {
  enabled: true,
  available: true,
  codeLength: 8,
  rotationSeconds: 30,
  graceSeconds: 60,
  ttlSeconds: 300,
  pollIntervalMs: 2000,
  approveRequiresPassword: false,
  serverTime: "2026-11-25T10:00:00.000Z",
};

const PREVIEW = {
  deviceLabel: "Chrome on macOS",
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36",
  createdAt: "2026-11-25T10:00:00.000Z",
  expiresAt: "2026-11-25T10:05:00.000Z",
  userName: "Ann",
  serverTime: "2026-11-25T10:00:00.000Z",
};

function makeService() {
  const service = {
    capabilities: vi.fn().mockResolvedValue(CAPABILITIES),
    preview: vi.fn().mockResolvedValue(PREVIEW),
    approve: vi.fn().mockResolvedValue({
      approved: true,
      expiresAt: PREVIEW.expiresAt,
      serverTime: PREVIEW.serverTime,
    }),
  };
  return service as unknown as LoginCodeService & typeof service;
}

function mountCard(service: LoginCodeService) {
  return mount(AuthorizeDeviceCard, { props: { service } });
}

async function enterCode(
  wrapper: ReturnType<typeof mountCard>,
  code = "bcdf-ghjk",
) {
  await wrapper.find("input.login-code-input-field").setValue(code);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthorizeDeviceCard (real common-web component)", () => {
  it("disables approval when the server reports the feature unavailable", async () => {
    const service = makeService();
    (service.capabilities as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...CAPABILITIES,
      available: false,
    });
    const wrapper = mountCard(service);
    await flushPromises();

    expect(wrapper.text()).toContain("Login with a code is unavailable");
    expect(
      wrapper.find("input.login-code-input-field").attributes("disabled"),
    ).toBeDefined();
  });

  it("previews and approves a normalized code", async () => {
    const service = makeService();
    const wrapper = mountCard(service);
    await flushPromises();

    await enterCode(wrapper);

    expect(service.preview).toHaveBeenCalledWith(
      "BCDFGHJK",
      expect.anything(),
    );
    expect(wrapper.text()).toContain("Ann");
    expect(wrapper.text()).toContain("Chrome on macOS");

    const approveButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Approve sign-in"));
    await approveButton!.trigger("click");
    await flushPromises();

    expect(service.approve).toHaveBeenCalledWith(
      { code: "BCDFGHJK", password: undefined },
      expect.anything(),
    );
    expect(wrapper.emitted("approved")).toHaveLength(1);
    expect(wrapper.text()).toContain("Sign-in approved");
  });

  it("requires the password when the server asks for step-up", async () => {
    const service = makeService();
    (service.capabilities as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...CAPABILITIES,
      approveRequiresPassword: true,
    });
    const wrapper = mountCard(service);
    await flushPromises();

    await enterCode(wrapper);
    const approveButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("Approve sign-in"));
    await approveButton!.trigger("click");
    await flushPromises();

    expect(service.approve).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Enter your password");

    const password = wrapper.find('input[type="password"]');
    await password.setValue("correct");
    await approveButton!.trigger("click");
    await flushPromises();

    expect(service.approve).toHaveBeenCalledWith(
      { code: "BCDFGHJK", password: "correct" },
      expect.anything(),
    );
  });
});
