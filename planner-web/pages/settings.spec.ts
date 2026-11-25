// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, inject, onMounted, ref, watch } from "vue";

import SettingsPage from "./settings.vue";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const fakeService = vi.hoisted(() => ({ capabilities: vi.fn() }));

vi.mock("../utils/api", () => ({ default: api }));
vi.mock("../utils/loginCodes", () => ({
  createPlannerLoginCodeService: () => fakeService,
}));

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("onMounted", onMounted);
vi.stubGlobal("inject", inject);
vi.stubGlobal("watch", watch);

const authStore = {
  isAuthenticated: true,
  isAdmin: false,
  currentUser: { name: "Ann" },
  logout: vi.fn(),
};
const notificationsStore = {
  supported: false,
  loading: false,
  serverEnabled: false,
  active: false,
  digest: false,
  dictation: false,
  lastError: "",
  permission: "default",
  init: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  setDigest: vi.fn(),
  setDictation: vi.fn(),
};
const recommendationStore = {
  isDictationEnabled: false,
  dictationApplyActions: false,
  dictationLanguages: [],
  dictationTranslationLanguages: [],
  dictationAudioRetentionDays: 0,
  dictationAudioKeepMaxMb: 0,
  fetchConfig: vi.fn(),
};
const dictationStore = {
  keepAudio: false,
  language: "auto",
  targetLanguage: "",
  setLanguage: vi.fn(),
  setKeepAudio: vi.fn(),
  setTargetLanguage: vi.fn(),
  fetchPreferences: vi.fn().mockResolvedValue(undefined),
};
const projectsStore = { fetchAll: vi.fn().mockResolvedValue(undefined) };
const router = { replace: vi.fn(), push: vi.fn() };
const route = { path: "/settings", query: {} };
const theme = ref("light");

vi.stubGlobal("useAuthStore", () => authStore);
vi.stubGlobal("useNotificationsStore", () => notificationsStore);
vi.stubGlobal("useRecommendationStore", () => recommendationStore);
vi.stubGlobal("useDictationStore", () => dictationStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useRouter", () => router);
vi.stubGlobal("useRoute", () => route);

const AuthorizeDeviceCardStub = defineComponent({
  name: "AuthorizeDeviceCard",
  props: {
    service: { type: Object, default: null },
    variant: { type: String, default: "card" },
    headingLevel: { type: Number, default: 2 },
  },
  render() {
    return h("div", { class: "authorize-device-stub" });
  },
});

const NullStub = defineComponent({ render: () => null });

function mountSettings() {
  return mount(SettingsPage, {
    global: {
      provide: { theme, toggleTheme: vi.fn() },
      components: {
        AdminUsersTab: NullStub,
        AdminProjectsTab: NullStub,
        AdminStatusesTab: NullStub,
        AdminCleanupTab: NullStub,
      },
      stubs: { AuthorizeDeviceCard: AuthorizeDeviceCardStub },
    },
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  router.replace.mockReset();
  router.push.mockReset();
  authStore.isAuthenticated = true;
  api.get.mockResolvedValue({ data: null });
});

describe("settings - authorize a device", () => {
  it("renders the shared card with the app login-code service", async () => {
    const wrapper = mountSettings();
    await flushPromises();

    expect(wrapper.text()).toContain("Authorize a device");
    const card = wrapper.findComponent(AuthorizeDeviceCardStub);
    expect(card.exists()).toBe(true);
    expect(card.props("service")).toBe(fakeService);
  });

  it("embeds the card plainly under the section heading without nested chrome", async () => {
    const wrapper = mountSettings();
    await flushPromises();

    const card = wrapper.findComponent(AuthorizeDeviceCardStub);
    expect(card.props("variant")).toBe("plain");
    expect(card.props("headingLevel")).toBe(3);

    // The section's own <h2> is present and the hint paragraph is kept.
    expect(
      wrapper.findAll("h2").some((h) => h.text() === "Authorize a device"),
    ).toBe(true);
    expect(wrapper.text()).toContain(
      "Approve a sign-in started on another device by entering the code it shows.",
    );
  });

  it("places the section between Account and API Key", async () => {
    const wrapper = mountSettings();
    await flushPromises();

    const headings = wrapper
      .findAll("h2")
      .map((heading) => heading.text());
    expect(headings.indexOf("Authorize a device")).toBeGreaterThan(
      headings.indexOf("Account"),
    );
    expect(headings.indexOf("Authorize a device")).toBeLessThan(
      headings.indexOf("API Key"),
    );
  });
});
