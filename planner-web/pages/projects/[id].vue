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
            <div
              v-if="project.description"
              class="markdown-body"
              v-html="renderMarkdown(project.description)"
            />
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
          Statuses are defined and ordered by admins in Admin &rarr; Statuses.
          Select which ones this project uses. <strong>Done</strong> is
          mandatory.
        </p>
        <div class="status-selection">
          <div
            v-for="status in catalogStatuses"
            :key="status"
            class="status-check-row"
            :class="{ 'is-done-row': status === 'Done' }"
          >
            <label>
              <input
                type="checkbox"
                :checked="selectedStatuses.includes(status)"
                :disabled="status === 'Done'"
                @change="toggleStatus(status)"
              />
              {{ status }}
            </label>
            <span v-if="status === 'Done'" class="done-lock">
              <i class="bi bi-lock-fill" /> Mandatory
            </span>
          </div>
        </div>
        <div v-if="unknownStatuses.length" class="status-warning">
          <i class="bi bi-exclamation-triangle" />
          Not in the catalog, will be removed on save:
          {{ unknownStatuses.join(", ") }}
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
    <dialog
      ref="deleteDialogEl"
      @close="showDeleteConfirm = false"
    >
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
import { renderMarkdown } from "../../composables/useMarkdown";
import api from "../../utils/api";

const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const statusesStore = useStatusesStore();
const route = useRoute();
const router = useRouter();

const project = computed(() => projectsStore.currentProject);
const tasks = computed(() =>
  tasksStore.tasks.filter((t) => t.projectId === route.params.id),
);
const loading = ref(true);
const showDeleteConfirm = ref(false);
// Modal dialog wiring: backdrop, focus trap, Escape to close
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);

const editVisibility = ref("public");
const editUserAccess = ref([]);
const availableUsers = ref([]);

// --- Status selection state ---
const selectedStatuses = ref([]);
const savingStatuses = ref(false);
const statusEditError = ref("");

const catalogStatuses = computed(() => statusesStore.catalog);
const unknownStatuses = computed(() =>
  (project.value?.statuses || []).filter(
    (s) => !catalogStatuses.value.includes(s),
  ),
);

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
  router.replace({
    path: route.path,
    query: { ...route.query, taskId: task.id },
  });
}

// Refresh project and task data when a dialog closes: tasks may have been
// changed in the dialog or by other users while it was open
async function refreshProjectData() {
  try {
    await projectsStore.fetchById(route.params.id);
    await tasksStore.fetchAll(route.params.id);
  } catch {
    // Error handled silently
  }
}
useDialogCloseRefresh("taskId", refreshProjectData);
useDialogCloseRefresh("projectId", refreshProjectData);

onMounted(async () => {
  try {
    await projectsStore.fetchById(route.params.id);
    await tasksStore.fetchAll(route.params.id);
    await statusesStore.fetchAll();
    if (project.value) {
      editVisibility.value = project.value.visibility || "public";
      editUserAccess.value = [...(project.value.userAccess || [])];
      selectedStatuses.value = (project.value.statuses || []).filter((s) =>
        catalogStatuses.value.includes(s),
      );
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

// --- Status selection functions ---

function toggleStatus(status) {
  if (status === "Done") return;
  statusEditError.value = "";
  const idx = selectedStatuses.value.indexOf(status);
  if (idx >= 0) {
    selectedStatuses.value.splice(idx, 1);
  } else {
    selectedStatuses.value.push(status);
  }
}

async function saveStatuses() {
  statusEditError.value = "";
  const statuses = selectedStatuses.value.filter(Boolean);
  if (!statuses.includes("Done")) {
    statuses.push("Done");
  }
  if (statuses.length < 2) {
    statusEditError.value =
      'At least one status besides "Done" is required.';
    return;
  }
  savingStatuses.value = true;
  try {
    const updated = await projectsStore.update(route.params.id, { statuses });
    selectedStatuses.value = (updated.statuses || []).filter((s) =>
      catalogStatuses.value.includes(s),
    );
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
  font-size: var(--text-md);
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
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

/* Status selection */
.status-selection {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: var(--space-sm);
}

.status-check-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 6px 10px;
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.status-check-row.is-done-row {
  opacity: 0.75;
  border-style: dashed;
  background: transparent;
}

.status-check-row label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
  cursor: pointer;
}

.status-check-row label input:disabled {
  cursor: not-allowed;
}

.done-lock {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-left: auto;
}

.status-warning {
  font-size: var(--text-sm);
  color: var(--color-warning, #b58900);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.status-error {
  font-size: var(--text-base);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
}

.radio-label {
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  cursor: pointer;
  padding: var(--space-sm) var(--space-md);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.radio-label:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.radio-label small {
  font-size: var(--text-xs);
  opacity: 0.7;
}

.user-access-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.user-access-item label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
}
</style>
