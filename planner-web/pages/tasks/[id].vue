<template>
  <div class="task-detail">
    <div v-if="loading" class="loading-indicator" />

    <template v-else-if="task">
      <header class="detail-header">
        <div>
          <a href="#" class="back-link" @click.prevent="goBack"
            ><i class="bi bi-arrow-left" /> Tasks</a
          >
          <hgroup>
            <h1 v-if="!editing">{{ task.title }}</h1>
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

      <!-- Editable Fields -->
      <section class="edit-section">
        <label v-if="editing">
          Title
          <input v-model="editForm.title" type="text" required />
        </label>
        <label>
          Description
          <textarea v-if="editing" v-model="editForm.description" rows="3" />
          <p v-else>{{ task.description || "No description" }}</p>
        </label>
      </section>

      <!-- Meta Info -->
      <section class="meta-section">
        <div class="meta-field">
          <strong>Status</strong>
          <select v-if="editing" v-model="editForm.status">
            <option v-for="s in availableStatuses" :key="s" :value="s">
              {{ s }}
            </option>
          </select>
          <span v-else class="status-badge">{{ task.status }}</span>
        </div>
        <div class="meta-field">
          <strong>Priority</strong>
          <select v-if="editing" v-model="editForm.priority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <span v-else :class="'priority-' + task.priority">
            <i class="bi bi-flag" /> {{ task.priority }}
          </span>
        </div>
        <div class="meta-field">
          <strong>Due date</strong>
          <input v-if="editing" v-model="editForm.dueDate" type="date" />
          <span v-else>{{ task.dueDate || "No due date" }}</span>
        </div>
        <div v-if="task.assignees.length" class="meta-field">
          <strong>Assignees</strong>
          <div class="assignee-list">
            <span
              v-for="a in task.assignees"
              :key="a.userId"
              class="assignee-tag"
              >{{ a.userName || a.userId }}</span
            >
          </div>
        </div>
        <div v-if="task.labels.length" class="meta-field">
          <strong>Labels</strong>
          <div class="label-list">
            <span v-for="l in task.labels" :key="l" class="label-tag">{{
              l
            }}</span>
          </div>
        </div>
      </section>

      <!-- Checklist -->
      <section>
        <h2>Checklist</h2>
        <div v-if="task.checklist.length" class="checklist">
          <label
            v-for="(item, idx) in task.checklist"
            :key="idx"
            class="checklist-item"
          >
            <input
              type="checkbox"
              :checked="item.done"
              @change="toggleChecklist(idx)"
            />
            <span :class="{ done: item.done }">{{ item.text }}</span>
          </label>
        </div>
        <div class="add-checklist-item">
          <input
            v-model="newChecklistText"
            type="text"
            placeholder="Add checklist item..."
            @keyup.enter="addChecklistItem"
          />
          <button :aria-busy="savingChecklist" @click="addChecklistItem">
            Add
          </button>
        </div>
      </section>

      <!-- Attachments -->
      <section v-if="task.attachments.length">
        <h2>Attachments ({{ task.attachments.length }})</h2>
        <div class="attachments">
          <div
            v-for="att in task.attachments"
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
        <h2>Comments ({{ task.comments.length }})</h2>
        <div class="comments">
          <article
            v-for="comment in task.comments"
            :key="comment.id"
            class="comment"
          >
            <header>
              <strong>{{ comment.userName || comment.userId }}</strong>
              <small>{{ formatDate(comment.dateCreated) }}</small>
            </header>
            <p>{{ comment.text }}</p>
          </article>
          <div v-if="task.comments.length === 0" class="empty-state">
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
          <i class="bi bi-trash" /> Delete Task
        </button>
      </section>
    </template>

    <!-- Delete Confirmation -->
    <dialog :open="showDeleteConfirm">
      <article>
        <header>
          <h3>Delete Task</h3>
        </header>
        <p>Are you sure you want to delete "{{ task?.title }}"?</p>
        <footer class="dialog-footer">
          <button class="secondary" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button class="contrast" :aria-busy="deleting" @click="deleteTask">
            Delete
          </button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const router = useRouter();
