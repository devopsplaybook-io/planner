<template>
  <div class="kanban-page">
    <header class="page-header">
      <hgroup>
        <h1>Tasks</h1>
        <p>Kanban board</p>
      </hgroup>
      <div class="header-controls">
        <select v-model="selectedProjectId" @change="fetchTasks">
          <option value="">All projects</option>
          <option v-for="p in projectsStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
        <button class="fab-button" @click="showCreateDialog = true">
          <i class="bi bi-plus-lg"></i>
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator"></div>

    <div v-else class="kanban-board">
      <div v-for="status in statuses" :key="status" class="kanban-column">
        <h3 class="column-header">{{ status }}</h3>
        <div class="column-tasks">
          <article
            v-for="task in getTasksByStatus(status)"
            :key="task.id"
            class="kanban-card"
            draggable="true"
            @dragstart="onDragStart($event, task)"
            @dragover.prevent
            @drop="onDrop($event, status)"
            @click="router.push(`/tasks/${task.id}`)"
          >
            <header>
              <span :class="'priority-' + task.priority">
                <i class="bi bi-flag"></i>
              </span>
              <span class="task-title">{{ task.title }}</span>
            </header>
            <footer>
              <small v-if="task.dueDate">{{ task.dueDate }}</small>
              <small v-if="task.assignees.length">
                <i class="bi bi-people"></i> {{ task.assignees.length }}
              </small>
            </footer>
          </article>
        </div>
      </div>
    </div>

    <!-- Create Dialog -->
    <dialog :open="showCreateDialog">
      <article>
        <header>
          <h3>Create Task</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="showCreateDialog = false"
          ></button>
        </header>
        <form @submit.prevent="createTask">
          <label>
            Project
            <select v-model="newTask.projectId" required>
              <option
                v-for="p in projectsStore.projects"
                :key="p.id"
                :value="p.id"
              >
                {{ p.name }}
              </option>
            </select>
          </label>
          <label>
            Title
            <input
              v-model="newTask.title"
              type="text"
              required
              placeholder="Task title"
            />
          </label>
          <label>
            Description
            <textarea
              v-model="newTask.description"
              placeholder="Optional description"
            ></textarea>
          </label>
          <label>
            Priority
            <select v-model="newTask.priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Due date
            <input v-model="newTask.dueDate" type="date" />
          </label>
          <footer>
            <button type="submit" :aria-busy="creating">Create</button>
            <button
              class="secondary"
              type="button"
              @click="showCreateDialog = false"
            >
              Cancel
            </button>
          </footer>
        </form>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const router = useRouter();

const loading = ref(true);
const selectedProjectId = ref("");
const showCreateDialog = ref(false);
const creating = ref(false);
const dragTask = ref(null);

const newTask = ref({
  projectId: "",
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
});

const statuses = computed(() => {
  if (selectedProjectId.value) {
    const project = projectsStore.projects.find(
      (p) => p.id === selectedProjectId.value,
    );
    return project?.statuses || ["To Do", "In Progress", "Done"];
  }
  // Collect all unique statuses from tasks
  return [...new Set(tasksStore.tasks.map((t) => t.status))].sort();
});

function getTasksByStatus(status) {
  return tasksStore.tasks.filter((t) => t.status === status);
}

function onDragStart(event, task) {
  dragTask.value = task;
  event.dataTransfer.effectAllowed = "move";
}

async function onDrop(event, newStatus) {
  if (!dragTask.value || dragTask.value.status === newStatus) return;
  try {
    await tasksStore.update(dragTask.value.id, { status: newStatus });
  } catch {
    // Handle error
  }
  dragTask.value = null;
}

async function fetchTasks() {
  loading.value = true;
  try {
    await tasksStore.fetchAll(selectedProjectId.value || undefined);
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
}

async function createTask() {
  creating.value = true;
  try {
    const data = { ...newTask.value };
    if (!data.dueDate) delete data.dueDate;
    await tasksStore.create(data);
    showCreateDialog.value = false;
    newTask.value = {
      projectId: selectedProjectId.value,
      title: "",
      description: "",
      priority: "medium",
      dueDate: "",
    };
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create task");
  } finally {
    creating.value = false;
  }
}

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
    if (projectsStore.projects.length > 0) {
      selectedProjectId.value =
        projectsStore.defaultProject?.id || projectsStore.projects[0].id;
      newTask.value.projectId = selectedProjectId.value;
    }
    await fetchTasks();
  } catch {
    // Handle error
  }
});
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1em;
  flex-wrap: wrap;
  gap: 0.5em;
}

.header-controls {
  display: flex;
  gap: 0.5em;
  align-items: center;
}

.kanban-board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1em;
  overflow-x: auto;
}

.kanban-column {
  background: var(--pico-card-background-color);
  border-radius: 0.5em;
  padding: 0.5em;
  min-height: 200px;
}

.column-header {
  font-size: 1em;
  text-align: center;
  margin-bottom: 0.5em;
  padding-bottom: 0.3em;
  border-bottom: 2px solid var(--pico-primary);
}

.column-tasks {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}

.kanban-card {
  cursor: pointer;
  padding: 0.5em;
  font-size: 0.9em;
}

.kanban-card header {
  display: flex;
  align-items: center;
  gap: 0.3em;
  padding: 0;
  height: auto;
}

.kanban-card footer {
  display: flex;
  justify-content: space-between;
  padding: 0;
  margin-top: 0.3em;
}

.task-title {
  font-weight: bold;
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

.close-btn {
  background: none;
  border: none;
  font-size: 1.5em;
  cursor: pointer;
}

dialog article footer {
  display: flex;
  gap: 0.5em;
  justify-content: flex-end;
}
</style>
