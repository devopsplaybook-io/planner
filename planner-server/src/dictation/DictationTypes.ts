/**
 * One recognized segment of a transcript with its average token confidence.
 * Only the per-segment average is persisted: raw token probabilities and
 * transcript text inside spans are never exported as telemetry.
 */
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
