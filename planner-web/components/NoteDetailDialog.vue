<template>
  <dialog :open="!!noteId">
    <article class="note-detail-dialog">
      <header class="dialog-header">
        <h3>Note Details</h3>
        <div class="dialog-actions">
          <button v-if="!editing" class="secondary" @click="startEdit">
            <i class="bi bi-pencil" /> Edit
          </button>
          <template v-if="editing">
            <button :aria-busy="saving" @click="saveEdit">
              <i class="bi bi-check" /> Save
            </button>
            <button class="secondary" @click="cancelEdit">
              <i class="bi bi-x" /> Cancel
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
        <section v-if="note.attachments && note.attachments.length">
          <h4>Attachments ({{ note.attachments.length }})</h4>
          <div class="attachments">
            <div
              v-for="att in note.attachments"
              :key="att.id"
              class="attachment-item"
            >
              <div class="attachment-info">
                <template v-if="isImageFile(att.fileName)">
                  <img
                    :src="`/api/notes/${note.id}/attachments/${att.id}?inline=true`"
                    :alt="att.fileName"
                    class="attachment-preview"
                  />
                </template>
                <a
                  :href="`/api/notes/${note.id}/attachments/${att.id}`"
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
        </section>

        <section>
          <h4>Add Attachment</h4>
          <form class="add-attachment" @submit.prevent="uploadAttachment">
            <input ref="fileInput" type="file" class="file-input" />
            <button type="submit" :aria-busy="uploading">Upload</button>
          </form>
        </section>

        <!-- Comments -->
        <section>
          <h4>Comments ({{ note.comments ? note.comments.length : 0 }})</h4>
          <div class="comments">
            <article
              v-for="comment in note.comments || []"
              :key="comment.id"
              class="comment"
            >
              <header>
                <strong>{{ comment.userName || comment.userId }}</strong>
                <small>{{ formatDate(comment.dateCreated) }}</small>
              </header>
              <p>{{ comment.text }}</p>
            </article>
            <div
              v-if="!note.comments || note.comments.length === 0"
              class="empty-state"
            >
              No comments
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
        </section>

        <!-- Delete -->
        <section>
          <button class="contrast" @click="showDeleteConfirm = true">
            <i class="bi bi-trash" /> Delete Note
          </button>
        </section>
      </template>

      <!-- Delete Confirmation -->
      <dialog :open="showDeleteConfirm" class="inner-dialog">
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

const notesStore = useNotesStore();

const note = computed(() => notesStore.currentNote);
const loading = ref(false);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fileInput = ref(null);
const editing = ref(false);
const saving = ref(false);
const editForm = ref({ title: "", description: "" });

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
}

.dialog-header h3 {
  margin: 0;
}

.dialog-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.edit-section {
  margin-bottom: var(--space-lg);
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
  margin-bottom: var(--space-lg);
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

.comment {
  padding: var(--space-xs) var(--space-sm);
}

.comment header {
  display: flex;
  justify-content: space-between;
  padding: 0;
  height: auto;
  margin-bottom: var(--space-xs);
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
  background: var(--pico-card-background-color);
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
</style>
