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

    <div v-else class="template-list">
      <section v-for="group in groups" :key="group.key" class="project-group">
        <h2 class="project-header">{{ group.label }}</h2>
        <TemplateCard
          v-for="template in group.templates"
          :key="template.id"
          :template="template"
          @click="openTemplate"
        />
      </section>
    </div>

    <TaskTemplateDialog
      :open="dialogOpen"
      :template-id="editingTemplateId"
      @close="dialogOpen = false"
      @saved="reload"
      @deleted="reload"
    />
  </section>
</template>

<script setup>
import { groupTemplatesByProject } from "../utils/templateGroups";

const taskTemplatesStore = useTaskTemplatesStore();
const projectsStore = useProjectsStore();

const loading = ref(true);
const listError = ref("");
const projectFilter = ref("");
const searchText = ref("");
const searchTimer = ref(null);

const dialogOpen = ref(false);
const editingTemplateId = ref(null);

const templates = computed(() => taskTemplatesStore.templates);

// Alphabetical within each project, groups ordered by project display path
const groups = computed(() =>
  groupTemplatesByProject(taskTemplatesStore.templates, projectsStore.projects),
);

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

function openTemplate(template) {
  editingTemplateId.value = template.id;
  dialogOpen.value = true;
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

/* Grouped card list like the update feed (grid, small gap) */
.template-list {
  display: grid;
  gap: var(--space-xs);
}

.project-group {
  display: grid;
  gap: var(--space-xs);
}

/* Compact group header, visually subordinate to the section h2 (same
   treatment as the update feed's day headers) */
.project-header {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
  letter-spacing: var(--tracking-wide);
  margin: var(--space-sm) 0 var(--space-xs);
}
</style>
