<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="task-detail-dialog">
      <header class="dialog-header">
        <h3>Task Details</h3>
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
          <details v-if="task" ref="advancedMenuEl" class="advanced-menu">
            <summary class="secondary" role="button" aria-label="Advanced">
              <i class="bi bi-three-dots" />
            </summary>
            <ul>
              <li>
                <a
                  href="#"
                  :aria-busy="cloning"
                  @click.prevent="cloneTask"
                >
                  <i class="bi bi-copy" /> Clone Task
                </a>
              </li>
              <li v-if="isImproveEnabled">
                <a
                  href="#"
                  :aria-busy="improving"
                  @click.prevent="improveTask"
                >
                  <i class="bi bi-stars" /> Improve with AI
                </a>
              </li>
              <li v-if="canCancelTask">
                <a
                  href="#"
                  class="danger-item"
                  :aria-busy="cancelling"
                  @click.prevent="openCancelConfirm"
                >
                  <i class="bi bi-x-circle" /> Cancel Task
                </a>
              </li>
              <li>
                <a href="#" class="danger-item" @click.prevent="openDeleteConfirm">
                  <i class="bi bi-trash" /> Delete Task
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

      <section v-else-if="notFound" class="task-not-found">
        <p>This task is not available.</p>
      </section>

      <template v-else-if="task">
        <!-- Status dropdown — always visible -->
        <section class="status-bar">
          <label class="status-select">
            <strong>Status</strong>
            <select
              :value="task.status"
              :aria-busy="savingStatus"
              @change="onStatusChange($event)"
            >
              <option v-for="s in availableStatuses" :key="s" :value="s">
                {{ s }}
              </option>
            </select>
          </label>
        </section>

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
            <div
              v-else
              class="markdown-body"
              v-html="renderMarkdown(task.description) || 'No description'"
            />
          </label>
        </section>

        <!-- Meta Info -->
        <section class="meta-section">
          <div class="meta-field">
            <strong>Project</strong>
            <ProjectSelect v-if="editing" v-model="editForm.projectId" />
            <span v-else>{{ projectName || task.projectId }}</span>
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
          <div class="meta-field">
            <strong>Assignees</strong>
            <UserMultiSelect
              v-if="editing"
              v-model="editForm.assignees"
              :users="users"
            />
            <div v-else-if="task.assignees && task.assignees.length" class="tag-list">
              <span v-for="a in task.assignees" :key="a.userId" class="tag">{{
                a.userName || a.userId
              }}</span>
            </div>
            <span v-else class="text-muted">Unassigned</span>
          </div>
          <div v-if="task.labels && task.labels.length" class="meta-field">
            <strong>Labels</strong>
            <div class="tag-list">
              <span v-for="l in task.labels" :key="l" class="tag">{{ l }}</span>
            </div>
          </div>
        </section>

        <!-- Checklist -->
        <details
          class="compact-section"
          :open="task.checklist && task.checklist.length > 0"
        >
          <summary>
            Checklist
            <span
              v-if="task.checklist && task.checklist.length"
              class="count-badge"
            >
              {{ task.checklist.filter((i) => i.done).length }}/{{
                task.checklist.length
              }}
            </span>
          </summary>
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
        </details>

        <!-- Attachments -->
        <details
          class="compact-section"
          :open="task.attachments && task.attachments.length > 0"
        >
          <summary>
            Attachments
            <span
              v-if="task.attachments && task.attachments.length"
              class="count-badge"
            >
              {{ task.attachments.length }}
            </span>
          </summary>
          <div
            v-if="task.attachments && task.attachments.length"
            class="attachments"
          >
            <div
              v-for="att in task.attachments"
              :key="att.id"
              class="attachment-item"
            >
              <div class="attachment-info">
                <template v-if="isImageFile(att.fileName)">
                  <img
                    :src="`/api/tasks/${task.id}/attachments/${att.id}?inline=true&token=${authToken}`"
                    :alt="att.fileName"
                    class="attachment-preview"
                    @click="
                      fullscreenImage = `/api/tasks/${task.id}/attachments/${att.id}?inline=true&token=${authToken}`
                    "
                  />
                </template>
                <a
                  :href="`/api/tasks/${task.id}/attachments/${att.id}?token=${authToken}`"
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
          :comments="task.comments || []"
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

      <!-- Cancel Confirmation -->
      <dialog
        ref="cancelDialogEl"
        class="inner-dialog"
        @close="showCancelConfirm = false"
      >
        <article>
          <header><h3>Cancel Task</h3></header>
          <p>
            Are you sure you want to cancel "{{ task?.title }}"? It will be
            moved to Done and its title suffixed with " [cancelled]".
          </p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showCancelConfirm = false">
              Keep Task
            </button>
            <button class="contrast" :aria-busy="cancelling" @click="cancelTask">
              Cancel Task
            </button>
          </footer>
        </article>
      </dialog>
    </article>
  </dialog>
</template>

