<template>
  <div class="task-detail">
    <div v-if="loading" class="loading-indicator" />

    <template v-else-if="task">
      <header class="detail-header">
        <div>
          <NuxtLink to="/tasks" class="back-link"
            ><i class="bi bi-arrow-left" /> Tasks</NuxtLink
          >
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
        </div>
      </header>

      <!-- Editable Fields -->
      <section class="edit-section">
        <label>
          Title
          <input v-if="editing" v-model="editForm.title" type="text" required />
          <h1 v-else>{{ task.title }}</h1>
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
            <a
              :href="`/api/tasks/${task.id}/attachments/${att.id}`"
              target="_blank"
              class="attachment-link"
            >
              <i class="bi bi-paperclip" /> {{ att.fileName }}
            </a>
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
        <footer>
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
    router.push("/tasks");
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
    router.push("/tasks");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete task");
  } finally {
    deleting.value = false;
    showDeleteConfirm.value = false;
  }
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
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1em;
  flex-wrap: wrap;
  gap: 0.5em;
}

.back-link {
  text-decoration: none;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 0.3em;
}

.header-actions {
  display: flex;
  gap: 0.5em;
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

.status-badge {
  padding: 0.2em 0.5em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.85em;
}

.edit-section {
  margin-bottom: 1.5em;
}

.edit-section label {
  display: block;
  margin-bottom: 0.5em;
}

.edit-section label h1 {
  margin: 0;
}

.edit-section textarea {
  min-height: 80px;
}

.meta-section {
  display: flex;
  flex-wrap: wrap;
  gap: 1em;
  margin-bottom: 1.5em;
  padding: 0.5em;
  background: var(--pico-card-background-color);
  border-radius: 0.3em;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  min-width: 150px;
}

.meta-field select,
.meta-field input {
  margin: 0;
}

.assignee-tag,
.label-tag {
  display: inline-block;
  padding: 0.1em 0.4em;
  margin: 0.1em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.85em;
}

section {
  margin-bottom: 1.5em;
}

.checklist {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 0.5em;
  cursor: pointer;
}

.checklist-item .done {
  text-decoration: line-through;
  color: var(--pico-muted-color);
}

.comments {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
  margin-bottom: 0.5em;
}

.comment {
  padding: 0.3em 0.5em;
}

.comment header {
  display: flex;
  justify-content: space-between;
  padding: 0;
  height: auto;
  margin-bottom: 0.2em;
}

.comment p {
  margin: 0;
  font-size: 0.9em;
}

.add-checklist-item {
  display: flex;
  gap: 0.5em;
  margin-top: 0.5em;
}

.add-checklist-item input {
  flex: 1;
}

.add-comment {
  display: flex;
  gap: 0.5em;
}

.add-comment input {
  flex: 1;
}

.empty-state {
  text-align: center;
  padding: 1em;
  color: var(--pico-muted-color);
  font-size: 0.9em;
}

.attachments {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}

.attachment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.3em 0.5em;
  background: var(--pico-card-background-color);
  border-radius: 0.3em;
}

.attachment-link {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.3em;
}

.attachment-link:hover {
  text-decoration: underline;
}

.small-btn {
  padding: 0.1em 0.4em;
  font-size: 0.85em;
}

.add-attachment {
  display: flex;
  gap: 0.5em;
  align-items: center;
}

.file-input {
  flex: 1;
}

dialog article footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
}
</style>
