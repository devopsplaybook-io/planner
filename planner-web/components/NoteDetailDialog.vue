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
              <i class="bi bi-arrow-counterclockwise" />
            </button>
          </template>
          <details v-if="note" ref="advancedMenuEl" class="advanced-menu">
            <summary class="secondary" role="button" aria-label="Advanced">
              <i class="bi bi-three-dots" />
            </summary>
            <ul>
              <li>
                <a
                  href="#"
                  class="danger-item"
                  @click.prevent="openDeleteConfirm"
                >
                  <i class="bi bi-trash" /> Delete Note
                </a>
              </li>
            </ul>
          </details>
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

        <!-- Meta Info -->
        <section class="meta-section">
          <div class="meta-field">
            <strong>Project</strong>
            <ProjectSelect v-if="editing" v-model="editForm.projectId" />
            <span v-else>{{ projectName || note.projectId }}</span>
          </div>
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
        <CommentThread
          :comments="note.comments || []"
          :on-add="addComment"
          :on-edit="editComment"
          :on-delete="deleteComment"
        />
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
import { displayName } from "../utils/projectHierarchy";

const props = defineProps({
  noteId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => !!props.noteId);

const notesStore = useNotesStore();
const projectsStore = useProjectsStore();

const note = computed(() => notesStore.currentNote);
const loading = ref(false);
const showDeleteConfirm = ref(false);
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fileInput = ref(null);
const editing = ref(false);
const saving = ref(false);
const advancedMenuEl = ref(null);
const editForm = ref({ title: "", description: "", projectId: "" });
const authToken = computed(() => localStorage.getItem("token") || "");
const fullscreenImage = ref(null);

const projectName = computed(() => {
  const project = projectsStore.projects.find(
    (p) => p.id === note.value?.projectId,
  );
  return project ? displayName(project.name) : "";
});

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

function handleClose() {
  emit("close");
}

function startEdit() {
  if (!note.value) return;
  editForm.value = {
    title: note.value.title,
    description: note.value.description,
    projectId: note.value.projectId,
  };
  editing.value = true;
  // Fetch projects for the project picker
  projectsStore.fetchAll();
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
      projectId: editForm.value.projectId,
    });
    editing.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update note");
  } finally {
    saving.value = false;
  }
}

// CommentThread handlers: each returns false when the operation did not go
// through, so the thread keeps the draft or the pending delete.
async function addComment(text) {
  try {
    await notesStore.addComment(props.noteId, text);
    return true;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to add comment");
    return false;
  }
}

async function editComment(commentId, text) {
  try {
    await notesStore.updateComment(props.noteId, commentId, text);
    return true;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update comment");
    return false;
  }
}

async function deleteComment(commentId) {
  if (!confirm("Delete this comment?")) return false;
  try {
    await notesStore.deleteComment(props.noteId, commentId);
    return true;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete comment");
    return false;
  }
}

function closeAdvancedMenu() {
  advancedMenuEl.value?.removeAttribute("open");
}

function openDeleteConfirm() {
  closeAdvancedMenu();
  showDeleteConfirm.value = true;
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

.meta-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  padding: var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  /* The select dropdown overflows this section: without this, the global
     `dialog article section` scroll rule (base.css) clips it */
  overflow: visible;
  max-height: none;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.meta-field select {
  margin: 0;
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

.compact-section .attachments {
  padding-top: var(--space-xs);
}

.compact-section .add-attachment {
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
