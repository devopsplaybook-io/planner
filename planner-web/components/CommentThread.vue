<template>
  <details class="compact-section" :open="comments.length > 0">
    <summary>
      Comments
      <span v-if="comments.length" class="count-badge">
        {{ comments.length }}
      </span>
    </summary>
    <div class="comments">
      <div v-for="comment in comments" :key="comment.id" class="comment">
        <header>
          <strong>{{ comment.userName || comment.userId }}</strong>
          <small>{{ formatDate(comment.dateCreated) }}</small>
          <div v-if="canModifyComment(comment)" class="comment-actions">
            <button
              class="comment-action-btn"
              aria-label="Edit comment"
              @click="startEdit(comment)"
            >
              <i class="bi bi-pencil" />
            </button>
            <button
              class="comment-action-btn danger"
              aria-label="Delete comment"
              :aria-busy="deletingId === comment.id"
              @click="remove(comment.id)"
            >
              <i class="bi bi-trash" />
            </button>
          </div>
        </header>
        <div v-if="editingId === comment.id" class="comment-edit-form">
          <textarea v-model="editingText" rows="2" />
          <div class="comment-edit-actions">
            <button class="secondary small-btn" @click="cancelEdit">
              Cancel
            </button>
            <button
              class="small-btn"
              :aria-busy="savingEdit"
              @click="saveEdit(comment.id)"
            >
              Save
            </button>
          </div>
        </div>
        <template v-else>
          <div
            class="comment-body markdown-body"
            :class="{
              'is-truncated': !expanded.has(comment.id),
              'is-faded': !expanded.has(comment.id) && overflowing.has(comment.id),
            }"
          >
            <div
              :ref="(el) => setBodyRef(comment.id, el)"
              class="comment-body-content"
              v-html="renderMarkdown(comment.text)"
            />
          </div>
          <button
            v-if="overflowing.has(comment.id)"
            class="expand-btn"
            @click="toggleExpand(comment.id)"
          >
            {{ expanded.has(comment.id) ? "Show less" : "Show more" }}
          </button>
        </template>
      </div>
    </div>
    <form class="add-comment" @submit.prevent="submitNew">
      <textarea
        v-model="newComment"
        placeholder="Add a comment... (Markdown supported)"
        rows="2"
        required
      />
      <button type="submit" :aria-busy="adding">Send</button>
    </form>
  </details>
</template>

<script setup>
import { renderMarkdown } from "../composables/useMarkdown";

const props = defineProps({
  comments: { type: Array, default: () => [] },
  // The dialogs own the store calls: each handler performs the operation,
  // surfaces its own errors and resolves to false when it did not go through,
  // so the thread can keep a draft or a pending delete after a failure.
  onAdd: { type: Function, default: null },
  onEdit: { type: Function, default: null },
  onDelete: { type: Function, default: null },
});

const authStore = useAuthStore();

const newComment = ref("");
const adding = ref(false);
const deletingId = ref("");
const editingId = ref("");
const editingText = ref("");
const savingEdit = ref(false);
const expanded = ref(new Set());
// Overflow detection: bodyEls holds the inner, unclipped content element of
// each comment; its height is the natural rendered height of the markdown
// (the outer .comment-body does the 2-line clip).
const bodyEls = new Map();
const overflowing = ref(new Set());
// A one-shot measurement races with dialog rendering: the <dialog> opens
// via showModal in a post-flush watcher, so content may still be
// display:none and report scrollHeight 0, hiding the expand button until
// something else re-measures. Observing each comment's content element
// re-measures whenever its box actually changes: dialog or <details>
// opening, image loading, text re-wrapping.
const resizeObserver = new ResizeObserver(measure);

// Belt-and-braces alongside the ResizeObserver: re-measure after the
// comments have rendered. The observer remains the source of truth — it
// re-measures on every real layout change (dialog opening, image loads).
// The stores push into the same array on add, so a reference watch alone
// would not fire; the watch has to be deep.
watch(
  () => props.comments,
  async () => {
    await nextTick();
    measure();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  resizeObserver.disconnect();
});

function canModifyComment(comment) {
  if (authStore.isAdmin) return true;
  return authStore.currentUser?.id === comment.userId;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

async function submitNew() {
  if (!props.onAdd) return;
  adding.value = true;
  try {
    if ((await props.onAdd(newComment.value)) !== false) {
      newComment.value = "";
    }
  } finally {
    adding.value = false;
  }
}

function startEdit(comment) {
  editingId.value = comment.id;
  editingText.value = comment.text;
}

function cancelEdit() {
  editingId.value = "";
  editingText.value = "";
}

async function saveEdit(commentId) {
  if (!editingText.value.trim()) return;
  savingEdit.value = true;
  try {
    if ((await props.onEdit(commentId, editingText.value)) !== false) {
      editingId.value = "";
      editingText.value = "";
    }
  } finally {
    savingEdit.value = false;
  }
}

async function remove(commentId) {
  if (!props.onDelete) return;
  deletingId.value = commentId;
  try {
    await props.onDelete(commentId);
  } finally {
    deletingId.value = "";
  }
}

function setBodyRef(commentId, el) {
  if (el) {
    bodyEls.set(commentId, el);
    resizeObserver.observe(el);
  } else {
    const prev = bodyEls.get(commentId);
    if (prev) resizeObserver.unobserve(prev);
    bodyEls.delete(commentId);
  }
}

// Detect which comments actually overflow the 2-line collapsed height.
// Measuring the rendered height is more reliable than counting characters:
// markdown blocks (lists, code fences, headings) render at very different
// heights for the same text length.
function measure() {
  const overflowed = new Set();
  for (const [commentId, el] of bodyEls) {
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 14;
    // line-height may compute as a unitless number ("1.5"), a px value or
    // "normal" — normalize it against the font size
    let lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || lineHeight < fontSize) {
      lineHeight = fontSize * 1.5;
    }
    if (el.scrollHeight > lineHeight * 2 + 1) {
      overflowed.add(commentId);
    }
  }
  overflowing.value = overflowed;
}

