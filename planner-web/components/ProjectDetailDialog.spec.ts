// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, nextTick, ref, watch } from "vue";

import ProjectDetailDialog from "./ProjectDetailDialog.vue";
import api from "../utils/api";

vi.mock("../utils/api", () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock("../composables/useMarkdown", () => ({
  renderMarkdown: vi.fn((text: string) => text || ""),
}));

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("watch", watch);
vi.stubGlobal("nextTick", nextTick);
vi.stubGlobal("useModalDialog", () => ref(null));
vi.stubGlobal("useOverflowCollapse", () => ({
  expanded: ref(false),
  overflowing: ref(false),
  setContentEl: () => {},
  toggle: () => {},
  reset: () => {},
}));

const project = {
  id: "p1",
  name: "Home/Chores",
  description: "",
  archived: false,
  visibility: "public",
  statuses: ["To Do", "Done"],
  userAccess: [],
  isDefault: false,
};
const child = {
  id: "p2",
  name: "Home/Chores/Kid",
  archived: false,
};

const projectsStore = {
  currentProject: project,
  descendantsOf: vi.fn(),
  isNameTaken: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  fetchById: vi.fn(),
};
const statusesStore = {
  catalogNames: ["To Do", "In Progress", "Done"],
  fetchAll: vi.fn(),
};
const authStore = { isAdmin: true, currentUser: { id: "admin-1" } };

vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useStatusesStore", () => statusesStore);
vi.stubGlobal("useAuthStore", () => authStore);

const ProjectSelectStub = defineComponent({
  name: "ProjectSelect",
  props: {
    modelValue: { type: String, default: "" },
    excludeId: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  template: `<button type="button" class="project-select-stub" @click="$emit('update:modelValue', 'p9')">pick</button>`,
});

const stubs = {
  UserMultiSelect: defineComponent({ render: () => null }),
  ProjectSelect: ProjectSelectStub,
};

async function mountDialog() {
  const wrapper = mount(ProjectDetailDialog, {
    props: { projectId: "p1" },
    global: { components: stubs },
  });
  await flushPromises();
  return wrapper;
}

function deleteDialog(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll(".inner-dialog")
    .find((dialog) => dialog.text().includes("Delete Project"));
}

async function clickDelete(wrapper: ReturnType<typeof mount>) {
  await wrapper.find(".danger-item").trigger("click");
  const button = deleteDialog(wrapper)
    ?.findAll("button")
    .find((candidate) => candidate.text() === "Delete");
  await button?.trigger("click");
  await flushPromises();
}

beforeEach(() => {
  projectsStore.currentProject = project;
  projectsStore.descendantsOf.mockReset().mockReturnValue([child]);
  projectsStore.isNameTaken.mockReset().mockReturnValue(false);
  projectsStore.update.mockReset().mockResolvedValue(undefined);
  projectsStore.remove.mockReset().mockResolvedValue(undefined);
  projectsStore.fetchById.mockReset().mockResolvedValue(project);
  statusesStore.fetchAll.mockReset().mockResolvedValue(undefined);
  (api.get as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
    data: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProjectDetailDialog custom confirms and banners", () => {
  it("confirms a cascade rename through the inner dialog, not window.confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const wrapper = await mountDialog();

    await wrapper.find('button[aria-label="Edit"]').trigger("click");
    await wrapper
      .find(".edit-section input[type=text]")
      .setValue("Home/New");
    await wrapper.find('button[aria-label="Save"]').trigger("click");
    await flushPromises();

    const confirmation = wrapper.find(".confirm-dialog");
    expect(confirmation.exists()).toBe(true);
    expect(confirmation.text()).toContain("Rewrite the names");
    expect(projectsStore.update).not.toHaveBeenCalled();

    const rename = confirmation
      .findAll("button")
      .find((button) => button.text() === "Rename");
    await rename?.trigger("click");
    await flushPromises();

    expect(projectsStore.update).toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows the inline banner and never alerts when deleting with sub-projects", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    projectsStore.descendantsOf.mockReturnValue([child]);
    const wrapper = await mountDialog();

    await clickDelete(wrapper);

    const banner = deleteDialog(wrapper)?.find(".dialog-error");
    expect(banner?.exists()).toBe(true);
    expect(banner?.text()).toContain("Delete or move the sub-projects first");
    expect(projectsStore.remove).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows the inline banner and never alerts when the delete API fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    projectsStore.descendantsOf.mockReturnValue([]);
    projectsStore.remove.mockRejectedValueOnce({
      response: { data: { error: "cannot delete" } },
    });
    const wrapper = await mountDialog();

    await clickDelete(wrapper);

    const banner = deleteDialog(wrapper)?.find(".dialog-error");
    expect(banner?.exists()).toBe(true);
    expect(banner?.text()).toContain("cannot delete");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("surfaces partial cascade failures in the dialog banner instead of alerting", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    projectsStore.isNameTaken.mockReturnValue(false);
    projectsStore.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({
        response: { data: { error: "rename failed" } },
      });
    const wrapper = await mountDialog();

    await wrapper.find('button[aria-label="Edit"]').trigger("click");
    await wrapper
      .find(".edit-section input[type=text]")
      .setValue("Home/New");
    await wrapper.find('button[aria-label="Save"]').trigger("click");
    await flushPromises();

    const rename = wrapper
      .find(".confirm-dialog")
      .findAll("button")
      .find((button) => button.text() === "Rename");
    await rename?.trigger("click");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("0 of 1 sub-project updates succeeded");
    expect(banner.text()).toContain("rename failed");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("moves the project's tasks to the chosen destination project", async () => {
    projectsStore.descendantsOf.mockReturnValue([]);
    (api.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => ({
        data: url === "/tasks" ? [{ id: "t1" }, { id: "t2" }] : [],
      }),
    );
    const wrapper = await mountDialog();

    await wrapper.find(".danger-item").trigger("click");
    await flushPromises();

    const dialog = deleteDialog(wrapper);
    expect(dialog?.text()).toContain("It contains 2 tasks.");

    const moveRadio = dialog
      ?.findAll(".delete-mode-option input")
      .find((input) => input.attributes("value") === "move");
    await moveRadio?.setValue(true);
    await dialog?.find(".project-select-stub").trigger("click");

    const deleteButton = dialog
      ?.findAll("button")
      .find((button) => button.text() === "Delete");
    await deleteButton?.trigger("click");
    await flushPromises();

    expect(projectsStore.remove).toHaveBeenCalledWith("p1", "p9");
  });

  it("requires a destination project when moving tasks", async () => {
    projectsStore.descendantsOf.mockReturnValue([]);
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: "t1" }],
    });
    const wrapper = await mountDialog();

    await wrapper.find(".danger-item").trigger("click");
    await flushPromises();

    const dialog = deleteDialog(wrapper);
    const moveRadio = dialog
      ?.findAll(".delete-mode-option input")
      .find((input) => input.attributes("value") === "move");
    await moveRadio?.setValue(true);
    const deleteButton = dialog
      ?.findAll("button")
      .find((button) => button.text() === "Delete");
    await deleteButton?.trigger("click");
    await flushPromises();

    expect(dialog?.text()).toContain(
      "Select the destination project for the tasks.",
    );
    expect(projectsStore.remove).not.toHaveBeenCalled();
  });

  it("deletes the tasks by default", async () => {
    projectsStore.descendantsOf.mockReturnValue([]);
    (api.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string) => ({
        data: url === "/tasks" ? [{ id: "t1" }] : [],
      }),
    );
    const wrapper = await mountDialog();

    await clickDelete(wrapper);

    expect(projectsStore.remove).toHaveBeenCalledWith("p1", undefined);
  });
});
