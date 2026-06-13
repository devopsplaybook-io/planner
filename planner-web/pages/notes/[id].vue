<template>
  <div class="note-detail">
    <div v-if="loading" class="loading-indicator" />

    <template v-else-if="note">
      <header class="detail-header">
        <div>
          <a href="#" class="back-link" @click.prevent="goBack"
            ><i class="bi bi-arrow-left" /> Notes</a
          >
          <hgroup>
            <h1 v-if="!editing">{{ note.title }}</h1>
            <input
              v-else
              v-model="editForm.title"
              type="text"
              class="edit-title-input"
              required
            />
          </hgroup>
        </div>
        <div class="header-actions">
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
          <button class="secondary" @click="showDeleteConfirm = true">
            <i class="bi bi-trash" />
          </button>
        </div>
      </header>

      <!-- Description -->
      <section>
        <textarea
          v-if="editing"
          v-model="editForm.description"
          class="edit-description-input"
          rows="8"
        />
        <p v-else class="note-description">
          {{ note.description || "No description" }}
        </p>
      </section>

      <!-- Labels -->
      <section v-if="note.labels.length">
        <div class="labels">
          <span v-for="l in note.labels" :key="l" class="label-tag">{{
            l
          }}</span>
        </div>
      </section>

      <!-- Attachments -->
      <section v-if="note.attachments.length">
        <h2>Attachments ({{ note.attachments.length }})</h2>
        <div class="attachments">
          <div
            v-for="att in note.attachments"
            :key="att.id"
            class="attachment-item"
          >
            <div class="attachment-info">
              <template v-if="isImageFile(att.fileName)">
                <img
                  :src="attachmentUrl(att.id, true)"
                  :alt="att.fileName"
                  class="attachment-preview"
                  @click="openPreview(att.id)"
                />
              </template>
              <a
                :href="attachmentUrl(att.id)"
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

      <!-- Image Preview Dialog -->
      <dialog
        :open="!!previewImageId"
        class="image-preview-dialog"
        @click="closePreview"
      >
        <article v-if="previewImageId" @click.stop>
          <header>
            <button class="close-btn" @click="closePreview">
              <i class="bi bi-x" />
            </button>
          </header>
          <img
            :src="attachmentUrl(previewImageId, true)"
            class="preview-image"
          />
        </article>
      </dialog>

      <section>
        <h2>Add Attachment</h2>
        <form class="add-attachment" @submit.prevent="uploadAttachment">
          <input ref="fileInput" type="file" class="file-input" />
          <button type="submit" :aria-busy="uploading">Upload</button>
        </form>
      </section>

      <!-- Comments -->
      <section>
        <h2>Comments ({{ note.comments.length }})</h2>
        <div class="comments">
          <article
            v-for="comment in note.comments"
            :key="comment.id"
            class="comment"
          >
            <header>
              <strong>{{ comment.userName || comment.userId }}</strong>
              <small>{{ formatDate(comment.dateCreated) }}</small>
            </header>
            <p>{{ comment.text }}</p>
          </article>
          <div v-if="note.comments.length === 0" class="empty-state">
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
    </template>

    <!-- Delete Confirmation -->
    <dialog :open="showDeleteConfirm">
      <article>
        <header>
          <h3>Delete Note</h3>
        </header>
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
  </div>
</template>

<script setup>
const notesStore = useNotesStore();
const router = useRouter();
const route = useRoute();

const note = computed(() => notesStore.currentNote);
const loading = ref(true);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const previewImageId = ref(null);

function openPreview(attachmentId) {
  previewImageId.value = attachmentId;
}

function closePreview() {
  previewImageId.value = null;
}
const fileInput = ref(null);

// Edit mode
const editing = ref(false);
const saving = ref(false);
const editForm = ref({ title: "", description: "" });

function goBack() {
  const back = window.history.state?.back;
  if (back) {
    router.back();
  } else {
    router.push("/notes");
  }
}

onMounted(async () => {
  try {
    await notesStore.fetchById(route.params.id);
  } catch {
    goBack();
  } finally {
    loading.value = false;
  }
});

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
    await notesStore.update(route.params.id, {
      title: editForm.value.title,
      description: editForm.value.description,
    });
    editing.value = false;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update note");
  } finally {
    saving.value = false;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

async function addComment() {
  submitting.value = true;
  try {
    await notesStore.addComment(route.params.id, newComment.value);
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
    await notesStore.remove(route.params.id);
    goBack();
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete note");
  } finally {
    deleting.value = false;
    showDeleteConfirm.value = false;
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

function attachmentUrl(attachmentId, inline = false) {
  const base = `/api/notes/${note.value.id}/attachments/${attachmentId}`;
  const token = localStorage.getItem("token");
  const params = new URLSearchParams();
  if (inline) params.set("inline", "true");
  if (token) params.set("token", token);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function uploadAttachment() {
  const input = fileInput.value;
  if (!input || !input.files || !input.files[0]) return;
  uploading.value = true;
  try {
    await notesStore.uploadAttachment(route.params.id, input.files[0]);
    input.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to upload file");
  } finally {
    uploading.value = false;
  }
}

async function deleteAttachment(attachmentId) {
  deletingAttachmentId.value = attachmentId;
  try {
    await notesStore.deleteAttachment(route.params.id, attachmentId);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete attachment");
  } finally {
    deletingAttachmentId.value = "";
  }
}
</script>

<style scoped>
.back-link {
  text-decoration: none;
  font-size: var(--text-md);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.header-actions {
  display: flex;
  gap: var(--space-sm);
}

.note-description {
  white-space: pre-wrap;
  line-height: var(--leading-relaxed);
}

.edit-title-input {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  margin: 0;
}

.edit-description-input {
  width: 100%;
  min-height: 120px;
  font-family: inherit;
  resize: vertical;
}

.labels {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
  margin-bottom: var(--space-md);
}

section {
  margin-bottom: var(--space-lg);
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

.add-comment {
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

.add-attachment {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  align-items: center;
}

.image-preview-dialog {
  border: none;
  padding: 0;
  background: transparent;
}

.image-preview-dialog::backdrop {
  background: rgba(0, 0, 0, 0.7);
}

.image-preview-dialog article {
  margin: 0;
  padding: var(--space-sm);
  max-width: 90vw;
  max-height: 90vh;
}

.image-preview-dialog article header {
  display: flex;
  justify-content: flex-end;
  padding: 0;
  margin-bottom: var(--space-xs);
}

.image-preview-dialog .close-btn {
  background: none;
  border: none;
  font-size: var(--text-2xl);
  cursor: pointer;
  padding: 0;
  line-height: var(--leading-none);
}

.preview-image {
  display: block;
  max-width: 80vw;
  max-height: 75vh;
  width: auto;
  height: auto;
  object-fit: contain;
  margin: 0 auto;
}
</style>
