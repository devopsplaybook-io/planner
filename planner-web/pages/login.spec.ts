// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, onMounted, ref } from "vue";

import LoginPage from "./login.vue";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const fakeService = vi.hoisted(() => ({ capabilities: vi.fn() }));

vi.mock("../utils/api", () => ({ default: api }));
vi.mock("../utils/loginCodes", () => ({
  createPlannerLoginCodeService: () => fakeService,
}));

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("onMounted", onMounted);

const router = { push: vi.fn() };
vi.stubGlobal("useRouter", () => router);
vi.stubGlobal("useAuthStore", () => ({ isAuthenticated: false }));

const CodeCardStub = defineComponent({
  name: "LoginWithCodeCard",
  props: {
    service: { type: Object, default: null },
    variant: { type: String, default: "card" },
    headingLevel: { type: Number, default: 2 },
  },
  emits: ["approved", "cancel", "use-password"],
  render() {
    return h("div", { class: "code-card-stub" });
  },
});

function mountLogin() {
  return mount(LoginPage, {
    global: { stubs: { LoginWithCodeCard: CodeCardStub } },
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  fakeService.capabilities.mockReset();
  router.push.mockReset();
  api.get.mockResolvedValue({ data: { initialized: true } });
  fakeService.capabilities.mockResolvedValue({ enabled: true, available: true });
});

function codeToggle(wrapper: ReturnType<typeof mountLogin>) {
  return wrapper
    .findAll("button")
    .find((button) => button.text().includes("Use a code instead"));
}

describe("login page - login with a code", () => {
  it("never offers a code during first-time setup", async () => {
    api.get.mockResolvedValueOnce({ data: { initialized: false } });
    const wrapper = mountLogin();
    await flushPromises();

    expect(wrapper.text()).toContain("Create your admin account");
    expect(codeToggle(wrapper)).toBeUndefined();
    expect(fakeService.capabilities).not.toHaveBeenCalled();
  });

  it("offers the code flow when the server advertises it", async () => {
    const wrapper = mountLogin();
    await flushPromises();

    const toggle = codeToggle(wrapper);
    expect(toggle).toBeDefined();

    await toggle!.trigger("click");

    expect(wrapper.find(".code-card-stub").exists()).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
    const card = wrapper.findComponent(CodeCardStub);
    expect(card.props("service")).toBe(fakeService);
  });

  it("embeds the code card plainly inside the login card with a matching heading level", async () => {
    const wrapper = mountLogin();
    await flushPromises();
    await codeToggle(wrapper)!.trigger("click");

    const card = wrapper.findComponent(CodeCardStub);
    expect(card.props("variant")).toBe("plain");
    expect(card.props("headingLevel")).toBe(2);

    // Rendered inside Planner's own card chrome (article.login-card) whose
    // <h1> is "Planner" so the component's <h2> stays a section heading.
    expect(wrapper.find("article.login-card .code-card-stub").exists()).toBe(
      true,
    );
    expect(wrapper.find("article.login-card h1").text()).toBe("Planner");
  });

  it("hides the code option when the feature is unavailable", async () => {
    fakeService.capabilities.mockResolvedValueOnce({
      enabled: true,
      available: false,
    });
    const wrapper = mountLogin();
    await flushPromises();

    expect(codeToggle(wrapper)).toBeUndefined();
  });

  it("navigates to the dashboard after an approved code", async () => {
    const wrapper = mountLogin();
    await flushPromises();
    await codeToggle(wrapper)!.trigger("click");

    wrapper.findComponent(CodeCardStub).vm.$emit("approved", {
      token: "minted",
      user: { id: "u1" },
    });
    await flushPromises();

    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("returns to the password form when the user chooses it", async () => {
    const wrapper = mountLogin();
    await flushPromises();
    await codeToggle(wrapper)!.trigger("click");

    wrapper.findComponent(CodeCardStub).vm.$emit("use-password");
    await flushPromises();

    expect(wrapper.find("form").exists()).toBe(true);
    expect(wrapper.find(".code-card-stub").exists()).toBe(false);
  });
});
