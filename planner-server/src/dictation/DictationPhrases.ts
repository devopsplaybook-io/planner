export const PHRASE_MAX_LENGTH = 100;

/**
 * Normalized comparison form of a command phrase: NFKC, accent-insensitive,
 * lower-cased, punctuation collapsed to single spaces. Used for matching and
 * uniqueness only; the stored display phrase is never rewritten.
 */
export function NormalizePhraseText(value: string): string {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NormalizedPhrase {
  phrase: string;
  normalizedPhrase: string;
}

/**
 * Normalizes a user-supplied phrase for storage: NFKC, trimmed, inner
 * whitespace collapsed, bounded to PHRASE_MAX_LENGTH. Returns null when the
 * phrase is empty or too long.
 */
export function NormalizePhraseInput(raw: unknown): NormalizedPhrase | null {
  if (typeof raw !== "string") {
    return null;
  }
  const phrase = raw
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase || phrase.length > PHRASE_MAX_LENGTH) {
    return null;
  }
  const normalizedPhrase = NormalizePhraseText(phrase);
  if (!normalizedPhrase) {
    return null;
  }
  return { phrase, normalizedPhrase };
}

export interface DictationCommandPhraseLike {
  id: string;
  phrase: string;
  normalizedPhrase?: string;
  projectId: string | null;
  templateId: string | null;
  labels: string[];
  dateCreated: string;
}

export interface DictationPhraseMatch<T extends DictationCommandPhraseLike> {
  phrase: T;
  /** Transcript text after the matched phrase (original casing preserved). */
  remainder: string;
}

/**
 * Finds the longest configured phrase that is a prefix of the transcript at
 * a word boundary. Longer normalized phrases win; ties go to the most
 * recently created phrase. Returns the phrase and the remaining text.
 */
export function MatchCommandPhrase<T extends DictationCommandPhraseLike>(
  transcript: string,
  phrases: T[],
): DictationPhraseMatch<T> | null {
  const tokens = (transcript || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  let best: { phrase: T; tokenCount: number; length: number } | null = null;
  for (const phrase of phrases) {
    const phraseTokens = (phrase.phrase || "").trim().split(/\s+/).filter(Boolean);
    if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) {
      continue;
    }
    const prefix = NormalizePhraseText(
      tokens.slice(0, phraseTokens.length).join(" "),
    );
    const normalized = phrase.normalizedPhrase || NormalizePhraseText(phrase.phrase);
    if (!normalized || prefix !== normalized) {
      continue;
    }
    const isLonger = normalized.length > (best?.length ?? 0);
    const isNewerTie =
      normalized.length === (best?.length ?? 0) &&
      (!best || phrase.dateCreated > best.phrase.dateCreated);
    if (!best || isLonger || isNewerTie) {
      best = {
        phrase,
        tokenCount: phraseTokens.length,
        length: normalized.length,
      };
    }
  }
  if (!best) {
    return null;
  }
  return {
    phrase: best.phrase,
    remainder: tokens.slice(best.tokenCount).join(" "),
  };
}
