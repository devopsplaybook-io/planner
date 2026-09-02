<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="note-detail-dialog">
      <header class="dialog-header">
        <h3>Note Details</h3>
        <div class="dialog-actions">
          <button
            v-if="!editing"
            class="secondary icon-btn"
            aria-label="Edit"
            @click="startEdit"
          >
            <i class="bi bi-pencil" />
          </button>
          <template v-if="editing">
            <button
              class="icon-btn"
              :aria-busy="saving"
              aria-label="Save"
              @click="saveEdit"
            >
              <i class="bi bi-check" />
            </button>
            <button
              class="secondary icon-btn"
              aria-label="Cancel"
              @click="cancelEdit"
            >
              <i class="bi bi-x" />
            </button>
          </template>
          <button class="close-btn" aria-label="Close" @click="handleClose">
            ×
          </button>
        </div>
      </header>

      <section v-if="loading" class="loading-indicator" />

      <template v-else-if="note">
        <!-- Editable Fields -->
        <section class="edit-section">
          <label>
            Title
            <input
              v-if="editing"
              v-model="editForm.title"
              type="text"
              required
            />
            <h2 v-else>{{ note.title }}</h2>
          </label>
          <label>
            Description
            <textarea v-if="editing" v-model="editForm.description" rows="3" />
            <div
              v-else
              class="markdown-body"
              v-html="renderMarkdown(note.description) || 'No description'"
            />
          </label>
        </section>

        <!-- Labels -->
        <section v-if="note.labels && note.labels.length">
          <h4>Labels</h4>
          <div class="tag-list">
            <span v-for="l in note.labels" :key="l" class="label-tag">{{
              l
            }}</span>
          </div>
        </section>

        <!-- Attachments -->
        <details
          class="compact-section"
          :open="note.attachments && note.attachments.length > 0"
        >
          <summary>
            Attachments
            <span
              v-if="note.attachments && note.attachments.length"
              class="count-badge"
            >
              {{ note.attachments.length }}
            </span>
          </summary>
          <div
            v-if="note.attachments && note.attachments.length"
            class="attachments"
          >
            <div
              v-for="att in note.attachments"
              :key="att.id"
              class="attachment-item"
            >
              <div class="attachment-info">
                <template v-if="isImageFile(att.fileName)">
                  <img
                    :src="`/api/notes/${note.id}/attachments/${att.id}?inline=true&token=${authToken}`"
                    :alt="att.fileName"
                    class="attachment-preview"
                    @click="
                      fullscreenImage = `/api/notes/${note.id}/attachments/${att.id}?inline=true&token=${authToken}`
                    "
                  />
                </template>
                <a
                  :href="`/api/notes/${note.id}/attachments/${att.id}?token=${authToken}`"
                  target="_blank"
                  class="attachment-link"
                >
                  <i class="bi bi-paperclip" /> {{ att.fileName }}
                </a>
              </div>
              <button
                class="secondary small-btn"
                :aria-busy="deletingAttachmentId === att.id"
                @click="deleteAttachment(att.id)"
              >
                <i class="bi bi-x" />
              </button>
            </div>
          </div>
          <form class="add-attachment" @submit.prevent="uploadAttachment">
            <input ref="fileInput" type="file" class="file-input" />
            <button type="submit" :aria-busy="uploading">Upload</button>
          </form>
        </details>

        <!-- Comments -->
        <details
          class="compact-section"
          :open="note.comments && note.comments.length > 0"
        >
          <summary>
            Comments
            <span
              v-if="note.comments && note.comments.length"
              class="count-badge"
            >
              {{ note.comments.length }}
            </span>
          </summary>
          <div class="comments">
            <div
              v-for="comment in note.comments || []"
              :key="comment.id"
              class="comment"
            >
              <header>
                <strong>{{ comment.userName || comment.userId }}</strong>
                <small>{{ formatDate(comment.dateCreated) }}</small>
              </header>
              <p>{{ comment.text }}</p>
            </div>
          </div>
          <form class="add-comment" @submit.prevent="addComment">
            <input
              v-model="newComment"
              type="text"
              placeholder="Add a comment..."
              required
            />
            <button type="submit" :aria-busy="submitting">Send</button>
          </form>
        </details>

        <!-- Delete -->
        <section>
          <button class="contrast" @click="showDeleteConfirm = true">
            <i class="bi bi-trash" /> Delete Note
          </button>
        </section>
      </template>

      <!-- Fullscreen Image Viewer -->
      <div
        v-if="fullscreenImage"
        class="fullscreen-overlay"
        @click="fullscreenImage = null"
      >
        <button
          class="fullscreen-close"
          aria-label="Close"
          @click.stop="fullscreenImage = null"
        >
          ×
        </button>
        <img :src="fullscreenImage" class="fullscreen-image" @click.stop />
      </div>

      <!-- Delete Confirmation -->
      <dialog
        ref="deleteDialogEl"
        class="inner-dialog"
        @close="showDeleteConfirm = false"
      >
        <article>
          <header><h3>Delete Note</h3></header>
          <p>Are you sure you want to delete "{{ note?.title }}"?</p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showDeleteConfirm = false">
              Cancel
            </button>
            <button class="contrast" :aria-busy="deleting" @click="deleteNote">
              Delete
            </button>
          </footer>
        </article>
      </dialog>
    </article>
  </dialog>
