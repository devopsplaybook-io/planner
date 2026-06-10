<template>
  <div class="project-detail">
    <div v-if="loading" class="loading-indicator"/>

    <template v-else-if="project">
      <header class="detail-header">
        <div>
          <NuxtLink to="/projects" class="back-link"
            ><i class="bi bi-arrow-left"/> Projects</NuxtLink
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
            <i class="bi bi-trash"/>
          </button>
        </div>
      </header>

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
          <article
            v-for="task in tasks"
            :key="task.id"
            class="task-item"
            @click="router.push(`/tasks/${task.id}`)"
          >
            <header>
              <span :class="'priority-' + task.priority">
                <i class="bi bi-flag"/>
              </span>
              <span>{{ task.title }}</span>
              <small>{{ task.status }}</small>
            </header>
          </article>
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
        <footer>
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
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const router = useRouter();
const route = useRoute();

const project = computed(() => projectsStore.currentProject);
const tasks = computed(() =>
  tasksStore.tasks.filter((t) => t.projectId === route.params.id),
);
const loading = ref(true);
const showDeleteConfirm = ref(false);
const deleting = ref(false);

onMounted(async () => {
  try {
    await projectsStore.fetchById(route.params.id);
    await tasksStore.fetchAll(route.params.id);
  } catch {
    router.push("/projects");
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
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1em;
}

.back-link {
  text-decoration: none;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  gap: 0.3em;
}

.header-actions {
  display: flex;
  gap: 0.5em;
}

section {
  margin-bottom: 1.5em;
}

.status-list {
  display: flex;
  gap: 0.3em;
  flex-wrap: wrap;
}

.status-badge {
  padding: 0.2em 0.5em;
  border-radius: 0.3em;
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
  font-size: 0.85em;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
}

.task-item {
  cursor: pointer;
  padding: 0.5em 0.8em;
}

.task-item header {
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0;
  height: auto;
}

.task-item header small {
  margin-left: auto;
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

.empty-state {
  text-align: center;
  padding: 2em;
  color: var(--pico-muted-color);
}
</style>
