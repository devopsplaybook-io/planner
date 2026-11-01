// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, onMounted, ref, watch } from "vue";

import IndexPage from "./index.vue";

// The page relies on Nuxt auto-imports: bare identifiers resolve through
// globalThis at runtime, so stub them before mounting.
vi.stubGlobal("ref", ref);
vi.stubGlobal("computed", computed);
vi.stubGlobal("watch", watch);
vi.stubGlobal("onMounted", onMounted);

const dashboard = {
  overdue: [],
  upcoming: [],
  noDate: [],
  recentlyDone: [
    {
      id: "done-1",
      projectId: "p1",
      title: "Finished task",
      status: "Done",
      priority: "medium",
      labels: [],
    },
  ],
};

const tasksStore = {
  tasks: [],
  fetchAll: vi.fn(),
  fetchDashboard: vi.fn(async () => dashboard),
};
const projectsStore = {
  selectedProjectFilter: "",
  fetchAll: vi.fn(async () => undefined),
  setProjectFilter: vi.fn(),
  subtreeProjectIds: vi.fn(() => undefined),
};
const statusesStore = {
  fetchAll: vi.fn(async () => undefined),
};
const labelsStore = {
  labels: [],
  fetchAll: vi.fn(async () => undefined),
};
const recommendationStore = {
  isLlmEnabled: false,
  loading: false,
  generating: false,
  hasRecommendation: false,
  recommendation: null,
  fetchConfig: vi.fn(async () => undefined),
  fetchRecommendation: vi.fn(),
  regenerateRecommendation: vi.fn(),
};
const router = { replace: vi.fn() };
const route = { path: "/", query: {} };

vi.stubGlobal("useTasksStore", () => tasksStore);
vi.stubGlobal("useProjectsStore", () => projectsStore);
vi.stubGlobal("useStatusesStore", () => statusesStore);
vi.stubGlobal("useLabelsStore", () => labelsStore);
vi.stubGlobal("useRecommendationStore", () => recommendationStore);
vi.stubGlobal("useRouter", () => router);
vi.stubGlobal("useRoute", () => route);
vi.stubGlobal("useDialogCloseRefresh", () => {});
vi.stubGlobal("useRegularRefresh", () => {});

const NullStub = defineComponent({ render: () => null });
const TaskCardStub = defineComponent({
  props: { task: { type: Object, required: true } },
  setup(props) {
    return () =>
      h("div", { class: "task-card" }, (props.task as { title: string }).title);
  },
});
const stubs = {
  ProjectSelect: NullStub,
  LabelMultiSelect: NullStub,
  TagCloud: NullStub,
  TaskCard: TaskCardStub,
  TaskCreateDialog: NullStub,
};

beforeEach(() => {
  tasksStore.fetchDashboard.mockClear();
  tasksStore.fetchAll.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Dashboard recently done", () => {
  it("should render the server recentlyDone payload without fetching the full task list", async () => {
    const wrapper = mount(IndexPage, { global: { components: stubs } });
    await flushPromises();

    // One bounded dashboard request; no /tasks full-list fetch
    expect(tasksStore.fetchDashboard).toHaveBeenCalledTimes(1);
    expect(tasksStore.fetchAll).not.toHaveBeenCalled();

    // Recently Done renders the rows returned by the server
    expect(wrapper.text()).toContain("Recently Done");
    expect(wrapper.text()).toContain("Finished task");
    expect(wrapper.text()).toContain("5 most recent");
  });
});
