// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref, watch } from "vue";

import TaskCreateDialog from "./TaskCreateDialog.vue";

vi.mock("../utils/api", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

// The dialog relies on Nuxt auto-imports: bare identifiers resolve through
// globalThis at runtime, so stub them before mounting.
vi.stubGlobal("ref", ref);
vi.stubGlobal("watch", watch);
vi.stubGlobal("useModalDialog", () => ref(null));

const tasksStore = { create: vi.fn() };
const projectsStore = {
  selectedProjectFilter: "",
  activeProjects: [{ id: "project-1", archived: false }],
  defaultProject: { id: "project-1", archived: false },
};
const authStore = { currentUser: null };
const labelsStore = { labels: [], fetchAll: vi.fn().mockResolvedValue(undefined) };
vi.stubGlobal("useTasksStore", () => tasksStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useAuthStore", () => authStore);
vi.stubGlobal("useLabelsStore", () => labelsStore);

const NullStub = defineComponent({ render: () => null });
const stubs = {
  ProjectSelect: NullStub,
  UserMultiSelect: NullStub,
  LabelMultiSelect: NullStub,
};

function mountDialog() {
  return mount(TaskCreateDialog, {
    props: { open: false },
    global: { components: stubs },
  });
}

async function openDialog() {
  const wrapper = mountDialog();
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  tasksStore.create.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskCreateDialog design language", () => {
  it("should render the header actions and no footer button row", async () => {
    const wrapper = await openDialog();
    expect(wrapper.find(".dialog-header").exists()).toBe(true);
    expect(wrapper.find(".dialog-actions").exists()).toBe(true);
    expect(wrapper.find('button[aria-label="Create task"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('button[aria-label="Cancel"]').exists()).toBe(true);
    const close = wrapper.find('button[aria-label="Close"]');
    expect(close.exists()).toBe(true);
    expect(close.text()).toBe("×");
    expect(wrapper.find(".dialog-footer").exists()).toBe(false);
  });

  it("should emit created with the new id and close on success", async () => {
    tasksStore.create.mockResolvedValue({ id: "task-1" });
    const wrapper = await openDialog();
    await wrapper.find("input[type=text]").setValue("My task");
    await wrapper.find('button[aria-label="Create task"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("created")).toEqual([["task-1"]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("should show the inline error banner and never alert when create fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    tasksStore.create.mockRejectedValue({
      response: { data: { error: "boom" } },
    });
    const wrapper = await openDialog();
    await wrapper.find('button[aria-label="Create task"]').trigger("click");
    await flushPromises();
    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("boom");
    expect(alertSpy).not.toHaveBeenCalled();
    await wrapper.find(".dialog-error-dismiss").trigger("click");
    expect(wrapper.find(".dialog-error").exists()).toBe(false);
  });

  it("should clear a previous error when the dialog reopens", async () => {
    tasksStore.create.mockRejectedValue({ response: { data: { error: "x" } } });
    const wrapper = await openDialog();
    await wrapper.find('button[aria-label="Create task"]').trigger("click");
    await flushPromises();
    expect(wrapper.find(".dialog-error").exists()).toBe(true);
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(wrapper.find(".dialog-error").exists()).toBe(false);
  });
});
