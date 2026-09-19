<template>
  <dialog ref="dialogEl" @close="handleClose">
    <article class="project-detail-dialog">
      <header class="dialog-header">
        <h3>Project Details</h3>
        <div class="dialog-actions">
          <!-- Rendered even when no project is selected (dialog is mounted
               app-wide), so project can be null here -->
          <button
            v-if="project && !editing && authStore.isAdmin"
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
          <details
            v-if="project && authStore.isAdmin && !project.isDefault"
            ref="advancedMenuEl"
            class="advanced-menu"
          >
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
                  <i class="bi bi-trash" /> Delete Project
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
              :disabled="isFrozen"
            />
            <h2 v-else>
              {{ project.name }}
              <span v-if="project.isDefault" class="badge">Default project</span>
              <span v-if="project.archived" class="badge badge-archived">
                Archived</span
              >
            </h2>
          </label>
          <label>
            Description
            <textarea
              v-if="editing"
              v-model="editForm.description"
              rows="3"
              :disabled="isFrozen"
            />
            <div
              v-else
              class="markdown-body"
              v-html="renderMarkdown(project.description) || 'No description'"
            />
          </label>
        </section>

        <!-- Meta Info (read-only summary, display mode) -->
        <section v-if="!editing" class="meta-section">
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
          <div v-if="authStore.isAdmin" class="meta-field">
            <strong>State</strong>
            <span>
              <i
                :class="project.archived ? 'bi bi-archive' : 'bi bi-check-circle'"
              />
              {{ project.archived ? "Archived" : "Active" }}
            </span>
          </div>
        </section>

        <!-- Visibility (admin, edit mode) -->
        <section v-if="editing" class="visibility-section">
          <h3>Visibility</h3>
          <div class="visibility-controls">
            <label class="radio-label">
              <input
                v-model="editVisibility"
                type="radio"
                value="public"
                :disabled="isFrozen"
              />
              Public
              <small>Visible to all users</small>
            </label>
            <label class="radio-label">
              <input
                v-model="editVisibility"
                type="radio"
                value="restricted"
                :disabled="isFrozen"
              />
              Restricted
              <small>Only visible to selected users</small>
            </label>
          </div>
          <UserMultiSelect
            v-if="editVisibility === 'restricted'"
            v-model="editUserAccess"
            :users="availableUsers"
            :disabled="isFrozen"
          />
        </section>

        <!-- Status: archive switch (admin, edit mode) -->
        <section v-if="editing" class="archive-section">
          <h3>Status</h3>
          <p class="section-hint">
            Archived projects are read-only: their tasks and notes cannot
            change, they disappear from the selection lists and they move to
            the end of the admin list. Every task must be Done to archive.
          </p>
          <div class="visibility-controls">
            <label class="radio-label">
              <input v-model="editArchived" type="radio" :value="false" />
              Active
              <small>Normal project</small>
            </label>
            <label class="radio-label">
              <input v-model="editArchived" type="radio" :value="true" />
              Archived
              <small>Read-only, hidden from lists</small>
            </label>
          </div>
        </section>

        <!-- Statuses (admin, edit mode) -->
        <section v-if="editing" class="statuses-section">
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
                  v-model="selectedStatuses"
                  type="checkbox"
                  :value="status"
                  :disabled="isFrozen || status === 'Done'"
                />
                {{ status }}
              </label>
              <span v-if="status === 'Done'" class="done-lock">
                <i class="bi bi-lock-fill" /> Mandatory
              </span>
            </div>
          </div>
          <div v-if="!isFrozen && unknownStatuses.length" class="status-warning">
            <i class="bi bi-exclamation-triangle" />
            Not in the catalog, will be removed on save:
            {{ unknownStatuses.join(", ") }}
          </div>
        </section>

        <!-- Unified save error (edit mode) -->
        <div v-if="editing && saveError" class="status-error">
          <i class="bi bi-exclamation-circle" /> {{ saveError }}
        </div>
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
const advancedMenuEl = ref(null);
const editForm = ref({ name: "", description: "" });
const saveError = ref("");

