// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
} from "vue";

import Navigation from "./Navigation.vue";

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("onMounted", onMounted);
vi.stubGlobal("onUnmounted", onUnmounted);

const recommendationStore = reactive({
  isDictationEnabled: true,
  isDictationSttConfigured: true,
  dictationImportEnabled: true,
  dictationEngineState: "ready",
  fetchConfig: vi.fn(),
});
const inboxStore = reactive({
  badge: { unread: 0, processing: 0 },
  fetchBadge: vi.fn(async () => undefined),
});
const dictationStore = {
  openDialog: vi.fn(),
  fetchPreferences: vi.fn(async () => undefined),
};

vi.stubGlobal("useAuthStore", () => ({ isAuthenticated: true }));
vi.stubGlobal("useRecommendationStore", () => recommendationStore);
vi.stubGlobal("useDictationStore", () => dictationStore);
vi.stubGlobal("useInboxStore", () => inboxStore);
vi.stubGlobal("useCommandPaletteStore", () => ({ openPalette: vi.fn() }));
vi.stubGlobal("useRoute", () => ({ fullPath: "/" }));
vi.stubGlobal("useRegularRefresh", () => undefined);

const NuxtLink = {
  props: { to: { type: String, default: "/" } },
  template: '<a :href="to"><slot /></a>',
};

function mountNavigation() {
  return mount(Navigation, {
    global: { components: { NuxtLink } },
  });
}

describe("Navigation dictation badge", () => {
  beforeEach(() => {
    inboxStore.badge = { unread: 0, processing: 0 };
  });

  it("should pin the unread count to the dictation icon", () => {
    inboxStore.badge = { unread: 3, processing: 0 };

    const badge = mountNavigation().find(".dictation-icon .nav-badge");

    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("3");
  });

  it("should not render the count as a separate flex item of the button", () => {
    inboxStore.badge = { unread: 1, processing: 0 };

    const wrapper = mountNavigation();

    expect(wrapper.findAll(".dictation-button > .nav-badge")).toHaveLength(0);
  });

  it("should keep the count in the button label for screen readers", () => {
    inboxStore.badge = { unread: 2, processing: 0 };

    const wrapper = mountNavigation();

    expect(wrapper.find(".dictation-button").attributes("aria-label")).toBe(
      "Open the dictation menu (2 unread)",
    );
  });

  it("should show the processing count when nothing is unread", () => {
    inboxStore.badge = { unread: 0, processing: 4 };

    const wrapper = mountNavigation();
    const badge = wrapper.find(".dictation-icon .nav-badge");

    expect(badge.text()).toBe("4");
    expect(badge.classes()).toContain("nav-badge--processing");
    expect(wrapper.find(".dictation-button").attributes("aria-label")).toBe(
      "Open the dictation menu (4 processing)",
    );
  });

  it("should hide the badge when there is nothing to count", () => {
    const wrapper = mountNavigation();

    expect(wrapper.find(".nav-badge").exists()).toBe(false);
    expect(wrapper.find(".dictation-button").attributes("aria-label")).toBe(
      "Open the dictation menu",
    );
  });
});
