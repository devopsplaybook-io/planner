// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import {
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  reactive,
  ref,
} from "vue";

import InboxPanel from "./InboxPanel.vue";

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("onMounted", onMounted);
vi.stubGlobal("onUnmounted", onUnmounted);

const navigateTo = vi.fn();
vi.stubGlobal("navigateTo", navigateTo);

let inboxStore: ReturnType<typeof makeInboxStore>;

function makeInboxStore() {
  return reactive({
    items: [] as Record<string, unknown>[],
    total: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: "",
    badge: { unread: 0, processing: 0 },
    fetchPage: vi.fn(async () => undefined),
    loadMore: vi.fn(async () => undefined),
    setFilter: vi.fn(async () => undefined),
    markSeen: vi.fn(),
    fetchBadge: vi.fn(async () => undefined),
  });
}

vi.stubGlobal("useInboxStore", () => inboxStore);

const InboxEntry = defineComponent({
  name: "InboxEntry",
  props: { item: { type: Object, required: true } },
  emits: ["convert"],
  template:
    '<button class="entry-stub" @click="$emit(\'convert\', item)">entry</button>',
});

const InboxConvertDialog = defineComponent({
  name: "InboxConvertDialog",
  props: { item: { type: Object, required: true } },
  emits: ["close", "converted"],
  template: '<div class="convert-stub" />',
});

function mountPanel() {
  return mount(InboxPanel, {
    global: {
      components: { InboxEntry, InboxConvertDialog },
    },
  });
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

beforeEach(() => {
  navigateTo.mockReset();
  inboxStore = makeInboxStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InboxPanel", () => {
  it("loads the inbox and clears the unread badge on mount", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    expect(inboxStore.fetchPage).toHaveBeenCalledWith(true);
    expect(inboxStore.markSeen).toHaveBeenCalled();
    expect(inboxStore.fetchBadge).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("lists entries and filters them through the store", async () => {
    inboxStore.items = [
      {
        id: "job-1",
        status: "done",
        source: "dictation",
        archivedAt: null,
        preview: "Hello",
      },
    ];
    inboxStore.total = 1;
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.findAll(".entry-stub")).toHaveLength(1);
    expect(wrapper.find(".list-meta").text()).toBe("1 of 1");

    await findButton(wrapper, "Ready")!.trigger("click");
    await flushPromises();

    expect(inboxStore.setFilter).toHaveBeenCalledWith({
      status: "done",
      source: null,
      includeArchived: false,
    });
    wrapper.unmount();
  });

  it("shows the empty state with a pointer to the other tabs", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find(".state").text()).toContain("Your inbox is empty");
    expect(wrapper.find(".state").text()).toContain("import a meeting");
    wrapper.unmount();
  });

  it("closes the menu and follows a converted item", async () => {
    inboxStore.items = [
      {
        id: "job-1",
        status: "done",
        source: "dictation",
        archivedAt: null,
        preview: "Hello",
      },
    ];
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find(".entry-stub").trigger("click");
    expect(wrapper.find(".convert-stub").exists()).toBe(true);

    wrapper.findComponent(InboxConvertDialog).vm.$emit("converted", {
      target: "task",
      targetId: "task-9",
    });
    await flushPromises();

    expect(wrapper.emitted("close")).toBeTruthy();
    expect(navigateTo).toHaveBeenCalledWith("/tasks?taskId=task-9");
    wrapper.unmount();
  });
});
