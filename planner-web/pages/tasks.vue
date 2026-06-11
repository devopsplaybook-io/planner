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
          <i class="bi bi-plus-lg" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <div v-else class="kanban-board">
      <div v-for="status in statuses" :key="status" class="kanban-column">
        <h3 class="column-header">{{ status }}</h3>
        <div
          class="column-tasks"
          @dragover.prevent
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
          />
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
            />
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
          <fieldset>
            <legend>Checklist</legend>
            <div
              v-for="(item, idx) in newTask.checklist"
              :key="idx"
              class="checklist-input-row"
            >
              <input
                v-model="newTask.checklist[idx].text"
                type="text"
                placeholder="Checklist item"
              />
              <button
                type="button"
                class="small secondary"
                @click="removeChecklistItem(idx)"
              >
                <i class="bi bi-x" />
              </button>
            </div>
            <button type="button" class="small" @click="addChecklistItem">
              <i class="bi bi-plus" /> Add item
            </button>
          </fieldset>
          <footer class="dialog-footer">
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

    <TaskDetailDialog
      :task-id="selectedTaskId"
      @close="selectedTaskId = null"
      @updated="fetchTasks"
    />
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();

const loading = ref(true);
const selectedProjectId = ref("");
const showCreateDialog = ref(false);
const creating = ref(false);
const dragTask = ref(null);
const selectedTaskId = ref(null);

const newTask = ref({
  projectId: "",
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
  checklist: [],
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

function openTask(task) {
  selectedTaskId.value = task.id;
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

function addChecklistItem() {
  newTask.value.checklist.push({ text: "", done: false });
}

function removeChecklistItem(idx) {
  newTask.value.checklist.splice(idx, 1);
}

async function createTask() {
  creating.value = true;
  try {
    const data = {
      projectId: newTask.value.projectId,
      title: newTask.value.title,
      description: newTask.value.description,
      priority: newTask.value.priority,
      dueDate: newTask.value.dueDate || undefined,
      checklist: newTask.value.checklist.filter((c) => c.text.trim()),
    };
    await tasksStore.create(data);
    showCreateDialog.value = false;
    newTask.value = {
      projectId: selectedProjectId.value,
      title: "",
      description: "",
      priority: "medium",
      dueDate: "",
      checklist: [],
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
  font-size: 1em;
  text-align: center;
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 2px solid var(--pico-primary);
}

.column-tasks {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.checklist-input-row {
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
}

.checklist-input-row input {
  flex: 1;
}

.checklist-input-row button {
  padding: 0.2em 0.5em;
}
</style>
