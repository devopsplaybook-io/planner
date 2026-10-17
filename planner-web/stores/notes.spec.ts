// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useNotesStore } from "./notes";

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

describe("notes store search", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should send the q term and store the results", async () => {
    const note = {
      id: "note-1",
      projectId: "proj-1",
      title: "Meeting notes",
      description: "",
      comments: [],
      attachments: [],
      labels: [],
      dateCreated: "2026-10-01T00:00:00.000Z",
      dateUpdated: "2026-10-01T00:00:00.000Z",
    };
    mockApiGet.mockResolvedValue({ data: [note] });
    const store = useNotesStore();

    const results = await store.searchNotes({ q: "meeting" });

    expect(mockApiGet).toHaveBeenCalledWith("/notes", {
      params: { q: "meeting" },
    });
    expect(results).toEqual([note]);
  });

  it("should send the projectIds subtree filter joined as a string", async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    const store = useNotesStore();

    await store.searchNotes({
      projectId: "proj-1",
      projectIds: ["proj-1", "proj-2"],
      q: "meeting",
    });

    expect(mockApiGet).toHaveBeenCalledWith("/notes", {
      params: {
        projectId: "proj-1",
        projectIds: "proj-1,proj-2",
        q: "meeting",
      },
    });
  });

  it("should send no params when nothing is set", async () => {
    mockApiGet.mockResolvedValue({ data: [] });
    const store = useNotesStore();

    await store.searchNotes();

    expect(mockApiGet).toHaveBeenCalledWith("/notes", { params: {} });
  });
});
