<template>
  <div class="project-detail">
    <div v-if="loading" class="loading-indicator" />

    <template v-else-if="project">
      <header class="detail-header">
        <div>
          <a href="#" class="back-link" @click.prevent="goBack"
            ><i class="bi bi-arrow-left" /> Projects</a
          >
          <hgroup>
            <h1>{{ project.name }}</h1>
            <p v-if="project.description">{{ project.description }}</p>
          </hgroup>
        </div>
        <div class="header-actions">
          <button
            v-if="!project.isDefault"
            class="secondary"
            @click="showDeleteConfirm = true"
          >
            <i class="bi bi-trash" />
          </button>
        </div>
      </header>

      <!-- Visibility -->
      <section>
        <h2>Visibility</h2>
        <div class="visibility-controls">
          <label class="radio-label">
            <input
              v-model="editVisibility"
              type="radio"
              value="public"
              @change="updateVisibility"
            />
            Public
            <small>Visible to all users</small>
          </label>
          <label class="radio-label">
            <input
              v-model="editVisibility"
              type="radio"
              value="restricted"
              @change="updateVisibility"
            />
            Restricted
            <small>Only visible to selected users</small>
          </label>
        </div>
        <div v-if="editVisibility === 'restricted'" class="user-access-list">
          <div
            v-for="user in availableUsers"
            :key="user.id"
            class="user-access-item"
          >
            <label>
              <input
                type="checkbox"
                :checked="editUserAccess.includes(user.id)"
                @change="toggleUserAccess(user.id)"
              />
              {{ user.name }}
            </label>
          </div>
        </div>
      </section>

      <!-- Statuses -->
      <section>
        <h2>Statuses</h2>
        <p class="section-hint">
          Drag to reorder. <strong>Done</strong> is always last and cannot be
          removed.
        </p>
        <div class="status-editor">
          <div
            v-for="(status, idx) in editableStatuses"
            :key="status"
            class="status-row"
            :class="{
              'is-dragging': dragStatusIdx === idx,
              'is-done-row': status === 'Done',
            }"
            :draggable="status !== 'Done'"
            @dragstart="onStatusDragStart($event, idx)"
            @dragover.prevent="onStatusDragOver(idx)"
            @dragenter.prevent="onStatusDragOver(idx)"
            @drop="onStatusDrop(idx)"
            @dragend="dragStatusIdx = null"
          >
            <span class="drag-handle" v-if="status !== 'Done'">
              <i class="bi bi-grip-vertical" />
            </span>
            <span class="status-row-badge" :class="statusBadgeClass(status)">{{
              status
            }}</span>
            <span v-if="status === 'Done'" class="done-lock">
              <i class="bi bi-lock-fill" /> Mandatory
            </span>
            <button
              v-if="status !== 'Done'"
              type="button"
              class="small secondary remove-status-btn"
              title="Remove status"
              @click="removeStatus(idx)"
            >
              <i class="bi bi-x" />
            </button>
          </div>
          <!-- Done row always shown even if somehow missing (safety) -->
          <div
            v-if="!editableStatuses.includes('Done')"
            class="status-row is-done-row"
          >
            <span class="status-row-badge status-done">Done</span>
            <span class="done-lock"
              ><i class="bi bi-lock-fill" /> Mandatory</span
            >
          </div>
        </div>
        <div class="add-status-row">
          <input
            v-model="newStatusText"
            type="text"
            placeholder="New status name…"
            @keyup.enter="addStatus"
          />
          <button type="button" class="small" @click="addStatus">
            <i class="bi bi-plus" /> Add
          </button>
        </div>
        <div v-if="statusEditError" class="status-error">
          <i class="bi bi-exclamation-circle" /> {{ statusEditError }}
        </div>
        <button
          type="button"
          :aria-busy="savingStatuses"
          class="save-statuses-btn"
          @click="saveStatuses"
        >
          <i class="bi bi-check-lg" /> Save statuses
        </button>
      </section>

      <!-- Tasks Section -->
      <section>
        <h2>Tasks ({{ tasks.length }})</h2>
        <div v-if="tasks.length === 0" class="empty-state">No tasks yet</div>
        <div v-else class="task-list">
          <TaskCard
            v-for="task in tasks"
            :key="task.id"
            :task="task"
            @click="openTask(task)"
          />
        </div>
      </section>
    </template>

    <!-- Delete Confirmation -->
    <dialog :open="showDeleteConfirm">
      <article>
        <header>
          <h3>Delete Project</h3>
        </header>
        <p>
          Are you sure you want to delete "{{ project?.name }}"? All associated
          tasks, notes, and comments will also be deleted.
        </p>
        <footer class="dialog-footer">
          <button class="secondary" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button class="contrast" :aria-busy="deleting" @click="deleteProject">
            Delete
          </button>
        </footer>
      </article>
    </dialog>
  </div>
