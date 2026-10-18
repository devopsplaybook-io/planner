// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";

import TaskTemplateDialog from "./TaskTemplateDialog.vue";

vi.mock("../utils/api", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock("../composables/useMarkdown", () => ({
  renderMarkdown: vi.fn((text: string) => text || ""),
}));

// The dialog relies on Nuxt auto-imports: bare identifiers resolve through
// globalThis at runtime, so stub them before mounting.
vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("watch", watch);
vi.stubGlobal("nextTick", nextTick);
vi.stubGlobal("onBeforeUnmount", onBeforeUnmount);
vi.stubGlobal("useModalDialog", () => ref(null));
vi.stubGlobal("useOverflowCollapse", () => ({
  expanded: ref(false),
  overflowing: ref(false),
  setContentEl: () => {},
  toggle: () => {},
  reset: () => {},
}));
vi.stubGlobal("useSectionState", () => ({
  isSectionOpen: () => false,
  onSectionToggle: () => {},
}));

const taskTemplatesStore = {
  create: vi.fn(),
  update: vi.fn(),
  fetchById: vi.fn(),
};
const projectsStore = {
  projects: [] as Record<string, unknown>[],
  activeProjects: [] as Record<string, unknown>[],
  selectedProjectFilter: "",
};
const authStore = { currentUser: null, isAdmin: false };
vi.stubGlobal("useTaskTemplatesStore", () => taskTemplatesStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useAuthStore", () => authStore);

const NullStub = defineComponent({ render: () => null });
const ProjectSelectStub = defineComponent({
  name: "ProjectSelect",
  props: { modelValue: { type: String, default: "" } },
  render: () => null,
});
const stubs = {
  ProjectSelect: ProjectSelectStub,
  UserMultiSelect: NullStub,
  CommentComposer: NullStub,
  AttachmentFullscreenViewer: NullStub,
};

const project1 = {
  id: "project-1",
  name: "Home/Chores",
  archived: false,
  visibility: "public",
  statuses: ["Doing", "Review", "Done"],
};
const project2 = {
  id: "project-2",
  name: "Work/Reports",
  archived: false,
  visibility: "public",
  statuses: ["To Do"],
};
const project3 = {
  id: "project-3",
  name: "Home/Extras",
  archived: false,
  visibility: "public",
  statuses: ["Doing"],
};

function mountDialog() {
  return mount(TaskTemplateDialog, {
    props: { open: false },
    global: { components: stubs },
  });
}

async function openCreateDialog() {
  const wrapper = mountDialog();
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  taskTemplatesStore.create.mockReset();
  taskTemplatesStore.update.mockReset();
  taskTemplatesStore.fetchById.mockReset();
  projectsStore.projects = [project1, project2, project3];
  projectsStore.activeProjects = [project1, project2, project3];
  projectsStore.selectedProjectFilter = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskTemplateDialog initial status", () => {
  it("should reset the initial status when the project changes to one without it", async () => {
    taskTemplatesStore.create.mockResolvedValue({ id: "template-1" });
    const wrapper = await openCreateDialog();
    const statusSelect = wrapper.find(".automation-row select");
    await statusSelect.setValue("Doing");
    expect((statusSelect.element as HTMLSelectElement).value).toBe("Doing");

    wrapper
      .findComponent(ProjectSelectStub)
      .vm.$emit("update:modelValue", "project-2");
    await flushPromises();
    expect(
      (wrapper.find(".automation-row select").element as HTMLSelectElement)
        .value,
    ).toBe("");

    await wrapper.find('input[placeholder="Template title"]').setValue("T");
    await wrapper.find('button[aria-label="Create template"]').trigger("click");
    await flushPromises();
    const payload = taskTemplatesStore.create.mock.calls[0]![0];
    expect(payload.projectId).toBe("project-2");
    expect(payload.automation.instanceStatus).toBeNull();
  });

  it("should keep the initial status when the new project has it", async () => {
    taskTemplatesStore.create.mockResolvedValue({ id: "template-1" });
    const wrapper = await openCreateDialog();
    await wrapper.find(".automation-row select").setValue("Doing");

    wrapper
      .findComponent(ProjectSelectStub)
      .vm.$emit("update:modelValue", "project-3");
    await flushPromises();
    expect(
      (wrapper.find(".automation-row select").element as HTMLSelectElement)
        .value,
    ).toBe("Doing");

    await wrapper.find('input[placeholder="Template title"]').setValue("T");
    await wrapper.find('button[aria-label="Create template"]').trigger("click");
    await flushPromises();
    const payload = taskTemplatesStore.create.mock.calls[0]![0];
    expect(payload.projectId).toBe("project-3");
    expect(payload.automation.instanceStatus).toBe("Doing");
  });
});
