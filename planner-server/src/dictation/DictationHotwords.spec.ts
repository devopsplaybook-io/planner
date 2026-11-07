import {
  ComposeHotwordPrompt,
  HOTWORDS_PROMPT_MAX_CHARS,
} from "./DictationHotwords";

describe("ComposeHotwordPrompt", () => {
  it("should return null when there is no term", () => {
    expect(ComposeHotwordPrompt([], [], 50)).toBeNull();
    expect(ComposeHotwordPrompt([], [""], 50)).toBeNull();
    expect(ComposeHotwordPrompt([], [], 0)).toBeNull();
  });

  it("should list project terms before personal terms", () => {
    const prompt = ComposeHotwordPrompt(["Planner"], ["Kubernetes"], 50);
    expect(prompt).toBe(
      "Vocabulary (names and jargon that may appear in the audio; keep their spelling): Planner, Kubernetes.",
    );
  });

  it("should dedupe case-insensitively and keep the first casing", () => {
    const prompt = ComposeHotwordPrompt(
      ["Planner", "KUBERNETES"],
      ["planner", "Kubernetes", "ArgoCD"],
      50,
    );
    expect(prompt).toContain("Planner, KUBERNETES, ArgoCD.");
    expect(prompt?.match(/planner/gi)).toHaveLength(1);
  });

  it("should cap the number of terms", () => {
    const prompt = ComposeHotwordPrompt(
      ["alpha", "bravo", "charlie", "delta"],
      [],
      2,
    );
    expect(prompt).toContain(": alpha, bravo.");
    expect(prompt).not.toContain("charlie");
  });

  it("should sanitize control characters and collapse whitespace", () => {
    const prompt = ComposeHotwordPrompt(["  Foo\u0000Bar ", "Baz\n\tQux"], [], 5);
    expect(prompt).toContain("Foo Bar, Baz Qux.");
  });

  it("should stay within the prompt character budget", () => {
    const terms = Array.from(
      { length: 100 },
      (_, index) => `term${index}-${"x".repeat(25)}`,
    );
    const prompt = ComposeHotwordPrompt([], terms, 50);
    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeLessThanOrEqual(HOTWORDS_PROMPT_MAX_CHARS);
    expect(prompt!.endsWith(".")).toBe(true);
  });
});
