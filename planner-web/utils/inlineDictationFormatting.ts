/**
 * Deterministic voice formatting for inline dictation. Pure string function:
 * no DOM, no LLM. Spoken commands are matched word by word (case
 * insensitive) and applied to the transcript before it is inserted into the
 * target field.
 *
 * Supported commands: "new paragraph", "new line", "bullet point"/"bullet",
 * "question mark", "comma", "period"/"full stop" and "scratch that" (removes
 * the last inserted phrase of the current dictation).
 */

interface CommandMatch {
  command: "paragraph" | "line" | "bullet" | "question" | "comma" | "period" | "scratch";
  words: number;
}

type TextCommand =
  | "paragraph"
  | "line"
  | "bullet"
  | "question"
  | "comma"
  | "period"
  | "scratch";

const SINGLE_WORD_COMMANDS: Record<string, TextCommand> = {
  bullet: "bullet",
  comma: "comma",
  period: "period",
};

const TWO_WORD_COMMANDS: Record<string, TextCommand> = {
  "new paragraph": "paragraph",
  "new line": "line",
  "bullet point": "bullet",
  "question mark": "question",
  "full stop": "period",
  "scratch that": "scratch",
};

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
}

function matchCommand(words: string[], index: number): CommandMatch | null {
  const current = normalizeWord(words[index] || "");
  const two = `${current} ${normalizeWord(words[index + 1] || "")}`;
  const twoCommand = TWO_WORD_COMMANDS[two];
  if (twoCommand) {
    return { command: twoCommand, words: 2 };
  }
  const singleCommand = SINGLE_WORD_COMMANDS[current];
  if (singleCommand) {
    return { command: singleCommand, words: 1 };
  }
  return null;
}

function trimTrailingWhitespace(value: string): string {
  return value.replace(/\s+$/, "");
}

function appendWord(out: string, word: string): string {
  if (!out) {
    return word;
  }
  if (out.endsWith("\n") || out.endsWith("- ")) {
    return out + word;
  }
  return `${out} ${word}`;
}

function appendNewline(out: string, count = 1): string {
  const trimmed = trimTrailingWhitespace(out);
  if (!trimmed) {
    return "";
  }
  return `${trimmed}${"\n".repeat(count)}`;
}

function appendBullet(out: string): string {
  const trimmed = trimTrailingWhitespace(out);
  if (!trimmed) {
    return "- ";
  }
  if (trimmed.endsWith("-")) {
    // Two bullet commands in a row: remember the empty bullet line
    return `${trimmed}\n- `;
  }
  return `${trimmed}\n- `;
}

function appendPunctuation(out: string, mark: string): string {
  const trimmed = trimTrailingWhitespace(out);
  return trimmed ? `${trimmed}${mark}` : mark;
}

function scratchLastPhrase(out: string): string {
  const boundaries = [".", "!", "?", ";", ",", "\n"];
  let boundaryIndex = -1;
  for (const boundary of boundaries) {
    boundaryIndex = Math.max(boundaryIndex, out.lastIndexOf(boundary));
  }
  if (boundaryIndex === -1) {
    return "";
  }
  return trimTrailingWhitespace(out.slice(0, boundaryIndex));
}

/**
 * Applies spoken punctuation/formatting commands to a raw transcript.
 * Ordinary words are preserved; commands are matched case-insensitively on
 * whole words.
 */
export function applyVoiceFormatting(transcript: string): string {
  if (!transcript) {
    return "";
  }
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  let out = "";
  let index = 0;
  while (index < words.length) {
    const match = matchCommand(words, index);
    if (!match) {
      out = appendWord(out, words[index] || "");
      index += 1;
      continue;
    }
    switch (match.command) {
      case "paragraph":
        out = appendNewline(out, 2);
        break;
      case "line":
        out = appendNewline(out, 1);
        break;
      case "bullet":
        out = appendBullet(out);
        break;
      case "question":
        out = appendPunctuation(out, "?");
        break;
      case "comma":
        out = appendPunctuation(out, ",");
        break;
      case "period":
        out = appendPunctuation(out, ".");
        break;
      case "scratch":
        out = scratchLastPhrase(out);
        break;
    }
    index += match.words;
  }
  return out.trim();
}
