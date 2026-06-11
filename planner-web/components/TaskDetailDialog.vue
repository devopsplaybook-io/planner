<template>
  <dialog :open="!!taskId">
    <article class="task-detail-dialog">
      <header class="dialog-header">
        <h3>Task Details</h3>
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

      <template v-else-if="task">
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
            <h2 v-else>{{ task.title }}</h2>
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
          <div
            v-if="task.assignees && task.assignees.length"
            class="meta-field"
          >
            <strong>Assignees</strong>
            <div class="tag-list">
              <span v-for="a in task.assignees" :key="a.userId" class="tag">{{
                a.userName || a.userId
              }}</span>
            </div>
          </div>
          <div v-if="task.labels && task.labels.length" class="meta-field">
            <strong>Labels</strong>
            <div class="tag-list">
              <span v-for="l in task.labels" :key="l" class="tag">{{ l }}</span>
            </div>
          </div>
        </section>

        <!-- Checklist -->
        <section>
          <h4>Checklist</h4>
          <div v-if="task.checklist && task.checklist.length" class="checklist">
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
        <section v-if="task.attachments && task.attachments.length">
          <h4>Attachments ({{ task.attachments.length }})</h4>
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
          <h4>Add Attachment</h4>
          <form class="add-attachment" @submit.prevent="uploadAttachment">
            <input ref="fileInput" type="file" class="file-input" />
            <button type="submit" :aria-busy="uploading">Upload</button>
          </form>
        </section>

        <!-- Comments -->
        <section>
          <h4>Comments ({{ task.comments ? task.comments.length : 0 }})</h4>
          <div class="comments">
            <article
              v-for="comment in task.comments || []"
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
              v-if="!task.comments || task.comments.length === 0"
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
            <i class="bi bi-trash" /> Delete Task
          </button>
        </section>
      </template>

      <!-- Delete Confirmation -->
      <dialog :open="showDeleteConfirm" class="inner-dialog">
        <article>
          <header><h3>Delete Task</h3></header>
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
    </article>
  </dialog>
</template>

<script setup>
const props = defineProps({
  taskId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated"]);

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();

const task = computed(() => tasksStore.currentTask);
const loading = ref(false);
const newComment = ref("");
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fileInput = ref(null);
const newChecklistText = ref("");
const savingChecklist = ref(false);
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

watch(
  () => props.taskId,
  async (newId) => {
    if (newId) {
      loading.value = true;
      editing.value = false;
      try {
        await tasksStore.fetchById(newId);
        await projectsStore.fetchAll();
      } catch {
        // Error fetching task
      } finally {
        loading.value = false;
      }
    } else {
      tasksStore.currentTask = null;
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
    await tasksStore.update(props.taskId, {
      title: editForm.value.title,
      description: editForm.value.description,
      status: editForm.value.status,
      priority: editForm.value.priority,
      dueDate: editForm.value.dueDate || null,
    });
    editing.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update task");
  } finally {
    saving.value = false;
  }
}

async function addComment() {
  submitting.value = true;
  try {
    await tasksStore.addComment(props.taskId, newComment.value);
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
    await tasksStore.update(props.taskId, { checklist });
  } catch {
    // Handle error
  }
}

async function addChecklistItem() {
  if (!task.value || !newChecklistText.value.trim()) return;
  savingChecklist.value = true;
  try {
    await tasksStore.update(props.taskId, {
      checklist: [
        ...task.value.checklist,
        { text: newChecklistText.value.trim(), done: false },
      ],
    });
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
    await tasksStore.remove(props.taskId);
    showDeleteConfirm.value = false;
    emit("close");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete task");
  } finally {
    deleting.value = false;
  }
}

async function uploadAttachment() {
  const input = fileInput.value;
  if (!input || !input.files || !input.files[0]) return;
  uploading.value = true;
  try {
    await tasksStore.uploadAttachment(props.taskId, input.files[0]);
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
    await tasksStore.deleteAttachment(props.taskId, attachmentId);
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
  font-size: 1.3em;
}

.edit-section textarea {
  min-height: 60px;
}

.meta-section {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  padding: var(--space-sm);
  background: var(--pico-card-background-color);
  border-radius: var(--radius-sm);
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 130px;
}

.meta-field select,
.meta-field input {
  margin: 0;
}

section {
  margin-bottom: var(--space-lg);
}

section h4 {
  font-size: 1em;
  margin-bottom: var(--space-sm);
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

.checklist {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
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

.add-checklist-item,
.add-comment,
.add-attachment {
  display: flex;
  gap: var(--space-sm);
}

.add-checklist-item input,
.add-comment input,
.file-input {
  flex: 1;
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
  font-size: 0.9em;
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

.small-btn {
  padding: 0.1em 0.4em;
  font-size: 0.85em;
}

.inner-dialog article footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}
</style>
