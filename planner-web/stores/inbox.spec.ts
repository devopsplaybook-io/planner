// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useInboxStore } from "./inbox";

vi.mock("../utils/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const mockApiPatch = api.patch as unknown as ReturnType<typeof vi.fn>;
const mockApiDelete = api.delete as unknown as ReturnType<typeof vi.fn>;

function inboxItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    source: "dictation",
    jobKind: "short",
    status: "done",
    stage: null,
    preview: "Buy milk",
    language: "en",
    audioDurationMs: 2000,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:01:00.000Z",
    archivedAt: null,
    convertedType: null,
    convertedTargetId: null,
    progress: { segmentsDone: 0, segmentsTotal: 0, percent: 0 },
    error: null,
    ...overrides,
  };
}

describe("inbox store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should fetch the first page with the default parameters", async () => {
    mockApiGet.mockResolvedValue({
      data: { items: [inboxItem()], total: 21, hasMore: true },
    });
    const store = useInboxStore();

    await store.fetchPage(true);

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/inbox", {
      params: { limit: 20, offset: 0 },
    });
    expect(store.items).toHaveLength(1);
    expect(store.total).toBe(21);
    expect(store.hasMore).toBe(true);
  });

  it("should map the active filters to query parameters", async () => {
    mockApiGet.mockResolvedValue({
      data: { items: [], total: 0, hasMore: false },
    });
    const store = useInboxStore();

    await store.setFilter({
      status: "done",
      source: "quick_capture",
      includeArchived: true,
    });

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/inbox", {
      params: {
        limit: 20,
        offset: 0,
        status: "done",
        source: "quick_capture",
        includeArchived: "1",
      },
    });
  });

  it("should append the next page without dropping loaded items", async () => {
    const store = useInboxStore();
    mockApiGet.mockResolvedValueOnce({
      data: { items: [inboxItem()], total: 2, hasMore: true },
    });
    await store.fetchPage(true);
    mockApiGet.mockResolvedValueOnce({
      data: { items: [inboxItem({ id: "job-2" })], total: 2, hasMore: false },
    });

    await store.loadMore();

    expect(mockApiGet).toHaveBeenLastCalledWith("/dictation/inbox", {
      params: { limit: 20, offset: 1 },
    });
    expect(store.items.map((item) => item.id)).toEqual(["job-1", "job-2"]);
    expect(store.hasMore).toBe(false);
  });

  it("should send the last seen timestamp when fetching the badge", async () => {
    localStorage.setItem(
      "dictation-inbox-seen-at",
      "2026-11-01T09:00:00.000Z",
    );
    mockApiGet.mockResolvedValue({ data: { unread: 2, processing: 1 } });
    const store = useInboxStore();

    await store.fetchBadge();

    expect(mockApiGet).toHaveBeenCalledWith("/dictation/inbox/badge", {
      params: { since: "2026-11-01T09:00:00.000Z" },
    });
    expect(store.badge).toEqual({ unread: 2, processing: 1 });
    expect(store.activeCount).toBe(3);
  });

  it("should clear the unread count and persist the seen timestamp", async () => {
    mockApiGet.mockResolvedValue({ data: { unread: 0, processing: 0 } });
    const store = useInboxStore();
    store.badge = { unread: 4, processing: 0 };

    store.markSeen();

    expect(store.badge.unread).toBe(0);
    expect(localStorage.getItem("dictation-inbox-seen-at")).toBeTruthy();
  });

  it("should remove an archived item from the default inbox view", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/dictation/inbox/badge") {
        return Promise.resolve({ data: { unread: 0, processing: 0 } });
      }
      return Promise.resolve({
        data: { items: [inboxItem(), inboxItem({ id: "job-2" })], total: 2, hasMore: false },
      });
    });
    mockApiPatch.mockResolvedValue({ data: { archived: true } });
    const store = useInboxStore();
    await store.fetchPage(true);

    const result = await store.archive("job-1", true);

    expect(result.error).toBeUndefined();
    expect(mockApiPatch).toHaveBeenCalledWith("/dictation/inbox/job-1", {
      archived: true,
    });
    expect(store.items.map((item) => item.id)).toEqual(["job-2"]);
    expect(store.total).toBe(1);
  });

  it("should keep an item visible when the archived list is shown", async () => {
    mockApiGet.mockResolvedValue({
      data: { items: [inboxItem()], total: 1, hasMore: false },
    });
    mockApiPatch.mockResolvedValue({ data: { archived: true } });
    const store = useInboxStore();
    store.filter.includeArchived = true;
    await store.fetchPage(true);

    await store.archive("job-1", true);

    expect(store.items[0]?.archivedAt).toBeTruthy();
  });

  it("should delete an item from the list", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/dictation/inbox/badge") {
        return Promise.resolve({ data: { unread: 0, processing: 0 } });
      }
      return Promise.resolve({
        data: { items: [inboxItem()], total: 1, hasMore: false },
      });
    });
    mockApiDelete.mockResolvedValue({ data: { deleted: true } });
    const store = useInboxStore();
    await store.fetchPage(true);

    const result = await store.remove("job-1");

    expect(result.error).toBeUndefined();
    expect(mockApiDelete).toHaveBeenCalledWith("/dictation/inbox/job-1");
    expect(store.items).toHaveLength(0);
    expect(store.total).toBe(0);
  });

  it("should mark an item converted with the server target", async () => {
    mockApiGet.mockResolvedValue({
      data: { items: [inboxItem()], total: 1, hasMore: false },
    });
    mockApiPost.mockResolvedValue({
      data: { type: "task", targetId: "task-9" },
    });
    const store = useInboxStore();
    await store.fetchPage(true);

    const result = await store.convert("job-1", {
      target: "task",
      projectId: "project-1",
      text: "Buy milk",
    });

    expect(result.error).toBeUndefined();
    expect(mockApiPost).toHaveBeenCalledWith(
      "/dictation/inbox/job-1/convert",
      { target: "task", projectId: "project-1", text: "Buy milk" },
    );
    expect(store.items[0]?.convertedType).toBe("task");
    expect(store.items[0]?.convertedTargetId).toBe("task-9");
  });

  it("should surface the conversion error", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 403, data: { error: "Permission denied" } },
    });
    const store = useInboxStore();

    const result = await store.convert("job-1", { target: "task" });

    expect(result.error).toBe("Permission denied");
  });

  it("should return the running job when an import conflicts", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 409, data: { jobId: "job-running" } },
    });
    const store = useInboxStore();

    const result = await store.importMeeting(new FormData());

    expect(result).toEqual({ conflictJobId: "job-running" });
  });

  it("should upload an import and report the accepted job id", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-new" } });
    const store = useInboxStore();

    const result = await store.importMeeting(new FormData());

    expect(result).toEqual({ jobId: "job-new" });
    expect(mockApiPost).toHaveBeenCalledWith(
      "/dictation/import",
      expect.any(FormData),
      expect.objectContaining({ timeout: 0 }),
    );
  });
});