const route = useRoute();

const task = computed(() => tasksStore.currentTask);
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
const newChecklistText = ref("");
const savingChecklist = ref(false);

// Edit mode
const editing = ref(false);
const saving = ref(false);
const editForm = ref({
  title: "",
  description: "",
  status: "",
  priority: "",
  dueDate: "",
});

const availableStatuses = computed(() => {
  if (!task.value) return ["To Do", "In Progress", "Done"];
  const project = projectsStore.projects.find(
    (p) => p.id === task.value.projectId,
  );
  return project?.statuses || ["To Do", "In Progress", "Done"];
});

function goBack() {
  const back = window.history.state?.back;
  if (back) {
    router.back();
  } else {
    router.push("/tasks");
  }
}

function startEdit() {
  if (!task.value) return;
  editForm.value = {
    title: task.value.title,
    description: task.value.description,
    status: task.value.status,
    priority: task.value.priority,
    dueDate: task.value.dueDate || "",
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!task.value) return;
  saving.value = true;
  try {
    const data = {
      title: editForm.value.title,
      description: editForm.value.description,
      status: editForm.value.status,
      priority: editForm.value.priority,
      dueDate: editForm.value.dueDate || null,
    };
    await tasksStore.update(route.params.id, data);
    editing.value = false;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update task");
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    await tasksStore.fetchById(route.params.id);
    await projectsStore.fetchAll();
  } catch {
    goBack();
  } finally {
    loading.value = false;
  }
});

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

async function addComment() {
  submitting.value = true;
  try {
    await tasksStore.addComment(route.params.id, newComment.value);
    newComment.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to add comment");
  } finally {
    submitting.value = false;
  }
}

async function toggleChecklist(idx) {
  if (!task.value) return;
  const checklist = [...task.value.checklist];
  checklist[idx] = { ...checklist[idx], done: !checklist[idx].done };
  try {
    await tasksStore.update(route.params.id, { checklist });
  } catch {
    // Handle error
  }
}

async function addChecklistItem() {
  if (!task.value || !newChecklistText.value.trim()) return;
  savingChecklist.value = true;
  const checklist = [
    ...task.value.checklist,
    { text: newChecklistText.value.trim(), done: false },
  ];
  try {
    await tasksStore.update(route.params.id, { checklist });
    newChecklistText.value = "";
  } catch {
    // Handle error
  } finally {
    savingChecklist.value = false;
  }
}

async function deleteTask() {
  deleting.value = true;
  try {
    await tasksStore.remove(route.params.id);
    goBack();
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete task");
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
  const base = `/api/tasks/${task.value.id}/attachments/${attachmentId}`;
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
    await tasksStore.uploadAttachment(route.params.id, input.files[0]);
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
    await tasksStore.deleteAttachment(route.params.id, attachmentId);
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
  align-items: center;
}

.priority-high {
  color: var(--pico-del-color);
}
.priority-medium {
  color: var(--pico-primary);
}
.priority-low {
  color: var(--pico-muted-color);
}

.edit-section {
  margin-bottom: var(--space-lg);
}

.edit-section label {
  display: block;
  margin-bottom: var(--space-sm);
}

.edit-section label h1 {
  margin: 0;
}

.edit-section textarea {
  min-height: 80px;
}

.meta-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  padding: var(--space-sm);
  background: var(--pico-card-background-color);
  border-radius: var(--radius-sm);
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.meta-field select,
.meta-field input {
  margin: 0;
}

section {
  margin-bottom: var(--space-lg);
}

.checklist {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
}

.checklist-item .done {
  text-decoration: line-through;
  color: var(--pico-muted-color);
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

.add-checklist-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
  align-items: center;
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
