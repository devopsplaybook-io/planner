/**
 * localStorage-backed comment drafts. All keys share the "planner." prefix;
 * add and edit drafts live in distinct namespaces so they never collide:
 *
 *   planner.commentDraft.task.<taskId>
 *   planner.commentDraft.task.<taskId>.edit.<commentId>
 *   planner.commentDraft.note.<noteId>
 *   planner.commentDraft.note.<noteId>.edit.<commentId>
 *
 * Writes are immediate (non-debounced) so a crash or reload loses nothing.
 * Every access is guarded: private browsing or a full storage degrades to
 * "no draft" instead of throwing.
 */
export function loadCommentDraft(key: string | null | undefined): string {
  if (!key) return "";
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function saveCommentDraft(
  key: string | null | undefined,
  text: string,
): void {
  if (!key) return;
  try {
    if (text) {
      localStorage.setItem(key, text);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: drafts simply don't persist
  }
}

export function clearCommentDraft(key: string | null | undefined): void {
  saveCommentDraft(key, "");
}