<script setup>
import { renderMarkdown } from "../composables/useMarkdown";
import api from "../utils/api";
import { displayName } from "../utils/projectHierarchy";

const props = defineProps({
  taskId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated", "cloned"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => !!props.taskId);

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const recommendationStore = useRecommendationStore();

const task = computed(() => tasksStore.currentTask);
const isImproveEnabled = computed(() => recommendationStore.isImproveEnabled);
const loading = ref(false);
const notFound = ref(false);
// Set while a comment is being added so the task poll does not replace
// currentTask mid-submit; CommentThread owns the rest of the comment UI
// state (draft, expand, edit and their busy flags)
const submitting = ref(false);
const showDeleteConfirm = ref(false);
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);
const showCancelConfirm = ref(false);
const cancelDialogEl = useModalDialog(() => showCancelConfirm.value);
const cancelling = ref(false);
const uploading = ref(false);
const deletingAttachmentId = ref("");
const fileInput = ref(null);
const newChecklistText = ref("");
const savingChecklist = ref(false);
const editing = ref(false);
const saving = ref(false);
const savingStatus = ref(false);
const cloning = ref(false);
const improving = ref(false);
const advancedMenuEl = ref(null);
const editForm = ref({
  title: "",
  description: "",
  priority: "",
  dueDate: "",
  assignees: [],
  projectId: "",
});
const authToken = computed(() => localStorage.getItem("token") || "");
const fullscreenImage = ref(null);
const users = ref([]);

const availableStatuses = computed(() => {
  if (!task.value) return ["To Do", "In Progress", "Done"];
  const project = projectsStore.projects.find(
    (p) => p.id === task.value.projectId,
  );
  return project?.statuses || ["To Do", "In Progress", "Done"];
});

const projectName = computed(() => {
  const project = projectsStore.projects.find(
    (p) => p.id === task.value?.projectId,
  );
  return project ? displayName(project.name) : "";
});

// Cancelling moves the task to Done and renames it, so hide the action for
// tasks already in Done and for tasks in archived projects, where the
// server rejects any task update ("Project is archived").
const canCancelTask = computed(() => {
  if (!task.value) return false;
  if (task.value.status === "Done") return false;
  const project = projectsStore.projects.find(
    (p) => p.id === task.value.projectId,
  );
  return !project?.archived;
});

// While the dialog is open, poll the task so changes made by other users
// show up without reopening it. The poll never runs while the user is
// editing or submitting: a re-fetch replaces currentTask and would fight
// the form. The server also sends push notifications on task updates;
// this poll covers users who have not opted in to notifications.
// Declared before the taskId watch below: that watch is immediate and its
// callback runs synchronously during setup, calling stopTaskPolling() —
// reading taskPollTimer before its declaration would be a TDZ error.
const TASK_POLL_INTERVAL = 60 * 1000;
let taskPollTimer = null;

function startTaskPolling() {
  stopTaskPolling();
  taskPollTimer = setInterval(pollTask, TASK_POLL_INTERVAL);
}

function stopTaskPolling() {
  if (taskPollTimer) {
    clearInterval(taskPollTimer);
    taskPollTimer = null;
  }
}

async function pollTask() {
  if (!props.taskId || loading.value || editing.value || submitting.value) {
    return;
  }
  try {
    await tasksStore.fetchById(props.taskId);
  } catch {
    // Transient polling errors are ignored; the next tick retries
  }
}

watch(
  () => props.taskId,
  async (newId) => {
    stopTaskPolling();
    if (newId) {
      // The advanced menu needs the LLM config; fetch it when opening.
      recommendationStore.fetchConfig();
      loading.value = true;
      editing.value = false;
      notFound.value = false;
      try {
        await tasksStore.fetchById(newId);
        await projectsStore.fetchAll();
      } catch (e) {
        // The task is missing or sits in a restricted project the user
        // cannot see (404): show a dedicated state instead of an empty body.
        if (e?.response?.status === 404) {
          notFound.value = true;
          tasksStore.currentTask = null;
        }
      } finally {
        loading.value = false;
      }
      if (!notFound.value) {
        startTaskPolling();
      }
    } else {
      tasksStore.currentTask = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopTaskPolling();
});

function handleClose() {
  emit("close");
}

function startEdit() {
  if (!task.value) return;
  editForm.value = {
    title: task.value.title,
    description: task.value.description,
    priority: task.value.priority,
    dueDate: task.value.dueDate || "",
    assignees: (task.value.assignees || []).map((a) => a.userId),
    projectId: task.value.projectId,
  };
  editing.value = true;
  // Fetch users for the assignee picker
  fetchUsers();
}

async function fetchUsers() {
  try {
    const res = await api.get("/users/picker");
    users.value = res.data;
  } catch {
    users.value = [];
  }
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
      priority: editForm.value.priority,
      dueDate: editForm.value.dueDate || null,
      projectId: editForm.value.projectId,
    });
    // Update assignees separately
    const currentAssignees = (task.value.assignees || []).map((a) => a.userId);
    const newAssignees = editForm.value.assignees;
    // Remove assignees that are no longer selected
    for (const userId of currentAssignees) {
      if (!newAssignees.includes(userId)) {
        await tasksStore.removeAssignee(props.taskId, userId);
      }
    }
    // Add new assignees
    for (const userId of newAssignees) {
      if (!currentAssignees.includes(userId)) {
        await tasksStore.addAssignee(props.taskId, userId);
      }
    }
    // Refresh the task to get updated assignee names
    await tasksStore.fetchById(props.taskId);
    editing.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update task");
  } finally {
    saving.value = false;
  }
}