// --- Visibility management (admin) ---
const editVisibility = ref("public");
const editUserAccess = ref([]);
const availableUsers = ref([]);

// --- Archive switch (admin) ---
const editArchived = ref(false);

// --- Status selection (admin) ---
const selectedStatuses = ref([]);

// The server freezes all fields except the archived flag while a project
// is archived, so Edit mode only leaves the Active/Archived switch enabled.
const isFrozen = computed(() => !!project.value?.archived);

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
          await statusesStore.fetchAll();
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

function seedEditState() {
  if (!project.value) return;
  editForm.value = {
    name: project.value.name,
    description: project.value.description || "",
  };
  editVisibility.value = project.value.visibility || "public";
  editUserAccess.value = [...(project.value.userAccess || [])];
  editArchived.value = !!project.value.archived;
  selectedStatuses.value = (project.value.statuses || []).filter((s) =>
    catalogStatuses.value.includes(s),
  );
  saveError.value = "";
}

function startEdit() {
  seedEditState();
  editing.value = true;
}

function cancelEdit() {
  seedEditState();
  editing.value = false;
}

async function saveEdit() {
  if (!project.value) return;
  saveError.value = "";
  if (!editForm.value.name.trim()) {
    saveError.value = "Name is required";
    return;
  }
  let payload;
  if (project.value.archived) {
    // Frozen project: only the archived flag may change.
    payload = { archived: editArchived.value };
  } else {
    const statuses = selectedStatuses.value.filter(Boolean);
    if (!statuses.includes("Done")) {
      statuses.push("Done");
    }
    if (statuses.length < 2) {
      saveError.value = 'At least one status besides "Done" is required.';
      return;
    }
    payload = {
      name: editForm.value.name,
      description: editForm.value.description,
      visibility: editVisibility.value,
      userAccess: editUserAccess.value,
      archived: editArchived.value,
      statuses,
    };
  }
  saving.value = true;
  try {
    await projectsStore.update(props.projectId, payload);
    editing.value = false;
    emit("updated");
  } catch (e) {
    saveError.value = e.response?.data?.error || "Failed to update project";
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

function closeAdvancedMenu() {
  advancedMenuEl.value?.removeAttribute("open");
}

function openDeleteConfirm() {
  closeAdvancedMenu();
  showDeleteConfirm.value = true;
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

/* Advanced (…) dropdown menu in the header actions */
.advanced-menu {
  position: relative;
}

.advanced-menu summary {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25em 0.5em;
  font-size: var(--text-lg);
  line-height: 1;
  min-width: auto;
  width: auto;
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  color: var(--color-text);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.advanced-menu summary::-webkit-details-marker {
  display: none;
}

.advanced-menu summary:hover {
  background: var(--color-surface-hover);
}

.advanced-menu ul {
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  z-index: 100;
  min-width: max-content;
  margin: 0;
  padding: var(--space-2xs);
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
}

.advanced-menu a {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-base);
  white-space: nowrap;
}

.advanced-menu a:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
  text-decoration: none;
}

.advanced-menu .danger-item {
  color: var(--color-danger);
}

.advanced-menu .danger-item:hover {
  color: var(--color-danger-hover);
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

.badge-archived {
  background: var(--color-text-muted);
  color: var(--color-surface, #fff);
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
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.2em;
  cursor: pointer;
  padding: var(--space-sm) var(--space-md);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-sm);
}

/* The cards act as toggle buttons: hide the native radio circle but keep
   the input focusable for keyboard and screen readers */
.radio-label input[type="radio"] {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}

.radio-label:has(input:checked) {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.radio-label:has(input:focus-visible) {
  box-shadow: 0 0 0 3px var(--color-focus-ring);
}

.radio-label:has(input:disabled) {
  opacity: 0.6;
  cursor: not-allowed;
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

.inner-dialog article footer {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}
</style>
