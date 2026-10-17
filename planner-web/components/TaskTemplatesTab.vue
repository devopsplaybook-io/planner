<template>
  <section>
    <header class="section-header">
      <h2>Task Templates</h2>
      <button class="new-template-btn" @click="openCreate">
        <i class="bi bi-plus-lg" /> New template
      </button>
    </header>

    <p class="section-hint">
      Templates are blueprint tasks: define the content once, then create
      instances manually or automatically on a cron schedule. Scheduled
      instances start in the project's first status.
    </p>

    <div class="templates-toolbar">
      <ProjectSelect
        v-model="projectFilter"
        all-label="All projects"
        @update:model-value="reload"
      />
      <input
        v-model="searchText"
        type="search"
        class="templates-search"
        placeholder="Search templates…"
        aria-label="Search templates">
    </div>

    <div v-if="loading" class="loading-indicator" />

    <div v-else-if="listError" class="templates-error" role="alert">
      <i class="bi bi-exclamation-circle" /> {{ listError }}
    </div>

    <div v-else-if="templates.length === 0" class="templates-empty">
      <i class="bi bi-kanban" />
      <p>
        No templates{{
          projectFilter || searchText ? " matching the filters" : " yet"
        }}.
      </p>
    </div>

    <ul v-else class="template-list">
      <li v-for="template in templates" :key="template.id" class="template-card">
        <div class="template-main">
          <div class="template-title-row">
            <span class="template-title">{{ template.title }}</span>
            <span class="priority-badge" :class="`priority-${template.priority}`">
              {{ template.priority }}
            </span>
          </div>
          <div class="template-meta-row">
            <span class="template-project" :title="projectName(template)">
              <i class="bi bi-folder2" /> {{ projectName(template) }}
            </span>
            <span
              class="template-automation"
              :title="template.automation.scheduleCron || ''"
            >
              <i class="bi bi-arrow-repeat" />
              {{ automationLabel(template) }}
            </span>
            <span v-if="template.automation.skipIfPreviousNotDone" class="template-flag">
              <i class="bi bi-skip-forward" /> skips open
            </span>
            <span v-if="template.assignees.length" class="template-flag">
              <i class="bi bi-people-fill" /> {{ template.assignees.length }}
            </span>
            <span v-if="template.attachments.length" class="template-flag">
              <i class="bi bi-paperclip" /> {{ template.attachments.length }}
            </span>
            <span v-if="template.comments.length" class="template-flag">
              <i class="bi bi-chat-left-text" /> {{ template.comments.length }}
            </span>
          </div>
          <div v-if="template.labels.length" class="template-label-row">
            <span v-for="label in template.labels" :key="label" class="label-tag">
              {{ label }}
            </span>
          </div>
        </div>
        <div class="template-actions">
          <button
            class="small"
            :disabled="!canCreateInstance(template)"
            :aria-busy="creatingInstanceId === template.id"
            @click="createInstance(template)"
          >
            <i class="bi bi-plus-square" /> Create task
          </button>
          <button
            class="small secondary"
            :disabled="!canEdit(template)"
            @click="openEdit(template)"
          >
            <i class="bi bi-pencil" /> Edit
          </button>
          <button
            class="small secondary"
            :disabled="!canDelete(template)"
            @click="openDeleteConfirm(template)"
          >
            <i class="bi bi-trash" /> Delete
          </button>
        </div>
      </li>
    </ul>

    <TaskTemplateDialog
      :open="dialogOpen"
      :template-id="editingTemplateId"
      @close="dialogOpen = false"
      @saved="reload"
    />

    <dialog ref="deleteDialogEl" class="inner-dialog" @close="deleteTarget = null">
      <article>
        <header><h3>Delete Template</h3></header>
        <p>
          Delete the template "{{ deleteTarget?.title }}"? Its created tasks
          are not affected.
        </p>
        <footer class="dialog-footer">
          <button class="secondary" @click="deleteDialogEl?.close()">
            Cancel
          </button>
          <button class="contrast" :aria-busy="deleting" @click="confirmDelete">
            Delete
          </button>
        </footer>
      </article>
    </dialog>

    <p
      v-if="instanceMessage"
      class="instance-message"
      role="status"
    >
      <i class="bi bi-check-circle" /> {{ instanceMessage }}
    </p>
  </section>
