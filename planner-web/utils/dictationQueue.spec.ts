import { beforeEach, describe, expect, it } from "vitest";
import {
  clearQueuedDictations,
  enqueueDictation,
  listQueuedDictations,
  QUEUE_MAX_BYTES,
  QUEUE_MAX_ITEMS,
  queueStats,
  removeQueuedDictation,
} from "./dictationQueue";

function audio(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: "audio/webm" });
}

describe("offline dictation queue", () => {
  beforeEach(async () => {
    await clearQueuedDictations();
  });

  it("should keep queued recordings and report their size", async () => {
    const first = await enqueueDictation({
      blob: audio(10),
      mimeType: "audio/webm",
      language: "en",
    });
    const second = await enqueueDictation({
      blob: audio(20),
      mimeType: "audio/webm",
    });

    const items = await listQueuedDictations();
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toContain(first.item?.id);
    expect(items.map((item) => item.id)).toContain(second.item?.id);
    expect(second.item?.language).toBe("auto");
    expect(await queueStats()).toEqual({ items: 2, bytes: 30 });
  });

  it("should generate a client id when none is provided", async () => {
    const queued = await enqueueDictation({
      blob: audio(1),
      mimeType: "audio/webm",
    });
    expect(queued.item?.clientId).toBeTruthy();
    expect(queued.item?.clientId).toBe(queued.item?.id);
  });

  it("should reuse the caller client id for idempotent retries", async () => {
    const queued = await enqueueDictation({
      blob: audio(1),
      mimeType: "audio/webm",
      clientId: "client-123",
    });
    expect(queued.item?.clientId).toBe("client-123");
  });

  it("should evict the oldest item when the count cap is reached", async () => {
    for (let index = 0; index < QUEUE_MAX_ITEMS; index++) {
      await enqueueDictation({
        blob: audio(1),
        mimeType: "audio/webm",
        clientId: `client-${index}`,
      });
    }
    await enqueueDictation({
      blob: audio(1),
      mimeType: "audio/webm",
      clientId: "client-new",
    });

    const items = await listQueuedDictations();
    expect(items).toHaveLength(QUEUE_MAX_ITEMS);
    expect(items.map((item) => item.clientId)).toContain("client-new");
  });

  it("should evict the oldest items to stay within the byte cap", async () => {
    const big = { size: QUEUE_MAX_BYTES - 10 } as unknown as Blob;
    await enqueueDictation({
      blob: big,
      mimeType: "audio/webm",
      clientId: "big",
    });
    await enqueueDictation({
      blob: audio(20),
      mimeType: "audio/webm",
      clientId: "small",
    });

    const items = await listQueuedDictations();
    expect(items.map((item) => item.clientId)).toEqual(["small"]);
  });

  it("should refuse a single recording larger than the byte cap", async () => {
    const oversized = { size: QUEUE_MAX_BYTES + 1 } as unknown as Blob;
    const queued = await enqueueDictation({
      blob: oversized,
      mimeType: "audio/webm",
    });

    expect(queued.item).toBeUndefined();
    expect(queued.error).toBeTruthy();
    expect(await queueStats()).toEqual({ items: 0, bytes: 0 });
  });

  it("should remove a queued recording by id", async () => {
    const queued = await enqueueDictation({
      blob: audio(5),
      mimeType: "audio/webm",
    });
    await removeQueuedDictation(queued.item!.id);

    expect(await listQueuedDictations()).toHaveLength(0);
  });
});