// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, onUnmounted, ref, watch } from "vue";

import DictationDialog from "./DictationDialog.vue";

vi.mock("../composables/useDictation", async () => {
  const { ref } = await import("vue");
  return {
    useDictation: () => ({
      isRecording: ref(false),
      elapsedSeconds: ref(0),
      level: ref(0),
      error: ref(""),
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
    }),
  };
});

vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("watch", watch);
vi.stubGlobal("onUnmounted", onUnmounted);
vi.stubGlobal("useModalDialog", () => ref(null));

const dictationStore = {
  status: "done",
  stage: "actions",
  isProcessing: false,
  result: {
    polishedText: "Hello",
    polished: true,
    rawTranscript: "hello",
    actions: [{ type: "create_task", title: "Do it", description: "" }],
  },
  submitAudio: vi.fn(),
  poll: vi.fn(),
  reset: vi.fn(),
};
const projectsStore = {
  defaultProject: { id: "p1", archived: false },
  activeProjects: [{ id: "p1", archived: false }],
  projects: [{ id: "p1", statuses: ["To Do", "Done"] }],
  fetchAll: vi.fn().mockResolvedValue(undefined),
};
const tasksStore = { create: vi.fn() };
const notesStore = { create: vi.fn() };
const statusesStore = {
  catalog: [],
  fetchAll: vi.fn().mockResolvedValue(undefined),
  colorFor: vi.fn().mockReturnValue("#000000"),
};

vi.stubGlobal("useDictationStore", () => dictationStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useTasksStore", () => tasksStore);
vi.stubGlobal("useNotesStore", () => notesStore);
vi.stubGlobal("useStatusesStore", () => statusesStore);

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

async function openDialog() {
  const wrapper = mount(DictationDialog, {
    props: { open: false },
    global: {
      components: { ProjectSelect: defineComponent({ render: () => null }) },
    },
  });
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  tasksStore.create.mockReset();
  notesStore.create.mockReset();
  dictationStore.reset.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DictationDialog review errors", () => {
  it("shows the dismissible banner and never alerts when creating items fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    tasksStore.create.mockRejectedValueOnce({
      response: { data: { error: "create boom" } },
    });
    const wrapper = await openDialog();

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("create boom");
    expect(alertSpy).not.toHaveBeenCalled();

    await wrapper.find(".dialog-error-dismiss").trigger("click");
    expect(wrapper.find(".dialog-error").exists()).toBe(false);
  });

  it("shows the dismissible banner and never alerts when saving as a note fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    notesStore.create.mockRejectedValueOnce({
      response: { data: { error: "note boom" } },
    });
    const wrapper = await openDialog();

    await findButton(wrapper, "Save as note")?.trigger("click");
    await flushPromises();

    const banner = wrapper.find(".dialog-error");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("note boom");
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