</template>

<script setup>
import { displayName } from "../utils/projectHierarchy";
import { cronLabel } from "../utils/taskTemplate";
import { projectPermissionFor } from "../stores/projects";

const taskTemplatesStore = useTaskTemplatesStore();
const projectsStore = useProjectsStore();
const authStore = useAuthStore();

const loading = ref(true);
const listError = ref("");
const projectFilter = ref("");
const searchText = ref("");
const searchTimer = ref(null);

const dialogOpen = ref(false);
const editingTemplateId = ref(null);
const deleteTarget = ref(null);
const deleteDialogEl = ref(null);
const deleting = ref(false);
const creatingInstanceId = ref("");
const instanceMessage = ref("");

const templates = computed(() => taskTemplatesStore.templates);

function permissionFor(template) {
  const project = projectsStore.projects.find(
    (p) => p.id === template.projectId,
  );
  return projectPermissionFor(
    project,
    authStore.currentUser?.id,
    authStore.isAdmin,
  );
}

const canEdit = (template) =>
  ["update", "all"].includes(permissionFor(template));
const canCreateInstance = canEdit;
const canDelete = (template) => permissionFor(template) === "all";

function projectName(template) {
  const project = projectsStore.projects.find(
    (p) => p.id === template.projectId,
  );
  return project ? displayName(project.name) : template.projectId;
}

function automationLabel(template) {
  return cronLabel(template.automation?.scheduleCron) || "Manual";
}

async function reload() {
  listError.value = "";
  try {
    await taskTemplatesStore.fetchAll({
      projectId: projectFilter.value || undefined,
      q: searchText.value.trim() || undefined,
    });
  } catch {
    listError.value = "Failed to load the task templates.";
  } finally {
    loading.value = false;
  }
}

watch(searchText, () => {
  clearTimeout(searchTimer.value);
  searchTimer.value = setTimeout(reload, 300);
});

function openCreate() {
  editingTemplateId.value = null;
  dialogOpen.value = true;
}

function openEdit(template) {
  editingTemplateId.value = template.id;
  dialogOpen.value = true;
}

function openDeleteConfirm(template) {
  deleteTarget.value = template;
  deleteDialogEl.value?.showModal();
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await taskTemplatesStore.remove(deleteTarget.value.id);
    deleteDialogEl.value?.close();
  } catch {
    listError.value = "Failed to delete the template.";
  } finally {
    deleting.value = false;
  }
}

async function createInstance(template) {
  creatingInstanceId.value = template.id;
  instanceMessage.value = "";
  try {
    const task = await taskTemplatesStore.createInstance(template.id);
    instanceMessage.value = `Created task "${task.title}".`;
  } catch (e) {
    listError.value =
      e.response?.data?.error || "Failed to create the task instance.";
  } finally {
    creatingInstanceId.value = "";
  }
}

onMounted(async () => {
  await projectsStore.fetchAll();
  await reload();
});
</script>

<style scoped>
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-sm);
}

.new-template-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.section-hint {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-sm);
}

.templates-toolbar {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  margin-bottom: var(--space-md);
  flex-wrap: wrap;
}

.templates-search {
  flex: 1;
  min-width: 200px;
  margin: 0;
}

.templates-error {
  font-size: var(--text-base);
  color: var(--color-danger);
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
}

.templates-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  color: var(--color-text-muted);
  padding: var(--space-lg) 0;
}

.templates-empty i {
  font-size: var(--text-xl);
}

.template-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.template-card {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-start;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.template-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.template-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.template-title {
  font-weight: var(--weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.priority-badge {
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
  color: #fff;
}

.priority-high {
  background: var(--color-danger);
}

.priority-medium {
  background: var(--color-primary);
}

.priority-low {
  background: var(--color-text-muted);
}

.template-meta-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.template-project {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-automation {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.template-flag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.template-label-row {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
}

.label-tag {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  padding: 0.1em 0.4em;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary);
  white-space: nowrap;
}

.template-actions {
  display: flex;
  gap: var(--space-2xs);
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.instance-message {
  margin-top: var(--space-sm);
  font-size: var(--text-base);
  color: var(--color-success, var(--color-primary));
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}
</style>