</template>

<script setup>
import api from "../../utils/api";

const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const route = useRoute();
const router = useRouter();

const project = computed(() => projectsStore.currentProject);
const tasks = computed(() =>
  tasksStore.tasks.filter((t) => t.projectId === route.params.id),
);
const loading = ref(true);
const showDeleteConfirm = ref(false);
const deleting = ref(false);

const editVisibility = ref("public");
const editUserAccess = ref([]);
const availableUsers = ref([]);

// --- Status editor state ---
const editableStatuses = ref([]);
const newStatusText = ref("");
const dragStatusIdx = ref(null);
const savingStatuses = ref(false);
const statusEditError = ref("");

function goBack() {
  const back = window.history.state?.back;
  if (back) {
    router.back();
  } else {
    router.push("/projects");
  }
}

async function fetchUsers() {
  try {
    const res = await api.get("/users/picker");
    availableUsers.value = res.data;
  } catch {
    // Silently fail
  }
}

async function updateVisibility() {
  try {
    await projectsStore.update(route.params.id, {
      visibility: editVisibility.value,
      userAccess: editUserAccess.value,
    });
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update visibility");
  }
}

function toggleUserAccess(userId) {
  const idx = editUserAccess.value.indexOf(userId);
  if (idx >= 0) {
    editUserAccess.value.splice(idx, 1);
  } else {
    editUserAccess.value.push(userId);
  }
  updateVisibility();
}

function openTask(task) {
  router.push(`/tasks/${task.id}`);
}

onMounted(async () => {
  try {
    await projectsStore.fetchById(route.params.id);
    await tasksStore.fetchAll(route.params.id);
    if (project.value) {
      editVisibility.value = project.value.visibility || "public";
      editUserAccess.value = [...(project.value.userAccess || [])];
      editableStatuses.value = [
        ...(project.value.statuses || ["To Do", "In Progress", "Done"]),
      ];
    }
    await fetchUsers();
  } catch {
    // Error handled silently
  } finally {
    loading.value = false;
  }
});

async function deleteProject() {
  deleting.value = true;
  try {
    await projectsStore.remove(route.params.id);
    goBack();
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete project");
  } finally {
    deleting.value = false;
    showDeleteConfirm.value = false;
  }
}

// --- Status editor functions ---

function statusBadgeClass(status) {
  const key = status.toLowerCase().replace(/\s+/g, "-");
  return `status-${key}`;
}

function addStatus() {
  const text = newStatusText.value.trim();
  if (!text) return;
  statusEditError.value = "";
  if (text === "Done") {
    statusEditError.value =
      '"Done" is already included and cannot be duplicated.';
    return;
  }
  if (editableStatuses.value.includes(text)) {
    statusEditError.value = "This status already exists.";
    return;
  }
  // Insert before "Done" (always last)
  const doneIdx = editableStatuses.value.indexOf("Done");
  if (doneIdx >= 0) {
    editableStatuses.value.splice(doneIdx, 0, text);
  } else {
    editableStatuses.value.push(text);
    editableStatuses.value.push("Done");
  }
  newStatusText.value = "";
}

function removeStatus(idx) {
  if (editableStatuses.value[idx] === "Done") return;
  statusEditError.value = "";
  editableStatuses.value.splice(idx, 1);
}