async function onStatusChange(event) {
  if (!task.value) return;
  const newStatus = event.target.value;
  if (newStatus === task.value.status) return;
  savingStatus.value = true;
  try {
    await tasksStore.update(props.taskId, { status: newStatus });
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update status");
  } finally {
    savingStatus.value = false;
  }
}

// CommentThread handlers: each returns false when the operation did not go
// through, so the thread keeps the draft or the pending delete.
async function addComment(text) {
  submitting.value = true;
  try {
    await tasksStore.addComment(props.taskId, text);
    return true;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to add comment");
    return false;
  } finally {
    submitting.value = false;
  }
}

async function editComment(commentId, text) {
  try {
    await tasksStore.updateComment(props.taskId, commentId, text);
    return true;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update comment");
    return false;
  }
}

async function deleteComment(commentId) {
  if (!confirm("Delete this comment?")) return false;
  try {
    await tasksStore.deleteComment(props.taskId, commentId);
    return true;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete comment");
    return false;
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

function closeAdvancedMenu() {
  advancedMenuEl.value?.removeAttribute("open");
}

async function cloneTask() {
  closeAdvancedMenu();
  if (!task.value || cloning.value) return;
  cloning.value = true;
  try {
    const newTask = await tasksStore.clone(props.taskId);
    // Re-point the dialog at the clone via the taskId query param
    emit("cloned", newTask.id);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to clone task");
  } finally {
    cloning.value = false;
  }
}

async function improveTask() {
  closeAdvancedMenu();
  if (!task.value || improving.value) return;
  improving.value = true;
  try {
    const source = editing.value
      ? {
          title: editForm.value.title,
          description: editForm.value.description,
        }
      : {
          title: task.value.title,
          description: task.value.description,
        };
    const improved = await tasksStore.improveText(
      source.title,
      source.description,
    );
    // Apply into the edit form for review; never saved silently
    if (!editing.value) startEdit();
    editForm.value.title = improved.title || editForm.value.title;
    editForm.value.description =
      improved.description || editForm.value.description;
  } catch (e) {
    alert(e.response?.data?.error || "Failed to improve task");
  } finally {
    improving.value = false;
  }
}

function openDeleteConfirm() {
  closeAdvancedMenu();
  showDeleteConfirm.value = true;
}

function openCancelConfirm() {
  closeAdvancedMenu();
  showCancelConfirm.value = true;
}

async function cancelTask() {
  if (!task.value || cancelling.value) return;
  cancelling.value = true;
  try {
    const suffix = " [cancelled]";
    const newTitle = task.value.title.endsWith(suffix)
      ? task.value.title
      : task.value.title + suffix;
    await tasksStore.update(props.taskId, {
      status: "Done",
      title: newTitle,
    });
    showCancelConfirm.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to cancel task");
  } finally {
    cancelling.value = false;
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
    await tasksStore.deleteAttachment(props.taskId, attachmentId);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete attachment");
  } finally {
    deletingAttachmentId.value = "";
  }
}
</script>

<style scoped>
.task-not-found {
  text-align: center;
  color: var(--pico-muted-color);
  padding: var(--space-md) 0;
}

/* Status bar — always visible dropdown */
.status-bar {
  margin-bottom: var(--space-md);
}

.status-select {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
}

.status-select strong {
  flex-shrink: 0;
  font-size: var(--text-base);
}

.status-select select {
  margin: 0;
  flex: 1;
  min-width: 0;
}

.edit-section {
  margin-bottom: var(--space-sm);
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
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  font-size: var(--text-base);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  /* The UserMultiSelect dropdown overflows this section: without this,
     the global `dialog article section` scroll rule (base.css) clips it */
  overflow: visible;
  max-height: none;
}

.meta-section .tag {
  /* Cancel the section's smaller font-size so tag pills keep their
     original em-based size (main.css sets .tag { font-size: var(--text-base) }) */
  font-size: 1em;
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
  margin-bottom: var(--space-md);
}

section h4 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
}

.priority-high {
  color: var(--color-danger);
}
.priority-medium {
  color: var(--color-primary);
}
.priority-low {
  color: var(--color-text-muted);
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
  color: var(--color-text-muted);
}

.add-checklist-item,
.add-attachment {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-sm);
  align-items: center;
}

.text-muted {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
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

.compact-section .checklist,
.compact-section .attachments {
  padding-top: var(--space-xs);
}

.compact-section .add-checklist-item,
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
