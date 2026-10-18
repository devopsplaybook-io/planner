// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useLabelsStore } from "./labels";

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

describe("labels store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should fetch the labels without params when no q is given", async () => {
    mockApiGet.mockResolvedValue({
      data: [
        { name: "urgent", count: 12 },
        { name: "ui", count: 4 },
      ],
    });
    const store = useLabelsStore();

    const labels = await store.fetchAll();

    expect(mockApiGet).toHaveBeenCalledWith("/labels", { params: {} });
    expect(labels).toEqual([
      { name: "urgent", count: 12 },
      { name: "ui", count: 4 },
    ]);
    expect(store.labels).toEqual(labels);
  });

  it("should send the q filter when given", async () => {
    mockApiGet.mockResolvedValue({ data: [{ name: "urgent", count: 12 }] });
    const store = useLabelsStore();

    await store.fetchAll("urg");

    expect(mockApiGet).toHaveBeenCalledWith("/labels", { params: { q: "urg" } });
    expect(store.labels).toEqual([{ name: "urgent", count: 12 }]);
  });

  it("should keep the cached labels when a fetch returns nothing", async () => {
    mockApiGet.mockResolvedValue({
      data: [{ name: "urgent", count: 12 }],
    });
    const store = useLabelsStore();
    await store.fetchAll();

    mockApiGet.mockResolvedValue({ data: [] });
    await store.fetchAll("no-match");

    // The suggestion dropdown keeps working off the last non-empty result
    expect(store.labels).toEqual([{ name: "urgent", count: 12 }]);
  });

  it("should replace the cache when a later fetch finds labels again", async () => {
    mockApiGet.mockResolvedValue({ data: [{ name: "old", count: 1 }] });
    const store = useLabelsStore();
    await store.fetchAll();

    mockApiGet.mockResolvedValue({ data: [{ name: "new", count: 2 }] });
    await store.fetchAll();

    expect(store.labels).toEqual([{ name: "new", count: 2 }]);
  });
});
