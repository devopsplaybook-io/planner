// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import api from "../utils/api";
import TaskDetailDialog from "./TaskDetailDialog.vue";

vi.mock("../utils/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>;

// Nuxt auto-imports InlineDictationButton; its own spec covers the control
const InlineDictationButtonStub = defineComponent({
  name: "InlineDictationButton",
  props: {
    target: { type: [Object, Function], default: null },
    ariaLabel: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    showButton: { type: Boolean, default: true },
    projectId: { type: String, default: null },
  },
  render: () => null,
});

// The dialog relies on Nuxt auto-imports: bare identifiers resolve through
// globalThis at runtime, so stub them again before each mount.
function installAutoImportStubs() {
  vi.stubGlobal("ref", ref);
  vi.stubGlobal("computed", computed);
  vi.stubGlobal("watch", watch);
  vi.stubGlobal("nextTick", nextTick);
  vi.stubGlobal("onMounted", onMounted);
  vi.stubGlobal("onUnmounted", onUnmounted);
  vi.stubGlobal("onBeforeUnmount", onBeforeUnmount);
  vi.stubGlobal("useModalDialog", () => ref(null));
  vi.stubGlobal("useRoute", () => ({ fullPath: "/", path: "/", query: {} }));
  vi.stubGlobal("useRouter", () => ({ replace: vi.fn(), push: vi.fn() }));
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
    forceSectionOpen: () => {},
    reset: () => {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("useTasksStore", () => tasksStore);
  vi.stubGlobal(
    "useProjectsStore",
    () =>
      reactive({
        projects: [],
        defaultProject: { id: "p1", archived: false },
        activeProjects: [{ id: "p1", archived: false }],
        fetchAll: vi.fn().mockResolvedValue(undefined),
      }),
  );
  vi.stubGlobal(
    "useStatusesStore",
    () =>
      reactive({
        catalog: [],
        fetchAll: vi.fn().mockResolvedValue(undefined),
        colorFor: vi.fn().mockReturnValue("#000000"),
      }),
  );
  vi.stubGlobal(
    "useLabelsStore",
    () => reactive({ labels: [], fetchAll: vi.fn().mockResolvedValue([]) }),
  );
  vi.stubGlobal(
    "useAuthStore",
    () =>
      reactive({
        isAuthenticated: true,
        currentUser: { id: "u1", name: "User" },
        isAdmin: false,
      }),
  );
  vi.stubGlobal("useRecommendationStore", () => recommendationStore);
  vi.stubGlobal("useDictationStore", () => reactive({ language: "auto" }));
}

const task = {
  id: "task-1",
  projectId: "p1",
  title: "Task",
  description: "",
  status: "To Do",
  priority: "medium",
  dueDate: null,
  assignees: [],
  labels: [],
  dependencies: [],
  checklist: [],
  comments: [],
  attachments: [
    {
      id: "att-voice",
      taskId: "task-1",
      fileName: "voice-message.webm",
      fileSize: 12,
    },
    { id: "att-pdf", taskId: "task-1", fileName: "doc.pdf", fileSize: 12 },
  ],
};

let tasksStore: ReturnType<typeof makeTasksStore>;
let recommendationStore: Record<string, unknown>;

function makeTasksStore() {
  const store = reactive({
    currentTask: null as typeof task | null,
    tasks: [] as (typeof task)[],
    fetchById: vi.fn(async () => {
      store.currentTask = task;
    }),
    update: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
    setStatus: vi.fn(),
    setPriority: vi.fn(),
    setDueDate: vi.fn(),
    setAssignees: vi.fn(),
    setLabels: vi.fn(),
    setDependencies: vi.fn(),
    addComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  });
  return store;
}

function mountDialog() {
  return mount(TaskDetailDialog, {
    props: { taskId: "task-1" },
    global: {
      stubs: {
        ProjectSelect: true,
        LabelMultiSelect: true,
        UserMultiSelect: true,
        CommentComposer: true,
        AttachmentFullscreenViewer: true,
        InlineDictationButton: InlineDictationButtonStub,
      },
    },
  });
}

beforeEach(() => {
  installAutoImportStubs();
  tasksStore = makeTasksStore();
  recommendationStore = {
    config: {},
    isImproveEnabled: true,
    isDictationEnabled: true,
    isDictationSttConfigured: true,
    dictationInlineJobs: true,
    dictationLanguages: ["auto", "en", "fr"],
    fetchConfig: vi.fn().mockResolvedValue(undefined),
  };
  mockGet.mockImplementation((url: string) => {
    if (url.includes("attachments")) {
      return Promise.resolve({ data: new Blob(["x"]) });
    }
    return Promise.resolve({ data: {} });
  });
  Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TaskDetailDialog inline dictation", () => {
  it("should offer a microphone on the editable title and description", async () => {
    const wrapper = mountDialog();
    await flushPromises();

    await wrapper.find('button[aria-label="Edit"]').trigger("click");
    await flushPromises();

    const buttons = wrapper.findAllComponents(InlineDictationButtonStub);
    expect(buttons.map((button) => button.props("ariaLabel"))).toEqual([
      "Dictate task title",
      "Dictate task description",
    ]);
    expect(buttons.map((button) => button.props("projectId"))).toEqual([
      "p1",
      "p1",
    ]);
  });
});
