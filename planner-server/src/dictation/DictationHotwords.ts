import { VOCABULARY_TERM_MAX_LENGTH } from "./DictationVocabularyData";

/** Hard upper bound on the composed prompt length (tokens stay bounded). */
export const HOTWORDS_PROMPT_MAX_CHARS = 1000;

const PROMPT_PREFIX =
  "Vocabulary (names and jargon that may appear in the audio; keep their spelling): ";

function sanitizeTerm(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VOCABULARY_TERM_MAX_LENGTH);
}

/**
 * Builds the STT initial-prompt line from the project scope first, then the
 * user scope: deduped case-insensitively (first casing wins), capped to
 * `maxTerms` and to a hard character budget. Returns null when nothing is
 * left. The result is never persisted or logged.
 */
export function ComposeHotwordPrompt(
  projectTerms: string[],
  userTerms: string[],
  maxTerms: number,
): string | null {
  const cap = Math.max(0, Math.floor(maxTerms));
  if (cap === 0) {
    return null;
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of [...(projectTerms || []), ...(userTerms || [])]) {
    const term = sanitizeTerm(raw);
    if (!term) {
      continue;
    }
    const normalized = term.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    terms.push(term);
    if (terms.length >= cap) {
      break;
    }
  }
  if (terms.length === 0) {
    return null;
  }
  // Drop trailing terms until the whole prompt fits the character budget
  while (terms.length > 0) {
    const prompt = `${PROMPT_PREFIX}${terms.join(", ")}.`;
    if (prompt.length <= HOTWORDS_PROMPT_MAX_CHARS) {
      return prompt;
    }
    terms.pop();
  }
  return null;
}
