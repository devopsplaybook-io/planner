/** Long-form jobs ("meeting") vs. short recordings. */
export type DictationJobKind = "short" | "meeting";

/**
 * Origin of a dictation job. `voice_comment` jobs stay attached to their task
 * and are excluded from the inbox by default.
 */
export type DictationJobSource =
  | "dictation"
  | "voice_comment"
  | "inline"
  | "quick_capture"
  | "import";

/** Sources that must never starve behind long-form batch work. */
export const DICTATION_INTERACTIVE_SOURCES: DictationJobSource[] = [
  "dictation",
  "inline",
  "quick_capture",
];

/** One recognized segment of a transcript with its average token confidence. */
export interface DictationSegment {
  text: string;
  fromMs: number;
  toMs: number;
  confidence: number | null;
}

/** Upper bound on persisted/exposed segments (long recordings). */
export const DICTATION_SEGMENTS_MAX = 500;

/**
 * Validates and bounds a parsed segments value. Returns null when the value
 * is absent or malformed so callers can degrade gracefully (external
 * engines have no confidence data).
 */
export function ParseDictationSegments(
  value: unknown,
): DictationSegment[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const segments: DictationSegment[] = [];
  for (const raw of value.slice(0, DICTATION_SEGMENTS_MAX)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.text !== "string" || !entry.text) {
      continue;
    }
    const fromMs = Number(entry.fromMs);
    const toMs = Number(entry.toMs);
    const confidence =
      entry.confidence === null || entry.confidence === undefined
        ? null
        : Math.min(1, Math.max(0, Number(entry.confidence)));
    segments.push({
      text: entry.text,
      fromMs: Number.isFinite(fromMs) ? Math.max(0, fromMs) : 0,
      toMs: Number.isFinite(toMs) ? Math.max(0, toMs) : 0,
      confidence:
        confidence === null || !Number.isFinite(confidence)
          ? null
          : confidence,
    });
  }
  return segments.length > 0 ? segments : null;
}

/**
 * One timestamped chunk of a long-form transcript. The shape deliberately
 * leaves room for a future `speaker` field (diarization is out of scope).
 */
export interface TimestampedTranscriptSegment {
  fromMs: number;
  toMs: number;
  text: string;
}

export const DICTATION_TRANSCRIPT_SEGMENTS_MAX = 2000;
export const DICTATION_TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Tolerant parser for the persisted long-form transcript: accepts a JSON
 * string or an array, drops malformed entries, caps the count and total
 * size, and clamps timestamps to be monotonic.
 */
export function ParseTranscriptSegments(
  value: unknown,
): TimestampedTranscriptSegment[] | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    if (!value) {
      return null;
    }
    if (value.length > DICTATION_TRANSCRIPT_MAX_BYTES) {
      return null;
    }
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const segments: TimestampedTranscriptSegment[] = [];
  let lastToMs = 0;
  let bytes = 0;
  for (const entry of raw.slice(0, DICTATION_TRANSCRIPT_SEGMENTS_MAX)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.text !== "string" || !item.text.trim()) {
      continue;
    }
    const fromMs = Math.max(
      lastToMs,
      Number.isFinite(Number(item.fromMs)) ? Math.max(0, Number(item.fromMs)) : 0,
    );
    const toMs = Math.max(
      fromMs,
      Number.isFinite(Number(item.toMs)) ? Math.max(0, Number(item.toMs)) : fromMs,
    );
    const text = item.text.trim();
    bytes += Buffer.byteLength(text, "utf-8");
    if (bytes > DICTATION_TRANSCRIPT_MAX_BYTES) {
      break;
    }
    lastToMs = toMs;
    segments.push({ fromMs, toMs, text });
  }
  return segments.length > 0 ? segments : null;
}

/** One chunk of a long-form job's silence-aware transcription plan. */
export interface DictationChunk {
  fromMs: number;
  toMs: number;
}

/**
 * Tolerant parser for the persisted chunk plan. The plan is generated
 * server-side, so malformed values simply mean "build it again".
 */
export function ParseChunkPlan(value: unknown): DictationChunk[] | null {
  let raw: unknown = value;
  if (typeof value === "string") {
    if (!value) {
      return null;
    }
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const chunks: DictationChunk[] = [];
  let lastFrom = 0;
  for (const entry of raw.slice(0, DICTATION_TRANSCRIPT_SEGMENTS_MAX)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const fromMs = Number(item.fromMs);
    const toMs = Number(item.toMs);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      continue;
    }
    const boundedFrom = Math.max(lastFrom, Math.max(0, fromMs));
    const boundedTo = Math.max(boundedFrom, toMs);
    chunks.push({ fromMs: boundedFrom, toMs: boundedTo });
    lastFrom = boundedTo;
  }
  return chunks.length > 0 ? chunks : null;
}

/** Bounded progress view of a long-form job (percent is 0..100). */
export function DictationProgress(
  segmentsDone: number,
  segmentsTotal: number,
): { segmentsDone: number; segmentsTotal: number; percent: number } {
  const done = Math.max(0, Math.floor(segmentsDone) || 0);
  const total = Math.max(0, Math.floor(segmentsTotal) || 0);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return { segmentsDone: done, segmentsTotal: total, percent };
}