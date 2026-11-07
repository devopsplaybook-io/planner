import { describe, expect, it } from "vitest";
import {
  computeTextDiff,
  TEXT_DIFF_TOKEN_LIMIT,
  tokenizeForDiff,
} from "./textDiff";

function rendered(tokens: { type: string; text: string }[]) {
  return tokens
    .map((token) => {
      if (token.type === "removed") return `[-${token.text}-]`;
      if (token.type === "added") return `[+${token.text}+]`;
      return token.text;
    })
    .join("");
}

describe("computeTextDiff", () => {
  it("should return one unchanged run for identical texts", () => {
    const diff = computeTextDiff("hello world", "hello world");
    expect(diff.limited).toBe(false);
    expect(diff.tokens).toEqual([{ type: "same", text: "hello world" }]);
  });

  it("should mark added words", () => {
    const diff = computeTextDiff("hello", "hello big world");
    expect(rendered(diff.tokens)).toBe("hello[+ big world+]");
  });

  it("should mark removed words", () => {
    const diff = computeTextDiff("hello big world", "hello world");
    expect(rendered(diff.tokens)).toBe("hello [-big -]world");
  });

  it("should mark replacements and keep the surrounding text", () => {
    const diff = computeTextDiff("create the task", "Create the task.");
    expect(rendered(diff.tokens)).toBe(
      "[-create-][+Create+] the [-task-][+task.+]",
    );
  });

  it("should preserve whitespace between unchanged words", () => {
    const diff = computeTextDiff("one two three", "one three");
    const kept = diff.tokens
      .filter((token) => token.type !== "removed")
      .map((token) => token.text)
      .join("");
    expect(kept).toBe("one three");
  });

  it("should compare non-latin scripts", () => {
    const diff = computeTextDiff("bonjour 世界", "hello 世界");
    expect(rendered(diff.tokens)).toBe("[-bonjour-][+hello+] 世界");
  });

  it("should fall back to side-by-side above the token limit", () => {
    const long = Array.from({ length: TEXT_DIFF_TOKEN_LIMIT + 1 }, () => "x")
      .join(" ");
    const diff = computeTextDiff(long, "short");
    expect(diff.limited).toBe(true);
    expect(diff.tokens).toEqual([]);
  });

  it("should tokenize words and whitespace separately", () => {
    expect(tokenizeForDiff("a  b")).toEqual(["a", "  ", "b"]);
  });
});
