// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  insertAtSelection,
  isTextFieldVisible,
  readSelection,
  replaceRange,
} from "./inlineDictationInsert";

function makeInput(value = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  document.body.appendChild(input);
  return input;
}

function makeTextarea(value = ""): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  document.body.appendChild(textarea);
  return textarea;
}

function stubExecCommand(supported = true) {
  const exec = vi.fn(
    (_command: string, _showUi: boolean, text?: string) => {
      if (!supported) {
        return false;
      }
      const field = document.activeElement as HTMLInputElement;
      field.setRangeText(text ?? "", field.selectionStart ?? 0, field.selectionEnd ?? 0, "end");
      return true;
    },
  );
  Object.defineProperty(document, "execCommand", {
    value: exec,
    configurable: true,
  });
  return exec;
}

afterEach(() => {
  document.body.replaceChildren();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
  vi.restoreAllMocks();
});

describe("inlineDictationInsert", () => {
  it("should insert text at the caret", () => {
    const input = makeInput("hello world");
    input.setSelectionRange(5, 5);

    const range = insertAtSelection(input, " there");

    expect(input.value).toBe("hello there world");
    expect(range).toEqual({ start: 5, end: 11 });
  });

  it("should replace the current selection", () => {
    const input = makeInput("hello world");
    input.setSelectionRange(6, 11);

    insertAtSelection(input, "there");

    expect(input.value).toBe("hello there");
  });

  it("should add a separating space between two words", () => {
    const input = makeInput("foobar");
    input.setSelectionRange(3, 3);

    const range = insertAtSelection(input, "X");

    expect(input.value).toBe("foo Xbar");
    // The tracked range excludes the separator space
    expect(range).toEqual({ start: 4, end: 5 });
    expect(input.value.slice(range.start, range.end)).toBe("X");
  });

  it("should use execCommand when available (one undo checkpoint)", () => {
    const exec = stubExecCommand(true);
    const input = makeInput("hello");
    input.setSelectionRange(5, 5);

    insertAtSelection(input, " world");

    expect(exec).toHaveBeenCalledWith("insertText", false, " world");
    expect(input.value).toBe("hello world");
    expect(input.value).not.toBe("hello world world");
  });

  it("should fall back to setRangeText and dispatch a bubbling input event", () => {
    stubExecCommand(false);
    const input = makeInput("hello");
    input.setSelectionRange(5, 5);
    const onInput = vi.fn();
    document.body.addEventListener("input", onInput);

    insertAtSelection(input, "!");

    expect(input.value).toBe("hello!");
    expect(onInput).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("input", onInput);
  });

  it("should collapse newlines for a single-line input", () => {
    stubExecCommand(false);
    const input = makeInput("a");
    input.setSelectionRange(1, 1);

    insertAtSelection(input, "b\nc");

    expect(input.value).toBe("ab c");
  });

  it("should keep newlines in a textarea", () => {
    stubExecCommand(false);
    const textarea = makeTextarea("a");
    textarea.setSelectionRange(1, 1);

    insertAtSelection(textarea, "b\nc");

    expect(textarea.value).toBe("ab\nc");
  });

  it("should replace an exact range and dispatch input", () => {
    const textarea = makeTextarea("hello wrld");
    const onInput = vi.fn();
    textarea.addEventListener("input", onInput);

    const range = replaceRange(textarea, 6, 10, "world");

    expect(textarea.value).toBe("hello world");
    expect(range).toEqual({ start: 6, end: 11 });
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it("should clamp a replacement range to the value length", () => {
    const input = makeInput("hi");
    const range = replaceRange(input, 10, 20, "!");
    expect(input.value).toBe("hi!");
    expect(range).toEqual({ start: 2, end: 3 });
  });

  it("should read the selection", () => {
    const input = makeInput("abcdef");
    input.setSelectionRange(2, 4);
    expect(readSelection(input)).toEqual({ start: 2, end: 4 });
  });

  it("should report disabled and read-only fields as not visible", () => {
    const disabled = makeInput("x");
    disabled.disabled = true;
    expect(isTextFieldVisible(disabled)).toBe(false);

    const readOnly = makeInput("x");
    readOnly.readOnly = true;
    expect(isTextFieldVisible(readOnly)).toBe(false);
  });

  it("should report detached and hidden fields as not visible", () => {
    const detached = document.createElement("input");
    expect(isTextFieldVisible(detached)).toBe(false);

    const hidden = makeInput("x");
    hidden.hidden = true;
    expect(isTextFieldVisible(hidden)).toBe(false);

    const hiddenType = makeInput("x");
    hiddenType.type = "hidden";
    expect(isTextFieldVisible(hiddenType)).toBe(false);
  });

  it("should report an attached, editable field as visible", () => {
    expect(isTextFieldVisible(makeInput("x"))).toBe(true);
    expect(isTextFieldVisible(null)).toBe(false);
  });
});
