<template>
  <div class="kanban-page">
    <header class="page-header">
      <hgroup>
        <h1>Tasks</h1>
        <p>Kanban board</p>
      </hgroup>
      <div class="header-controls">
        <select
          :value="projectsStore.selectedProjectFilter"
          @change="onFilterChange"
        >
          <option value="">All projects</option>
          <option v-for="p in projectsStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
        <button class="fab-button" @click="showCreateDialog = true">
          <i class="bi bi-plus-lg" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <div v-else class="kanban-board">
      <div v-for="status in statuses" :key="status" class="kanban-column">
        <h3 class="column-header">
          {{ status }}
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
const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
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
    return project?.statuses || ["To Do", "In Progress", "Done"];
  }
  // Collect statuses from all projects preserving their defined order
  const orderedStatuses = [];
  const seen = new Set();
  for (const project of projectsStore.projects) {
    if (project.statuses) {
      for (const status of project.statuses) {
        if (!seen.has(status)) {
          seen.add(status);
          orderedStatuses.push(status);
        }
      }
    }
  }
  // Add any statuses from tasks not in any project's status list
  for (const task of tasksStore.tasks) {
    if (!seen.has(task.status)) {
      seen.add(task.status);
      orderedStatuses.push(task.status);
    }
  }
  return orderedStatuses.length > 0
    ? orderedStatuses
    : ["To Do", "In Progress", "Done"];
});

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
    await fetchTasks();
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

function onFilterChange(event) {
  projectsStore.setProjectFilter(event.target.value);
  fetchTasks();
}

async function fetchTasks() {
  loading.value = true;
  try {
    await tasksStore.fetchAll(projectsStore.selectedProjectFilter || undefined);
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
    await fetchTasks();
  } catch {
    // Handle error
  }
});

// Refresh list when task dialog closes
watch(
  () => route.query.taskId,
  (newVal, oldVal) => {
    if (oldVal && !newVal) {
      fetchTasks();
    }
  },
);
</script>

<style scoped>
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
}

.kanban-column {
  background: var(--pico-card-background-color);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  min-height: 200px;
}

.column-header {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-widest);
  text-align: center;
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 2px solid var(--pico-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2xs);
  color: var(--pico-muted-color);
}

.column-count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  border-radius: var(--radius-full);
  padding: 0 6px;
  line-height: var(--leading-loose);
}

.column-tasks {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-height: 60px;
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
  padding: 2px;
}

.column-tasks.drag-over {
  background: color-mix(in srgb, var(--pico-primary) 10%, transparent);
  outline: 2px dashed var(--pico-primary);
  outline-offset: -2px;
}

.empty-column {
  text-align: center;
  font-size: var(--text-sm);
  color: var(--pico-muted-color);
  padding: var(--space-md) 0;
  opacity: 0.6;
}
</style>