</template>

<script setup>
import { renderMarkdown } from "../composables/useMarkdown";

const props = defineProps({
  noteId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => !!props.noteId);

const notesStore = useNotesStore();

const note = computed(() => notesStore.currentNote);
const loading = ref(false);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fileInput = ref(null);
const editing = ref(false);
const saving = ref(false);
const editForm = ref({ title: "", description: "" });
const authToken = computed(() => localStorage.getItem("token") || "");
const fullscreenImage = ref(null);

watch(
  () => props.noteId,
  async (newId) => {
    if (newId) {
      loading.value = true;
      editing.value = false;
      try {
        await notesStore.fetchById(newId);
      } catch {
        // Error fetching note
      } finally {
        loading.value = false;
      }
    } else {
      notesStore.currentNote = null;
    }
  },
  { immediate: true },
);

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

function handleClose() {
  emit("close");
}

function startEdit() {
  if (!note.value) return;
  editForm.value = {
    title: note.value.title,
    description: note.value.description,
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!note.value) return;
  saving.value = true;
  try {
    await notesStore.update(props.noteId, {
      title: editForm.value.title,
      description: editForm.value.description,
    });
    editing.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update note");
  } finally {
    saving.value = false;
  }
}

async function addComment() {
  submitting.value = true;
  try {
    await notesStore.addComment(props.noteId, newComment.value);
    newComment.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to add comment");
  } finally {
    submitting.value = false;
  }
}

async function deleteNote() {
  deleting.value = true;
  try {
    await notesStore.remove(props.noteId);
    showDeleteConfirm.value = false;
    emit("close");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete note");
  } finally {
    deleting.value = false;
  }
}

async function uploadAttachment() {
  const input = fileInput.value;
  if (!input || !input.files || !input.files[0]) return;
  uploading.value = true;
  try {
    await notesStore.uploadAttachment(props.noteId, input.files[0]);
    input.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to upload file");
  } finally {
    uploading.value = false;
  }
}

function isImageFile(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
    "avif",
  ].includes(ext || "");
}

async function deleteAttachment(attachmentId) {
  deletingAttachmentId.value = attachmentId;
  try {
    await notesStore.deleteAttachment(props.noteId, attachmentId);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete attachment");
  } finally {
    deletingAttachmentId.value = "";
  }
}
</script>

<style scoped>
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}

.dialog-header h3 {
  margin: 0;
  font-size: var(--text-lg);
}

.dialog-actions {
  display: flex;
  gap: calc(var(--space-2xs) * 1.5);
  align-items: center;
}

.icon-btn,
.close-btn {
  padding: 0.25em 0.5em;
  font-size: var(--text-lg);
  line-height: 1;
  min-width: auto;
  width: auto;
}

.close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.7;
}

.close-btn:hover {
  opacity: 1;
}

.edit-section {
  margin-bottom: var(--space-md);
}

.edit-section label {
  display: block;
  margin-bottom: var(--space-sm);
}

.edit-section label h2 {
  margin: 0;
  font-size: var(--text-xl);
}

.edit-section textarea {
  min-height: 60px;
}

section {
  margin-bottom: var(--space-md);
}

section h4 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
}

.tag-list {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

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

.comment p {
  margin: 0;
  font-size: var(--text-md);
}

.add-comment,
.add-attachment {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  align-items: center;
}

.attachments {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.attachment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.attachment-link {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.attachment-link:hover {
  text-decoration: underline;
}

.attachment-info {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.attachment-preview {
  max-width: 60px;
  max-height: 60px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.small-btn {
  padding: 0.1em 0.4em;
  font-size: var(--text-base);
}

.inner-dialog article footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}

/* Collapsible compact sections */
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

.compact-section .attachments,
.compact-section .comments {
  padding-top: var(--space-xs);
}

.compact-section .add-attachment,
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

/* Fullscreen image viewer */
.fullscreen-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.fullscreen-image {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  cursor: default;
  border-radius: var(--radius-sm);
}

.fullscreen-close {
  position: fixed;
  top: var(--space-md);
  right: var(--space-md);
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 2.5em;
  height: 2.5em;
  font-size: var(--text-2xl);
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fullscreen-close:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
