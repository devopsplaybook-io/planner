// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

import LoginWithCodeCard from "@devopsplaybook.io/common-web/components/LoginWithCodeCard.vue";
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

function makeService() {
  const service = {
    capabilities: vi.fn().mockResolvedValue(CAPABILITIES),
  };
  return service as unknown as LoginCodeService & typeof service;
}

describe("LoginWithCodeCard (real common-web component)", () => {
  it("renders card chrome and an h2 title by default", async () => {
    const service = makeService();
    const wrapper = mount(LoginWithCodeCard, {
      props: { service, autoStart: false },
    });
    await flushPromises();

    expect(wrapper.classes()).toContain("login-with-code-card--card");
    const title = wrapper.find("h2.login-with-code-title");
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe("Sign in with a code");
    expect(title.attributes("id")).toBe(wrapper.attributes("aria-labelledby"));
  });

  it("drops the card chrome and keeps an h2 in plain variant", async () => {
    const service = makeService();
    const wrapper = mount(LoginWithCodeCard, {
      props: { service, autoStart: false, variant: "plain", headingLevel: 2 },
    });
    await flushPromises();

    expect(wrapper.classes()).toContain("login-with-code-card--plain");
    expect(wrapper.classes()).not.toContain("login-with-code-card--card");
    const title = wrapper.find("h2.login-with-code-title");
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe("Sign in with a code");
    expect(title.attributes("id")).toBe(wrapper.attributes("aria-labelledby"));
  });
});
