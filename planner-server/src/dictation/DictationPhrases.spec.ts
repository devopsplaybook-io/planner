import {
  MatchCommandPhrase,
  NormalizePhraseInput,
  NormalizePhraseText,
} from "./DictationPhrases";

function phrase(
  id: string,
  text: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    phrase: text,
    normalizedPhrase: NormalizePhraseText(text),
    projectId: "project-1",
    templateId: null,
    labels: [],
    dateCreated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("NormalizePhraseText", () => {
  it("should lower-case and strip accents", () => {
    expect(NormalizePhraseText("Nouveau Bug")).toBe("nouveau bug");
    expect(NormalizePhraseText("Résumé de réunion")).toBe("resume de reunion");
  });

  it("should collapse punctuation and whitespace", () => {
    expect(NormalizePhraseText("  new   bug-report!! ")).toBe(
      "new bug report",
    );
  });

  it("should return an empty string for punctuation-only input", () => {
    expect(NormalizePhraseText("???")).toBe("");
  });
});

describe("NormalizePhraseInput", () => {
  it("should trim and collapse the stored display phrase", () => {
    expect(NormalizePhraseInput("  new   bug report ")).toEqual({
      phrase: "new bug report",
      normalizedPhrase: "new bug report",
    });
  });

  it("should reject empty, non-string and too-long input", () => {
    expect(NormalizePhraseInput("")).toBeNull();
    expect(NormalizePhraseInput("   ")).toBeNull();
    expect(NormalizePhraseInput("???")).toBeNull();
    expect(NormalizePhraseInput(42)).toBeNull();
    expect(NormalizePhraseInput("x".repeat(101))).toBeNull();
  });
});

describe("MatchCommandPhrase", () => {
  it("should match a prefix at a word boundary and return the remainder", () => {
    const match = MatchCommandPhrase("new bug report Login is broken", [
      phrase("p1", "new bug report"),
    ]);
    expect(match?.phrase.id).toBe("p1");
    expect(match?.remainder).toBe("Login is broken");
  });

  it("should not match in the middle of a word", () => {
    expect(
      MatchCommandPhrase("renew bug report", [phrase("p1", "new bug")]),
    ).toBeNull();
  });

  it("should be accent- and case-insensitive", () => {
    const match = MatchCommandPhrase("RÉSUMÉ de réunion budget", [
      phrase("p1", "resume de reunion"),
    ]);
    expect(match?.phrase.id).toBe("p1");
    expect(match?.remainder).toBe("budget");
  });

  it("should prefer the longest matching phrase", () => {
    const match = MatchCommandPhrase("new bug report urgent", [
      phrase("short", "new bug"),
      phrase("long", "new bug report"),
    ]);
    expect(match?.phrase.id).toBe("long");
    expect(match?.remainder).toBe("urgent");
  });

  it("should break equal-length ties with the newest phrase", () => {
    const match = MatchCommandPhrase("new bug report", [
      phrase("old", "new bug report", {
        dateCreated: "2026-01-01T00:00:00.000Z",
      }),
      phrase("new", "new bug report", {
        dateCreated: "2026-06-01T00:00:00.000Z",
      }),
    ]);
    expect(match?.phrase.id).toBe("new");
  });

  it("should match the whole transcript with an empty remainder", () => {
    const match = MatchCommandPhrase("new bug report", [
      phrase("p1", "new bug report"),
    ]);
    expect(match?.remainder).toBe("");
  });

  it("should return null for empty input or no phrase", () => {
    expect(MatchCommandPhrase("", [phrase("p1", "new bug")])).toBeNull();
    expect(MatchCommandPhrase("hello", [])).toBeNull();
    expect(
      MatchCommandPhrase("hello", [phrase("p1", "different phrase")]),
    ).toBeNull();
  });
});
