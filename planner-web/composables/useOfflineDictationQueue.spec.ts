// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../utils/api";
import { useToasts } from "./useToasts";
import { useOfflineDictationQueue } from "./useOfflineDictationQueue";
import {
  clearQueuedDictations,
  enqueueDictation,
  queueStats,
} from "../utils/dictationQueue";

vi.mock("../utils/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;
const { toasts } = useToasts();

function queueOne(clientId = "client-1") {
  return enqueueDictation({
    blob: new Blob(["audio"], { type: "audio/webm" }),
    mimeType: "audio/webm",
    language: "en",
    clientId,
  });
}

describe("useOfflineDictationQueue", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    localStorage.clear();
    localStorage.setItem("token", "test-token");
    vi.clearAllMocks();
    toasts.value = [];
    await clearQueuedDictations();
  });

  it("should upload queued recordings with their client id and clear them", async () => {
    mockApiPost.mockResolvedValue({ data: { jobId: "job-1" } });
    await queueOne("client-1");
    const queue = useOfflineDictationQueue();

    const uploaded = await queue.flush();

    expect(uploaded).toBe(1);
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    const form = mockApiPost.mock.calls[0]?.[1] as FormData;
    expect(form.get("clientId")).toBe("client-1");
    expect(await queueStats()).toEqual({ items: 0, bytes: 0 });
    expect(toasts.value.some((toast) => toast.url === "/inbox")).toBe(true);
  });

  it("should keep the item when the upload fails without a server answer", async () => {
    mockApiPost.mockRejectedValue(new Error("Network Error"));
    await queueOne();
    const queue = useOfflineDictationQueue();

    const uploaded = await queue.flush();

    expect(uploaded).toBe(0);
    expect(await queueStats()).toEqual({ items: 1, bytes: 5 });
  });

  it("should keep the item on a transient server or auth failure", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 401, data: { error: "Access Denied" } },
    });
    await queueOne();
    const queue = useOfflineDictationQueue();

    await queue.flush();

    expect(await queueStats()).toEqual({ items: 1, bytes: 5 });
  });

  it("should drop an item the server permanently rejects and report it", async () => {
    mockApiPost.mockRejectedValue({
      response: { status: 400, data: { error: "Invalid: audio" } },
    });
    await queueOne();
    const queue = useOfflineDictationQueue();

    await queue.flush();

    expect(await queueStats()).toEqual({ items: 0, bytes: 0 });
    const dropped = toasts.value.find((toast) =>
      toast.title.includes("dropped"),
    );
    expect(dropped?.message).toBe("Invalid: audio");
  });

  it("should not upload while the browser is signed out", async () => {
    localStorage.removeItem("token");
    mockApiPost.mockResolvedValue({ data: { jobId: "job-1" } });
    await queueOne();
    const queue = useOfflineDictationQueue();

    const uploaded = await queue.flush();

    expect(uploaded).toBe(0);
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(await queueStats()).toEqual({ items: 1, bytes: 5 });
  });

  it("should enqueue a recording and report the queue size", async () => {
    const queue = useOfflineDictationQueue();

    const result = await queue.enqueue({
      blob: new Blob(["audio"], { type: "audio/webm" }),
      mimeType: "audio/webm",
    });

    expect(result.queued).toBe(true);
    expect(queue.queuedCount.value).toBe(1);
    expect(queue.queuedBytes.value).toBe(5);
  });
});