<template>
  <div class="project-detail">
    <div v-if="loading" class="loading-indicator" />

    <template v-else-if="project">
      <header class="detail-header">
        <div>
          <NuxtLink to="/projects" class="back-link"
            ><i class="bi bi-arrow-left" /> Projects</NuxtLink
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

      <!-- Statuses -->
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
        <div class="status-list">
          <span
            v-for="status in project.statuses"
            :key="status"
            class="status-badge"
            >{{ status }}</span
          >
        </div>
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

    <TaskDetailDialog
      :task-id="selectedTaskId"
      @close="selectedTaskId = null"
      @updated="refreshTasks"
    />
  </div>
</template>

<script setup>
import api from "../../utils/api";

const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const route = useRoute();

const project = computed(() => projectsStore.currentProject);
const tasks = computed(() =>
  tasksStore.tasks.filter((t) => t.projectId === route.params.id),
);
const loading = ref(true);
const showDeleteConfirm = ref(false);
const deleting = ref(false);
const selectedTaskId = ref(null);

const editVisibility = ref("public");
const editUserAccess = ref([]);
const availableUsers = ref([]);

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
  selectedTaskId.value = task.id;
}

async function refreshTasks() {
  await tasksStore.fetchAll(route.params.id);
}

onMounted(async () => {
  try {
    await projectsStore.fetchById(route.params.id);
    await tasksStore.fetchAll(route.params.id);
    if (project.value) {
      editVisibility.value = project.value.visibility || "public";
      editUserAccess.value = [...(project.value.userAccess || [])];
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
    router.push("/projects");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete project");
  } finally {
    deleting.value = false;
    showDeleteConfirm.value = false;
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

.status-list {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
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
