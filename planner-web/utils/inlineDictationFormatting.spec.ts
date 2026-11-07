import { describe, expect, it } from "vitest";
import { applyVoiceFormatting } from "./inlineDictationFormatting";

describe("applyVoiceFormatting", () => {
  it("should return an empty string for an empty transcript", () => {
    expect(applyVoiceFormatting("")).toBe("");
    expect(applyVoiceFormatting("   ")).toBe("");
  });

  it("should leave ordinary words untouched", () => {
    expect(applyVoiceFormatting("call the plumber tomorrow")).toBe(
      "call the plumber tomorrow",
    );
  });

  it("should not turn regular words into commands", () => {
    expect(applyVoiceFormatting("a periodic check and a comma splice")).toBe(
      "a periodic check and a, splice",
    );
    expect(applyVoiceFormatting("the bullets are in the drawer")).toBe(
      "the bullets are in the drawer",
    );
  });

  it("should apply spoken punctuation", () => {
    expect(applyVoiceFormatting("hello world period")).toBe("hello world.");
    expect(applyVoiceFormatting("are you there question mark")).toBe(
      "are you there?",
    );
    expect(applyVoiceFormatting("one more comma then")).toBe("one more, then");
    expect(applyVoiceFormatting("done full stop")).toBe("done.");
  });

  it("should insert a new line", () => {
    expect(applyVoiceFormatting("first new line second")).toBe(
      "first\nsecond",
    );
  });

  it("should insert a paragraph break", () => {
    expect(applyVoiceFormatting("first new paragraph second")).toBe(
      "first\n\nsecond",
    );
  });

  it("should start bullets", () => {
    expect(applyVoiceFormatting("milk bullet eggs bullet bread")).toBe(
      "milk\n- eggs\n- bread",
    );
    expect(applyVoiceFormatting("bullet point milk")).toBe("- milk");
  });

  it("should match commands case-insensitively", () => {
    expect(applyVoiceFormatting("hello New Line World Period")).toBe(
      "hello\nWorld.",
    );
  });

  it("should drop command words across punctuation", () => {
    expect(applyVoiceFormatting("Hello, new line, World.")).toBe(
      "Hello,\nWorld.",
    );
  });

  it("should remove the last phrase with scratch that", () => {
    expect(applyVoiceFormatting("buy milk. call mom scratch that")).toBe(
      "buy milk",
    );
    expect(applyVoiceFormatting("one, two, three scratch that")).toBe(
      "one, two",
    );
  });

  it("should clear the inserted text when scratch that has no boundary", () => {
    expect(applyVoiceFormatting("something without punctuation scratch that")).toBe(
      "",
    );
  });

  it("should apply several commands in one transcript", () => {
    expect(
      applyVoiceFormatting(
        "shopping new line bullet milk comma two new paragraph thanks period",
      ),
    ).toBe("shopping\n- milk, two\n\nthanks.");
  });
});