function onStatusDragStart(event, idx) {
  if (editableStatuses.value[idx] === "Done") return;
  dragStatusIdx.value = idx;
  event.dataTransfer.effectAllowed = "move";
}

function onStatusDragOver(_idx) {
  // no-op, handled by prevent modifier
}

function onStatusDrop(targetIdx) {
  const srcIdx = dragStatusIdx.value;
  dragStatusIdx.value = null;
  if (srcIdx === null || srcIdx === targetIdx) return;
  if (editableStatuses.value[targetIdx] === "Done") return;
  const item = editableStatuses.value.splice(srcIdx, 1)[0];
  editableStatuses.value.splice(targetIdx, 0, item);
}

async function saveStatuses() {
  statusEditError.value = "";
  const statuses = editableStatuses.value.filter(Boolean);
  if (!statuses.includes("Done")) {
    statuses.push("Done");
  }
  if (statuses.length < 2) {
    statusEditError.value =
      'At least one custom status plus "Done" is required.';
    return;
  }
  savingStatuses.value = true;
  try {
    await projectsStore.update(route.params.id, { statuses });
  } catch (e) {
    statusEditError.value =
      e.response?.data?.error || "Failed to save statuses";
  } finally {
    savingStatuses.value = false;
  }
}
</script>

<style scoped>
.back-link {
  text-decoration: none;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.header-actions {
  display: flex;
  gap: var(--space-sm);
}

section {
  margin-bottom: var(--space-lg);
}

.section-hint {
  font-size: 0.82em;
  color: var(--pico-muted-color);
  margin-bottom: var(--space-sm);
}

/* Status editor */
.status-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: var(--space-sm);
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 10px;
  background: var(--pico-card-background-color);
  border-radius: var(--radius-sm);
  border: 1px solid var(--pico-muted-border-color);
  transition:
    background 0.12s,
    box-shadow 0.12s;
  user-select: none;
}

.status-row[draggable="true"] {
  cursor: grab;
}

.status-row[draggable="true"]:active {
  cursor: grabbing;
}

.status-row.is-dragging {
  opacity: 0.4;
  box-shadow: 0 0 0 2px var(--pico-primary);
}

.status-row.is-done-row {
  opacity: 0.75;
  border-style: dashed;
  background: transparent;
}

.drag-handle {
  color: var(--pico-muted-color);
  display: flex;
  align-items: center;
  font-size: 1.1em;
  flex-shrink: 0;
}

.status-row-badge {
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--pico-muted-color);
  color: #fff;
  white-space: nowrap;
  flex-shrink: 0;
}

.status-row-badge.status-to-do {
  background: #6c757d;
}
.status-row-badge.status-in-progress {
  background: #0d6efd;
}
.status-row-badge.status-done {
  background: #198754;
}
.status-row-badge.status-in-review,
.status-row-badge.status-review {
  background: #6f42c1;
}
.status-row-badge.status-blocked {
  background: #dc3545;
}
.status-row-badge.status-backlog {
  background: #6c757d;
}

.done-lock {
  font-size: 0.78em;
  color: var(--pico-muted-color);
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
}

.remove-status-btn {
  margin-left: auto;
  padding: 0 6px !important;
  line-height: 1;
  font-size: 1em !important;
}

.add-status-row {
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
}

.add-status-row input {
  flex: 1;
  margin: 0;
}

.status-error {
  font-size: 0.85em;
  color: var(--pico-del-color, #dc3545);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: var(--space-sm);
}

.save-statuses-btn {
  margin-top: var(--space-xs);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.visibility-controls {
  display: flex;
  gap: var(--space-md);
  flex-wrap: wrap;
  margin-bottom: var(--space-sm);
}

.radio-label {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  cursor: pointer;
  padding: var(--space-sm) var(--space-md);
  border: 2px solid var(--pico-muted-border-color);
  border-radius: var(--radius-sm);
}

.radio-label:has(input:checked) {
  border-color: var(--pico-primary);
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
}

.radio-label small {
  font-size: 0.8em;
  opacity: 0.7;
}

.user-access-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  background: var(--pico-card-background-color);
  border-radius: var(--radius-sm);
}

.user-access-item label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
}
</style>
