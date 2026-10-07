// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useTasksStore } from "./tasks";

// vi.mock is hoisted above the imports by vitest
vi.mock("../utils/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;

describe("tasks store list reads", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should request only the board fields and keep the fetch filters", async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    const store = useTasksStore();

    await store.fetchAll("proj-1", {
      projectIds: ["proj-1", "proj-2"],
      doneSince: "2026-10-01T00:00:00.000Z",
    });

    expect(mockApiGet).toHaveBeenCalledWith("/tasks", {
      params: {
        fields:
          "id,projectId,title,status,priority,dueDate,checklist,assignees,labels,dateCreated,dateUpdated",
        projectId: "proj-1",
        projectIds: "proj-1,proj-2",
        doneSince: "2026-10-01T00:00:00.000Z",
      },
    });
  });

  it("should default the keys omitted by the list fieldsets", async () => {
    mockApiGet.mockResolvedValue({
      data: [
        {
          id: "task-1",
          projectId: "proj-1",
          title: "On the board",
          status: "To Do",
          priority: "medium",
          checklist: [],
          assignees: [],
          labels: [],
          dateCreated: "2026-10-01T00:00:00.000Z",
          dateUpdated: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    const store = useTasksStore();

    await store.fetchAll();

    const first = store.tasks[0]!;
    expect(first.description).toBe("");
    expect(first.comments).toEqual([]);
    expect(first.attachments).toEqual([]);
    // Commenting on a list task must not crash on the omitted collections
    mockApiPost.mockResolvedValue({
      data: { id: "comment-1", userId: "u-1", text: "hi", dateCreated: "x" },
    });
    await store.addComment("task-1", "hi");
    expect(first.comments).toHaveLength(1);
  });

  it("should keep server-provided values when a field is present", async () => {
    mockApiGet.mockResolvedValue({
      data: [
        {
          id: "task-1",
          description: "kept",
          comments: [{ id: "c-1" }],
          attachments: [{ id: "a-1" }],
        },
      ],
    });
    const store = useTasksStore();
    const results = await store.searchTasks({ q: "kept" });

    expect(mockApiGet).toHaveBeenCalledWith(
      "/tasks",
      expect.objectContaining({
        params: expect.objectContaining({ q: "kept" }),
      }),
    );
    const first = results[0]!;
    expect(first.description).toBe("kept");
    expect(first.comments).toEqual([{ id: "c-1" }]);
    expect(first.attachments).toEqual([{ id: "a-1" }]);
  });
});
