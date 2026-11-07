// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useNotificationsStore } from "./notifications";

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
const mockApiPut = api.put as unknown as ReturnType<typeof vi.fn>;

describe("notifications store digest preference", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should load the digest preference in init()", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/notifications/preferences") {
        return Promise.resolve({ data: { digest: true } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    const store = useNotificationsStore();

    await store.init();

    expect(mockApiGet).toHaveBeenCalledWith("/notifications/preferences");
    expect(store.digest).toBe(true);
  });

  it("should keep the digest off when the preference request fails", async () => {
    mockApiGet.mockRejectedValue(new Error("Network Error"));
    const store = useNotificationsStore();

    await store.init();

    expect(store.digest).toBe(false);
  });

  it("should PUT the digest preference and update the state", async () => {
    mockApiPut.mockResolvedValue({ data: { digest: true } });
    const store = useNotificationsStore();

    await store.setDigest(true);

    expect(mockApiPut).toHaveBeenCalledWith("/notifications/preferences", {
      digest: true,
    });
    expect(store.digest).toBe(true);
  });

  it("should revert the digest state when the save fails", async () => {
    mockApiPut.mockRejectedValue(new Error("Network Error"));
    const store = useNotificationsStore();

    await store.setDigest(true);
    expect(mockApiPut).toHaveBeenCalledWith("/notifications/preferences", {
      digest: true,
    });
    expect(store.digest).toBe(false);

    await store.setDigest(false);
    expect(mockApiPut).toHaveBeenLastCalledWith("/notifications/preferences", {
      digest: false,
    });
    expect(store.digest).toBe(false);
  });

  it("should load the dictation-ready preference", async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/notifications/preferences") {
        return Promise.resolve({ data: { digest: false, dictation: false } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    const store = useNotificationsStore();

    await store.init();

    expect(store.dictation).toBe(false);
  });

  it("should default the dictation-ready preference to on", async () => {
    mockApiGet.mockResolvedValue({
      data: { digest: false, dictation: true },
    });
    const store = useNotificationsStore();

    await store.init();

    expect(store.dictation).toBe(true);
  });

  it("should persist and optimistically toggle the dictation preference", async () => {
    mockApiPut.mockResolvedValue({ data: { dictation: false } });
    const store = useNotificationsStore();

    await store.setDictation(false);

    expect(mockApiPut).toHaveBeenCalledWith("/notifications/preferences", {
      dictation: false,
    });
    expect(store.dictation).toBe(false);
  });

  it("should revert the dictation preference when the save fails", async () => {
    mockApiPut.mockRejectedValue(new Error("Network Error"));
    const store = useNotificationsStore();

    await store.setDictation(false);

    expect(store.dictation).toBe(true);
  });
});
