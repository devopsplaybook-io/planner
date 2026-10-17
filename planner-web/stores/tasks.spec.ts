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

describe("tasks store dependency updates", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should post the dependency task ids to the replace endpoint", async () => {
    mockApiPost.mockResolvedValue({ data: {} });
    const store = useTasksStore();

    await store.setDependencies("task-1", ["task-2", "task-3"]);

    expect(mockApiPost).toHaveBeenCalledWith("/tasks/task-1/dependencies", {
      dependencies: ["task-2", "task-3"],
    });
  });
});

describe("tasks store attachment upload", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should post the file as multipart and register the attachment", async () => {
    mockApiPost.mockResolvedValue({
      data: { id: "att-1", fileName: "voice-message.webm" },
    });
    const store = useTasksStore();
    const file = new File(["audio-bytes"], "voice-message.webm", {
      type: "audio/webm",
    });

    const attachment = await store.uploadAttachment("task-1", file);

    expect(attachment).toEqual({ id: "att-1", fileName: "voice-message.webm" });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    const [url, formData, config] = mockApiPost.mock.calls[0]!;
    expect(url).toBe("/tasks/task-1/attachments");
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("file")).toBe(file);
    expect(config.params).toBeUndefined();
  });

  it("should forward the language option as a query param (voice comments)", async () => {
    mockApiPost.mockResolvedValue({ data: { id: "att-2" } });
    const store = useTasksStore();
    const file = new File(["audio-bytes"], "voice-message.webm", {
      type: "audio/webm",
    });

    await store.uploadAttachment("task-1", file, { language: "fr" });

    const [, , config] = mockApiPost.mock.calls[0]!;
    expect(config.params).toEqual({ language: "fr" });
  });
});
