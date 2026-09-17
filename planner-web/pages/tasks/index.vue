<template>
  <div class="kanban-page">
    <header class="page-header">
      <hgroup>
        <h1>Tasks</h1>
        <p>Kanban board</p>
      </hgroup>
      <div class="header-controls">
        <ProjectSelect
          :model-value="projectsStore.selectedProjectFilter"
          all-label="All projects"
          @update:model-value="onFilterChange"
        />
        <button class="fab-button" @click="showCreateDialog = true">
          <i class="bi bi-plus-lg" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <div v-else class="kanban-board">
      <div
        v-for="status in statuses"
        :key="status"
        class="kanban-column"
        :style="{
          '--status-color': statusesStore.colorFor(status),
          '--status-contrast': readableTextColor(
            statusesStore.colorFor(status),
          ),
        }"
      >
        <h3 class="column-header">
          {{ status }}
          <span v-if="status === 'Done'" class="column-hint">
            last {{ DONE_WINDOW_DAYS }} days</span
          >
          <span class="column-count">{{
            getTasksByStatus(status).length
          }}</span>
        </h3>
        <div
          class="column-tasks"
          :class="{ 'drag-over': dragOverStatus === status }"
          @dragover.prevent="onDragOver(status)"
          @dragenter.prevent="onDragOver(status)"
          @dragleave="onDragLeave(status)"
          @drop="onDrop($event, status)"
        >
          <TaskCard
            v-for="task in getTasksByStatus(status)"
            :key="task.id"
            :task="task"
            :draggable="true"
            @dragstart="onDragStart($event, task)"
            @click="openTask(task)"
          />
          <div v-if="!getTasksByStatus(status).length" class="empty-column">
            No tasks
          </div>
        </div>
      </div>
    </div>

    <!-- Create Dialog -->
    <TaskCreateDialog
      :open="showCreateDialog"
      @close="showCreateDialog = false"
      @created="fetchTasks"
    />
  </div>
</template>

<script setup>
import { readableTextColor } from "../../utils/statusColor";

const DONE_WINDOW_DAYS = 30;

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const showCreateDialog = ref(false);
const dragTask = ref(null);
const dragOverStatus = ref(null);

const statuses = computed(() => {
  if (projectsStore.selectedProjectFilter) {
    const project = projectsStore.projects.find(
      (p) => p.id === projectsStore.selectedProjectFilter,
    );
    if (project?.statuses?.length) {
      return project.statuses;
    }
    return fallbackStatuses();
  }
  // All projects: follow the global status catalog, then append any
  // statuses not covered (e.g. dangling task statuses) as a safety net
  const ordered = [...statusesStore.catalogNames];
  const seen = new Set(ordered);
  for (const project of projectsStore.projects) {
    if (project.statuses) {
      for (const status of project.statuses) {
        if (!seen.has(status)) {
          seen.add(status);
          ordered.push(status);
        }
      }
    }
  }
  for (const task of tasksStore.tasks) {
    if (!seen.has(task.status)) {
      seen.add(task.status);
      ordered.push(task.status);
    }
  }
  return ordered.length > 0 ? ordered : fallbackStatuses();
});

function fallbackStatuses() {
  return ["To Do", "In Progress", "Done"];
}

function getTasksByStatus(status) {
  return tasksStore.tasks.filter((t) => t.status === status);
}

function onDragStart(event, task) {
  dragTask.value = task;
}

function onDragOver(status) {
  dragOverStatus.value = status;
}

function onDragLeave(status) {
  if (dragOverStatus.value === status) dragOverStatus.value = null;
}

async function onDrop(event, newStatus) {
  dragOverStatus.value = null;
  if (!dragTask.value || dragTask.value.status === newStatus) {
    dragTask.value = null;
    return;
  }
  try {
    await tasksStore.update(dragTask.value.id, { status: newStatus });
    await fetchTasks({ silent: true });
  } catch {
    // Handle error
  }
  dragTask.value = null;
}

function openTask(task) {
  router.replace({
    path: route.path,
    query: { ...route.query, taskId: task.id },
  });
}

function onFilterChange(projectId) {
  projectsStore.setProjectFilter(projectId);
  fetchTasks();
}

// silent: refresh in place (no loading indicator) so the list stays mounted
// and the scroll position is preserved
async function fetchTasks({ silent = false } = {}) {
  if (!silent) {
    loading.value = true;
  }
  try {
    const doneSince = new Date(
      Date.now() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    await tasksStore.fetchAll(projectsStore.selectedProjectFilter || undefined, {
      doneSince,
    });
  } catch {
    // Handle error
  } finally {
    if (!silent) {
      loading.value = false;
    }
  }
}

onMounted(async () => {
  try {
    await Promise.all([projectsStore.fetchAll(), statusesStore.fetchAll()]);
    await fetchTasks();
  } catch {
    // Handle error
  }
});

// Refresh list when task dialog closes
useDialogCloseRefresh("taskId", () => fetchTasks({ silent: true }));
</script>

<style scoped>
.kanban-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header-controls {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

.kanban-board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--space-md);
  overflow-x: auto;
  flex: 1 1 auto;
  min-height: 0;
}

.kanban-column {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  min-height: 200px;
  max-height: 90%;
  display: flex;
  flex-direction: column;
}

.column-header {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-widest);
  text-align: center;
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 2px solid var(--status-color, var(--color-primary));
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2xs);
  color: var(--color-text-muted);
}

.column-count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  background: var(--status-color, var(--color-primary));
  color: var(--status-contrast, var(--color-on-primary));
  border-radius: var(--radius-full);
  padding: 0 6px;
  line-height: var(--leading-loose);
}

.column-hint {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  text-transform: none;
  letter-spacing: normal;
}

.column-tasks {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
  padding: 2px;
  flex: 1 1 auto;
  min-height: 60px;
  overflow-y: auto;
}

/* flex-shrink: 0 keeps cards at their natural height so the list scrolls
   inside the capped column instead of squashing the cards (same pattern
   as the dashboard task-list) */
.column-tasks > * {
  flex-shrink: 0;
}

.column-tasks.drag-over {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  outline: 2px dashed var(--color-primary);
  outline-offset: -2px;
}

.empty-column {
  text-align: center;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  padding: var(--space-md) 0;
  opacity: 0.6;
}

/* On mobile the 200px minimum makes short columns barely usable for
   drag-and-drop, so raise it by 50% (same breakpoint as calendar/Navigation) */
@media (max-width: 767px) {
  .kanban-column {
    min-height: 300px;
  }
}
</style>
