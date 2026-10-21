// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, onMounted, ref } from "vue";

import CalendarPage from "./calendar.vue";

// The page relies on Nuxt auto-imports: bare identifiers resolve through
// globalThis at runtime, so stub them before mounting.
vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("onMounted", onMounted);

const tasksStore = {
  tasks: [],
  fetchAll: vi.fn().mockResolvedValue(undefined),
};
const projectsStore = {
  selectedProjectFilter: "",
  fetchAll: vi.fn().mockResolvedValue(undefined),
  setProjectFilter: vi.fn(),
  subtreeProjectIds: vi.fn().mockReturnValue(undefined),
};
const statusesStore = {
  fetchAll: vi.fn().mockResolvedValue(undefined),
  colorFor: vi.fn().mockReturnValue("#3b82f6"),
};
const router = { replace: vi.fn() };
const route = { path: "/calendar", query: {} };
vi.stubGlobal("useTasksStore", () => tasksStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useStatusesStore", () => statusesStore);
vi.stubGlobal("useRouter", () => router);
vi.stubGlobal("useRoute", () => route);
vi.stubGlobal("useDialogCloseRefresh", () => {});
vi.stubGlobal("useRegularRefresh", () => {});

const NullStub = defineComponent({ render: () => null });
const stubs = {
  ProjectSelect: NullStub,
  TaskCreateDialog: NullStub,
};

async function mountCalendar() {
  const wrapper = mount(CalendarPage, { global: { components: stubs } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  // Only the Date is faked so flushPromises keeps working
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 11, 15, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Calendar month navigation", () => {
  it("should render accessible previous and next month controls", async () => {
    const wrapper = await mountCalendar();
    const buttons = wrapper.findAll(".month-nav button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.attributes("type")).toBe("button");
    }
    expect(buttons[0]!.attributes("aria-label")).toBe("Previous month");
    expect(buttons[1]!.attributes("aria-label")).toBe("Next month");
  });

  it("should navigate across months and year boundaries", async () => {
    const wrapper = await mountCalendar();
    expect(wrapper.find(".month-nav h2").text()).toBe("December 2026");
    const buttons = wrapper.findAll(".month-nav button");
    const prev = buttons[0]!;
    const next = buttons[1]!;
    await next.trigger("click");
    expect(wrapper.find(".month-nav h2").text()).toBe("January 2027");
    await prev.trigger("click");
    await prev.trigger("click");
    expect(wrapper.find(".month-nav h2").text()).toBe("November 2026");
  });
});
