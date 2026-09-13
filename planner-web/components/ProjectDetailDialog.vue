<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="project-detail-dialog">
      <header class="dialog-header">
        <h3>Project Details</h3>
        <div class="dialog-actions">
          <button
            v-if="!editing && authStore.isAdmin"
            class="secondary"
            @click="startEdit"
          >
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

      <template v-else-if="project">
        <!-- Editable Fields -->
        <section class="edit-section">
          <label>
            Name
            <input
              v-if="editing"
              v-model="editForm.name"
              type="text"
              required
            />
            <h2 v-else>
              {{ project.name }}
              <span v-if="project.isDefault" class="badge">Default project</span>
            </h2>
          </label>
          <label>
            Description
            <textarea v-if="editing" v-model="editForm.description" rows="3" />
            <div
              v-else
              class="markdown-body"
              v-html="renderMarkdown(project.description) || 'No description'"
            />
          </label>
        </section>

        <!-- Meta Info (read-only summary for non-admin users) -->
        <section v-if="!authStore.isAdmin" class="meta-section">
          <div class="meta-field">
            <strong>Visibility</strong>
            <span>
              <i
                :class="
                  project.visibility === 'restricted'
                    ? 'bi bi-lock'
                    : 'bi bi-globe'
                "
              />
              {{ project.visibility || "public" }}
            </span>
          </div>
          <div class="meta-field">
            <strong>Statuses</strong>
            <span>{{ project.statuses?.length || 0 }} defined</span>
          </div>
        </section>

        <!-- Visibility (admin management) -->
        <section v-if="authStore.isAdmin" class="visibility-section">
          <h3>Visibility</h3>
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
          <UserMultiSelect
            v-if="editVisibility === 'restricted'"
            :model-value="editUserAccess"
            :users="availableUsers"
            @update:model-value="onUserAccessChange"
          />
        </section>

        <!-- Statuses (admin management) -->
        <section v-if="authStore.isAdmin">
          <h3>Statuses</h3>
          <p class="section-hint">
            Select which statuses from the global catalog this project uses.
            <strong>Done</strong> is mandatory.
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

        <!-- Delete -->
        <section v-if="authStore.isAdmin && !project.isDefault">
          <button class="contrast" @click="showDeleteConfirm = true">
            <i class="bi bi-trash" /> Delete Project
          </button>
        </section>
      </template>

      <!-- Delete Confirmation -->
      <dialog
        ref="deleteDialogEl"
        class="inner-dialog"
        @close="showDeleteConfirm = false"
      >
        <article>
          <header><h3>Delete Project</h3></header>
          <p>
            Are you sure you want to delete "{{ project?.name }}"? All
            associated tasks, notes, and comments will also be deleted.
          </p>
          <footer class="dialog-footer">
            <button class="secondary" @click="showDeleteConfirm = false">
              Cancel
            </button>
            <button
              class="contrast"
              :aria-busy="deleting"
              @click="deleteProject"
            >
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
import api from "../utils/api";

const props = defineProps({
  projectId: { type: String, default: null },
});
const emit = defineEmits(["close", "updated"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => !!props.projectId);

const authStore = useAuthStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();

const project = computed(() => projectsStore.currentProject);
const loading = ref(false);
const showDeleteConfirm = ref(false);
const deleteDialogEl = useModalDialog(() => showDeleteConfirm.value);
const deleting = ref(false);
const editing = ref(false);
const saving = ref(false);
const editForm = ref({ name: "", description: "" });

// --- Visibility management (admin) ---
const editVisibility = ref("public");
const editUserAccess = ref([]);
const availableUsers = ref([]);

// --- Status selection (admin) ---
const selectedStatuses = ref([]);
const savingStatuses = ref(false);
const statusEditError = ref("");

const catalogStatuses = computed(() => statusesStore.catalogNames);
const unknownStatuses = computed(() =>
  (project.value?.statuses || []).filter(
    (s) => !catalogStatuses.value.includes(s),
  ),
);

watch(
  () => props.projectId,
  async (newId) => {
    if (newId) {
      loading.value = true;
      editing.value = false;
      try {
        const projectData = await projectsStore.fetchById(newId);
        if (authStore.isAdmin && projectData) {
          editVisibility.value = projectData.visibility || "public";
          editUserAccess.value = [...(projectData.userAccess || [])];
          await statusesStore.fetchAll();
          selectedStatuses.value = (projectData.statuses || []).filter((s) =>
            catalogStatuses.value.includes(s),
          );
          await fetchUsers();
        }
      } catch {
        // Error fetching project
      } finally {
        loading.value = false;
      }
    } else {
      projectsStore.currentProject = null;
    }
  },
  { immediate: true },
);

function handleClose() {
  emit("close");
}

function startEdit() {
  if (!project.value) return;
  editForm.value = {
    name: project.value.name,
    description: project.value.description || "",
  };
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!project.value) return;
  saving.value = true;
  try {
    await projectsStore.update(props.projectId, {
      name: editForm.value.name,
      description: editForm.value.description,
    });
    editing.value = false;
    emit("updated");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update project");
  } finally {
    saving.value = false;
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
    await projectsStore.update(props.projectId, {
      visibility: editVisibility.value,
      userAccess: editUserAccess.value,
    });
  } catch (e) {
    alert(e.response?.data?.error || "Failed to update visibility");
  }
}

function onUserAccessChange(ids) {
  editUserAccess.value = ids;
  updateVisibility();
}

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
    const updated = await projectsStore.update(props.projectId, { statuses });
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

async function deleteProject() {
  deleting.value = true;
  try {
    await projectsStore.remove(props.projectId);
    showDeleteConfirm.value = false;
    emit("close");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete project");
  } finally {
    deleting.value = false;
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
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.edit-section textarea {
  min-height: 60px;
}

.meta-section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
  padding: var(--space-sm);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.badge {
  font-size: var(--text-sm);
  padding: 0.2em 0.5em;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-on-primary);
}

section {
  margin-bottom: var(--space-lg);
}

.section-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

.visibility-controls {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-sm);
}

/* The UserMultiSelect dropdown overflows this section: without this,
   the global `dialog article section` scroll rule (base.css) clips it */
.visibility-section {
  overflow: visible;
  max-height: none;
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

.inner-dialog article footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}
</style>
