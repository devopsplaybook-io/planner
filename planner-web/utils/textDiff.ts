/** Word-level diff between the raw transcript and the current review text. */

export type TextDiffType = "same" | "added" | "removed";

export interface TextDiffToken {
  type: TextDiffType;
  text: string;
}

export interface TextDiffResult {
  /** Empty when `limited` is true: the caller shows both texts side by side. */
  tokens: TextDiffToken[];
  limited: boolean;
}

// Bounded so very long dictations never build a huge LCS table or DOM tree.
export const TEXT_DIFF_TOKEN_LIMIT = 800;

export function tokenizeForDiff(text: string): string[] {
  return (text || "").match(/\s+|\S+/g) ?? [];
}

function pushToken(
  tokens: TextDiffToken[],
  type: TextDiffType,
  text: string,
): void {
  if (!text) {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.type === type) {
    last.text += text;
    return;
  }
  tokens.push({ type, text });
}

export function computeTextDiff(
  raw: string,
  polished: string,
): TextDiffResult {
  const before = tokenizeForDiff(raw);
  const after = tokenizeForDiff(polished);
  if (
    before.length > TEXT_DIFF_TOKEN_LIMIT ||
    after.length > TEXT_DIFF_TOKEN_LIMIT
  ) {
    return { tokens: [], limited: true };
  }

  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(
              table[(i + 1) * width + j]!,
              table[i * width + j + 1]!,
            );
    }
  }

  const tokens: TextDiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      pushToken(tokens, "same", before[i]!);
      i += 1;
      j += 1;
    } else if (
      table[(i + 1) * width + j]! >= table[i * width + j + 1]!
    ) {
      pushToken(tokens, "removed", before[i]!);
      i += 1;
    } else {
      pushToken(tokens, "added", after[j]!);
      j += 1;
    }
  }
  while (i < before.length) {
    pushToken(tokens, "removed", before[i]!);
    i += 1;
  }
  while (j < after.length) {
    pushToken(tokens, "added", after[j]!);
    j += 1;
  }
  return { tokens, limited: false };
}
