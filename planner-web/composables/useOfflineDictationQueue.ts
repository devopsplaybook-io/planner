import { ref } from "vue";
import { useDictationStore } from "../stores/dictation";
import { useToasts } from "./useToasts";
import {
  enqueueDictation,
  listQueuedDictations,
  queueStats,
  removeQueuedDictation,
  type QueuedDictation,
} from "../utils/dictationQueue";

const queuedCount = ref(0);
const queuedBytes = ref(0);
const flushing = ref(false);
let onlineHandler: (() => void) | null = null;

/** A queued item is only dropped when retrying could never succeed. */
function isPermanentFailure(status?: number): boolean {
  if (!status) {
    return false;
  }
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

async function refreshQueueStats(): Promise<void> {
  const stats = await queueStats();
  queuedCount.value = stats.items;
  queuedBytes.value = stats.bytes;
}

/**
 * Durable offline queue for quick capture. Recordings made while offline (or
 * whose upload fails without a server answer) are retried automatically when
 * the connection returns; each item keeps its client-generated id so a retry
 * never creates a duplicate job.
 */
export function useOfflineDictationQueue() {
  async function flush(): Promise<number> {
    if (flushing.value) {
      return 0;
    }
    // Never upload for a signed-out browser: a 401 would otherwise drop the
    // queue that belongs to the next signed-in user
    if (typeof localStorage !== "undefined" && !localStorage.getItem("token")) {
      return 0;
    }
    flushing.value = true;
    let uploaded = 0;
    try {
      const items = await listQueuedDictations();
      if (items.length === 0) {
        return 0;
      }
      const dictationStore = useDictationStore();
      const { pushToast } = useToasts();
      for (const item of items) {
        const result = await dictationStore.uploadJob(
          item.blob,
          item.mimeType,
          item.language,
          "quick_capture",
          item.projectId,
          item.targetLanguage,
          { clientId: item.clientId },
        );
        if (result.jobId || result.conflictJobId) {
          await removeQueuedDictation(item.id);
          uploaded++;
          continue;
        }
        if (result.offline) {
          // Still offline: keep the item and the order for the next attempt
          break;
        }
        if (!isPermanentFailure(result.status)) {
          // Transient server/auth failure: retrying later may succeed
          break;
        }
        // The server rejected it (size, format, permission): retrying forever
        // would only hide the failure, so drop it and tell the user.
        await removeQueuedDictation(item.id);
        pushToast({
          kind: "error",
          title: "Queued dictation dropped",
          message: result.error || "The recording could not be uploaded.",
        });
      }
      if (uploaded > 0) {
        pushToast({
          kind: "success",
          title:
            uploaded === 1
              ? "Queued dictation uploaded"
              : `${uploaded} queued dictations uploaded`,
          url: "/inbox",
        });
      }
      return uploaded;
    } finally {
      flushing.value = false;
      await refreshQueueStats();
    }
  }

  async function enqueue(input: {
    blob: Blob;
    mimeType: string;
    language?: string;
    projectId?: string | null;
    targetLanguage?: string | null;
  }): Promise<{ queued: boolean; error?: string }> {
    const result = await enqueueDictation(input);
    await refreshQueueStats();
    return { queued: !!result.item, error: result.error };
  }

  async function init(): Promise<void> {
    await refreshQueueStats();
    if (!onlineHandler) {
      onlineHandler = () => {
        void flush();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("online", onlineHandler);
      }
    }
    // Safe to call on every app start and after login: flush() is a no-op
    // when the browser is signed out
    void flush();
  }

  return {
    queuedCount,
    queuedBytes,
    flushing,
    init,
    enqueue,
    flush,
    refreshQueueStats,
    items: (): Promise<QueuedDictation[]> => listQueuedDictations(),
  };
}