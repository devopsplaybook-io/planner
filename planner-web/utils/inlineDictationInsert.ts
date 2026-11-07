/**
 * DOM helpers for inserting dictation text into an <input> or <textarea>.
 * Insertion goes through `document.execCommand("insertText")` when available
 * so the browser records a single native undo checkpoint; otherwise it falls
 * back to `setRangeText` plus a bubbling `input` event.
 */

export interface InsertedRange {
  start: number;
  end: number;
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isSingleLineField(field: TextField): boolean {
  return field.tagName === "INPUT";
}

function normalizeTextForField(field: TextField, text: string): string {
  if (isSingleLineField(field)) {
    // <input> values cannot contain newlines: collapse them to spaces
    return text.replace(/\r?\n/g, " ");
  }
  return text;
}

function readValue(field: TextField): string {
  return field.value ?? "";
}

function dispatchInput(field: TextField): void {
  const event = new Event("input", { bubbles: true });
  field.dispatchEvent(event);
}

function currentSelection(field: TextField): InsertedRange {
  const start = field.selectionStart ?? readValue(field).length;
  const end = field.selectionEnd ?? start;
  return { start, end };
}

export function readSelection(field: TextField): InsertedRange {
  return currentSelection(field);
}

/**
 * True when the field is attached, editable and laid out. Layout APIs are
 * unreliable in jsdom (empty rects), so an empty rect list is only treated
 * as hidden when the computed style explicitly hides the element.
 */
export function isTextFieldVisible(field: TextField | null | undefined): boolean {
  if (!field || !field.isConnected) {
    return false;
  }
  if (field.disabled || field.readOnly) {
    return false;
  }
  if (field.hidden) {
    return false;
  }
  if (isSingleLineField(field) && field.type === "hidden") {
    return false;
  }
  if (typeof field.getClientRects === "function") {
    const rects = field.getClientRects();
    if (!rects || rects.length === 0) {
      try {
        const style = window.getComputedStyle?.(field);
        if (style && (style.display === "none" || style.visibility === "hidden")) {
          return false;
        }
      } catch {
        // No layout engine: rely on the attribute checks above
      }
    }
  }
  return true;
}

/**
 * Inserts `text` at the current caret (replacing the selection) and returns
 * the inserted range. A single space is prefixed when the caret sits between
 * two non-whitespace characters.
 */
export function insertAtSelection(field: TextField, text: string): InsertedRange {
  const normalized = normalizeTextForField(field, text);
  const { start, end } = currentSelection(field);
  const value = readValue(field);
  const before = value.slice(start - 1, start);
  const after = value.slice(end, end + 1);
  const needsSpace =
    normalized.length > 0 &&
    before !== "" &&
    after !== "" &&
    !/\s/.test(before) &&
    !/\s/.test(after);
  const insertion = needsSpace ? ` ${normalized}` : normalized;

  try {
    field.focus();
    field.setSelectionRange(start, end);
    if (
      typeof document !== "undefined" &&
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, insertion)
    ) {
      const caret = field.selectionStart ?? start + insertion.length;
      // The tracked range excludes the optional prefix space so a later
      // polish patch cannot swallow the separator.
      return { start: caret - normalized.length, end: caret };
    }
  } catch {
    // Fall through to the programmatic insertion below
  }

  setValueRange(field, start, end, insertion);
  const offset = needsSpace ? 1 : 0;
  return { start: start + offset, end: start + offset + normalized.length };
}

/**
 * Replaces an exact range without creating a new native undo checkpoint
 * (the polish patch must be undoable together with the initial insertion).
 */
export function replaceRange(
  field: TextField,
  start: number,
  end: number,
  text: string,
): InsertedRange {
  const normalized = normalizeTextForField(field, text);
  const safeStart = Math.max(0, Math.min(start, readValue(field).length));
  const safeEnd = Math.max(safeStart, Math.min(end, readValue(field).length));
  setValueRange(field, safeStart, safeEnd, normalized);
  return { start: safeStart, end: safeStart + normalized.length };
}

function setValueRange(
  field: TextField,
  start: number,
  end: number,
  text: string,
): void {
  if (typeof field.setRangeText === "function") {
    field.setRangeText(text, start, end, "preserve");
  } else {
    const value = readValue(field);
    field.value = value.slice(0, start) + text + value.slice(end);
  }
  dispatchInput(field);
}