function toggleExpand(commentId) {
  const newSet = new Set(expanded.value);
  if (newSet.has(commentId)) {
    newSet.delete(commentId);
  } else {
    newSet.add(commentId);
  }
  expanded.value = newSet;
}
</script>

<style scoped>
.comments {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}

/* Comment items are plain divs on purpose: bare <article> is the design
   language's Card component and its "article > header" bleeds outside the
   card with negative margins, overlapping the section summary (base.css). */
.comment {
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.comment-body,
.comment-edit-form {
  margin-left: var(--space-sm);
  border-left: 3px solid var(--color-border);
  padding-left: var(--space-sm);
}

.comment header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.comment header strong {
  font-size: var(--text-md);
}

.comment-actions {
  display: flex;
  gap: var(--space-2xs);
  margin-left: auto;
}

.comment-action-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  padding: 0 var(--space-2xs);
  cursor: pointer;
  line-height: 1;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast);
}

.comment:hover .comment-action-btn {
  opacity: 1;
}

.comment-action-btn:hover {
  color: var(--color-primary-text);
}

.comment-action-btn.danger:hover {
  color: var(--color-danger);
}

.comment-edit-form {
  margin-top: var(--space-xs);
}

.comment-edit-form textarea {
  width: 100%;
  min-height: 60px;
  margin-bottom: var(--space-xs);
}

.comment-edit-actions {
  display: flex;
  gap: var(--space-xs);
  justify-content: flex-end;
}

.small-btn {
  padding: 0.1em 0.4em;
  font-size: var(--text-base);
}

/* Flatten heading sizes inside comment markdown so titles don't dominate */
.comment-body.markdown-body h1,
.comment-body.markdown-body h2,
.comment-body.markdown-body h3,
.comment-body.markdown-body h4,
.comment-body.markdown-body h5,
.comment-body.markdown-body h6 {
  margin-top: var(--space-sm);
  margin-bottom: var(--space-xs);
}

.comment-body.markdown-body h1 {
  font-size: 1.15em;
}
.comment-body.markdown-body h2 {
  font-size: 1.08em;
}
.comment-body.markdown-body h3 {
  font-size: 1.02em;
}
.comment-body.markdown-body h4 {
  font-size: 1em;
}

.comment-body {
  /* flow-root keeps child margins from collapsing out of the container,
     which previously bled into the comment header and expand button */
  display: flow-root;
  font-size: var(--text-md);
  line-height: 1.5;
  overflow-wrap: break-word;
  min-width: 0;
}

/* Deterministic 2-line clip: exactly 2 lines at line-height 1.5.
   -webkit-line-clamp is unreliable when the element contains block
   children (lists, pre, headings) — it mis-measures and lets content
   overlap neighboring elements. */
.comment-body.is-truncated {
  max-height: 3em;
  overflow: hidden;
}

/* Soften the clip into a fade so cut-off text reads as "there is more"
   instead of looking sliced. Only applied where the body really overflows:
   a comment that fits in two lines keeps a crisp bottom edge. */
.comment-body.is-truncated.is-faded {
  mask-image: linear-gradient(to bottom, #000 60%, transparent 100%);
}

/* The measured content lives one level deeper than .markdown-body's
   direct-child rules, so re-apply the tight first/last spacing here.
   line-height and flow-root are pinned on the content element itself so
   the expand-button threshold always matches the visible 2-line clip. */
.comment-body-content {
  display: flow-root;
  line-height: 1.5;
}

.comment-body-content > :first-child {
  margin-top: 0;
}

.comment-body-content > :last-child {
  margin-bottom: 0;
}

.expand-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: var(--text-sm);
  padding: 0;
  margin-top: var(--space-2xs);
  cursor: pointer;
  text-decoration: underline;
}

.expand-btn:hover {
  color: var(--color-primary-hover);
}

.add-comment {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  align-items: center;
}

/* Collapsible compact section chrome — copied from the dialogs so the
   component renders identically on its own: a parent's scoped rules cannot
   reach into a child component. */
.compact-section {
  margin-bottom: var(--space-sm);
  border: 1px solid
    var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.compact-section summary {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
  font-weight: var(--weight-semibold);
  font-size: var(--text-base);
  background: var(--color-surface);
  user-select: none;
  list-style: none;
}

.compact-section summary::-webkit-details-marker {
  display: none;
}

.compact-section summary::before {
  content: "▸";
  font-size: var(--text-sm);
  transition: transform var(--transition-fast);
  flex-shrink: 0;
}

.compact-section[open] summary::before {
  transform: rotate(90deg);
}

.compact-section[open] summary {
  border-bottom: 1px solid
    var(--color-border);
}

.compact-section > *:not(summary) {
  padding: 0 var(--space-sm);
}

.compact-section .comments {
  padding-top: var(--space-xs);
}

.compact-section .add-comment {
  padding: var(--space-xs) 0 var(--space-sm);
}

.count-badge {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
  padding: 0.05em 0.35em;
  border-radius: var(--radius-full);
  margin-left: auto;
}
</style>
