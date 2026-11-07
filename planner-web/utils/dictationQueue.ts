/**
 * Durable offline queue for short dictations (quick capture). IndexedDB keeps
 * the recording across reloads; an in-memory queue is used when IndexedDB is
 * unavailable so the UI still works (best effort, not persisted).
 *
 * Bounds: 20 items and 100 MB of audio. Oldest items are evicted first.
 */
export const QUEUE_MAX_ITEMS = 20;
export const QUEUE_MAX_BYTES = 100 * 1024 * 1024;

const DB_NAME = "planner-dictation-queue";
const DB_VERSION = 1;
const STORE = "items";

export interface QueuedDictation {
  id: string;
  clientId: string;
  blob: Blob;
  mimeType: string;
  language: string;
  projectId: string | null;
  targetLanguage: string | null;
  size: number;
  dateCreated: string;
}

export interface QueueStats {
  items: number;
  bytes: number;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

let memory: QueuedDictation[] = [];

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function sortOldestFirst(items: QueuedDictation[]): QueuedDictation[] {
  return [...items].sort((a, b) =>
    a.dateCreated < b.dateCreated ? -1 : 1,
  );
}

export async function listQueuedDictations(): Promise<QueuedDictation[]> {
  if (!hasIndexedDb()) {
    return sortOldestFirst(memory);
  }
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const rows = await requestResult(
        tx.objectStore(STORE).getAll() as IDBRequest<QueuedDictation[]>,
      );
      return sortOldestFirst(rows);
    } finally {
      db.close();
    }
  } catch {
    return sortOldestFirst(memory);
  }
}

export async function queueStats(): Promise<QueueStats> {
  const items = await listQueuedDictations();
  return {
    items: items.length,
    bytes: items.reduce((sum, item) => sum + (item.size || 0), 0),
  };
}

async function deleteQueued(id: string): Promise<void> {
  if (!hasIndexedDb()) {
    memory = memory.filter((item) => item.id !== id);
    return;
  }
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      await transactionDone(tx);
    } finally {
      db.close();
    }
  } catch {
    memory = memory.filter((item) => item.id !== id);
  }
}

/**
 * Queues one recording. Evicts the oldest entries to stay within the item and
 * byte bounds; refuses the new item only when it alone exceeds the byte cap.
 */
export async function enqueueDictation(input: {
  blob: Blob;
  mimeType: string;
  language?: string;
  projectId?: string | null;
  targetLanguage?: string | null;
  clientId?: string;
}): Promise<{ item?: QueuedDictation; error?: string }> {
  const size = input.blob.size || 0;
  if (size > QUEUE_MAX_BYTES) {
    return { error: "The recording is too large for the offline queue." };
  }
  let existing = await listQueuedDictations();
  while (
    existing.length >= QUEUE_MAX_ITEMS ||
    existing.reduce((sum, item) => sum + (item.size || 0), 0) + size >
      QUEUE_MAX_BYTES
  ) {
    const oldest = existing[0];
    if (!oldest) {
      break;
    }
    await deleteQueued(oldest.id);
    existing = existing.slice(1);
  }
  const id = newId();
  const item: QueuedDictation = {
    id,
    clientId: input.clientId || id,
    blob: input.blob,
    mimeType: input.mimeType,
    language: input.language || "auto",
    projectId: input.projectId || null,
    targetLanguage: input.targetLanguage ?? null,
    size,
    dateCreated: new Date().toISOString(),
  };
  if (!hasIndexedDb()) {
    memory.push(item);
    return { item };
  }
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      await transactionDone(tx);
    } finally {
      db.close();
    }
    return { item };
  } catch {
    memory.push(item);
    return { item };
  }
}

export async function removeQueuedDictation(id: string): Promise<void> {
  await deleteQueued(id);
}

/** Test hook: clears both the durable and the in-memory queues. */
export async function clearQueuedDictations(): Promise<void> {
  memory = [];
  if (!hasIndexedDb()) {
    return;
  }
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await transactionDone(tx);
    } finally {
      db.close();
    }
  } catch {
    // Nothing durable to clear
  }
}