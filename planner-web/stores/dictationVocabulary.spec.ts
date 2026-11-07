// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useDictationVocabularyStore } from "./dictationVocabulary";

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
const mockApiPut = api.put as unknown as ReturnType<typeof vi.fn>;
const mockApiDelete = api.delete as unknown as ReturnType<typeof vi.fn>;

const personal = {
  id: "v1",
  term: "Kubernetes",
  projectId: null,
  dateCreated: "2026-11-07T10:00:00.000Z",
};
const projectTerm = {
  id: "v2",
  term: "xAuto",
  projectId: "p1",
  dateCreated: "2026-11-07T10:00:00.000Z",
};

describe("dictation vocabulary store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("should load the terms and filter them by scope", async () => {
    mockApiGet.mockResolvedValue({ data: { terms: [personal, projectTerm] } });
    const store = useDictationVocabularyStore();

    expect(await store.fetchAll()).toEqual({});
    expect(mockApiGet).toHaveBeenCalledWith("/dictation/vocabulary");
    expect(store.count).toBe(2);
    expect(store.termsFor(null)).toEqual([personal]);
    expect(store.termsFor("p1")).toEqual([projectTerm]);
  });

  it("should add a term and append it to the list", async () => {
    mockApiPost.mockResolvedValue({ data: { term: personal } });
    const store = useDictationVocabularyStore();

    const result = await store.add("Kubernetes", null);

    expect(mockApiPost).toHaveBeenCalledWith("/dictation/vocabulary", {
      term: "Kubernetes",
      projectId: null,
    });
    expect(result.term).toEqual(personal);
    expect(store.terms).toEqual([personal]);
  });

  it("should return duplicates without adding them", async () => {
    mockApiPost.mockRejectedValue({
      response: {
        status: 409,
        data: { error: "This term is already in the vocabulary" },
      },
    });
    const store = useDictationVocabularyStore();

    const result = await store.add("Kubernetes", null);

    expect(result.error).toBe("This term is already in the vocabulary");
    expect(store.terms).toEqual([]);
    expect(store.error).toBe("This term is already in the vocabulary");
  });

  it("should remove a term from the list", async () => {
    mockApiDelete.mockResolvedValue({});
    const store = useDictationVocabularyStore();
    store.terms = [personal, projectTerm];

    expect(await store.remove("v1")).toEqual({});
    expect(mockApiDelete).toHaveBeenCalledWith("/dictation/vocabulary/v1");
    expect(store.terms).toEqual([projectTerm]);
  });

  it("should report a removal failure", async () => {
    mockApiDelete.mockRejectedValue(new Error("Network Error"));
    const store = useDictationVocabularyStore();
    store.terms = [personal];

    const result = await store.remove("v1");

    expect(result.error).toBeDefined();
    expect(store.terms).toEqual([personal]);
  });

  it("should replace one scope and keep the other scopes", async () => {
    const imported = { ...personal, id: "v3", term: "Grafana" };
    mockApiPut.mockResolvedValue({ data: { terms: [imported] } });
    const store = useDictationVocabularyStore();
    store.terms = [personal, projectTerm];

    const result = await store.replaceScope(null, ["Grafana"]);

    expect(mockApiPut).toHaveBeenCalledWith("/dictation/vocabulary", {
      projectId: null,
      terms: ["Grafana"],
    });
    expect(result.terms).toEqual([imported]);
    expect(store.terms).toEqual([projectTerm, imported]);
  });

  it("should return an import failure without changing the terms", async () => {
    mockApiPut.mockRejectedValue({
      response: { data: { error: "Vocabulary limit reached" } },
    });
    const store = useDictationVocabularyStore();
    store.terms = [personal];

    const result = await store.replaceScope(null, ["a", "b"]);

    expect(result.error).toBe("Vocabulary limit reached");
    expect(store.terms).toEqual([personal]);
  });

  it("should return the load failure", async () => {
    mockApiGet.mockRejectedValue({
      response: { data: { error: "Access Denied" } },
    });
    const store = useDictationVocabularyStore();

    const result = await store.fetchAll();

    expect(result.error).toBe("Access Denied");
    expect(store.loading).toBe(false);
  });
});
