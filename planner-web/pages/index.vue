<template>
  <div class="dashboard">
    <hgroup>
      <h1>Dashboard</h1>
      <p>Tasks that need your attention</p>
    </hgroup>

    <div v-if="loading" class="loading-indicator"></div>

    <template v-else>
      <!-- Overdue Tasks -->
      <section v-if="overdueTasks.length > 0">
        <h2><i class="bi bi-exclamation-triangle"></i> Overdue</h2>
        <div class="task-list">
          <article
            v-for="task in overdueTasks"
            :key="task.id"
            class="task-card overdue"
          >
            <header>
              <NuxtLink :to="`/tasks/${task.id}`">{{ task.title }}</NuxtLink>
              <small>{{ task.dueDate }}</small>
            </header>
            <p v-if="task.description" class="task-desc">
              {{ truncate(task.description, 100) }}
            </p>
          </article>
        </div>
      </section>

      <!-- Upcoming Tasks (due within 3 days) -->
      <section v-if="upcomingTasks.length > 0">
        <h2><i class="bi bi-clock"></i> Upcoming</h2>
        <div class="task-list">
          <article
            v-for="task in upcomingTasks"
            :key="task.id"
            class="task-card"
          >
            <header>
              <NuxtLink :to="`/tasks/${task.id}`">{{ task.title }}</NuxtLink>
              <small>{{ task.dueDate }}</small>
            </header>
            <p v-if="task.description" class="task-desc">
              {{ truncate(task.description, 100) }}
            </p>
          </article>
        </div>
      </section>

      <!-- High Priority Tasks -->
      <section v-if="highPriorityTasks.length > 0">
        <h2><i class="bi bi-flag"></i> High Priority</h2>
        <div class="task-list">
          <article
            v-for="task in highPriorityTasks"
            :key="task.id"
            class="task-card high-priority"
          >
            <header>
              <NuxtLink :to="`/tasks/${task.id}`">{{ task.title }}</NuxtLink>
              <small>{{ task.status }}</small>
            </header>
            <p v-if="task.description" class="task-desc">
              {{ truncate(task.description, 100) }}
            </p>
          </article>
        </div>
      </section>

      <div
        v-if="
          overdueTasks.length === 0 &&
          upcomingTasks.length === 0 &&
          highPriorityTasks.length === 0
        "
        class="empty-state"
      >
        <i class="bi bi-check-circle"></i>
        <p>All caught up! No tasks need immediate attention.</p>
      </div>
    </template>
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();

const loading = ref(true);

const overdueTasks = computed(() =>
  tasksStore.tasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "Done",
  ),
);

const upcomingTasks = computed(() => {
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return tasksStore.tasks.filter(
    (t) =>
      t.dueDate &&
      new Date(t.dueDate) >= now &&
      new Date(t.dueDate) <= in3Days &&
      t.status !== "Done",
  );
});

const highPriorityTasks = computed(() =>
  tasksStore.tasks.filter(
    (t) => t.priority === "high" && t.status !== "Done" && !t.dueDate,
  ),
);

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) + "..." : text;
}

onMounted(async () => {
  try {
    await tasksStore.fetchAll();
  } catch {
    // Handle error silently
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.dashboard {
  max-width: 800px;
  margin: 0 auto;
}

section {
  margin-bottom: 1.5em;
}

section h2 {
  font-size: 1.1em;
  margin-bottom: 0.5em;
  display: flex;
  align-items: center;
  gap: 0.3em;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 0.5em;
}

.task-card {
  padding: 0.5em 0.8em;
}

.task-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0;
  height: auto;
}

.task-card header a {
  font-weight: bold;
}

.task-desc {
  margin-top: 0.3em;
  font-size: 0.9em;
  color: var(--pico-muted-color);
}

.empty-state {
  text-align: center;
  padding: 3em;
  color: var(--pico-muted-color);
}

.empty-state i {
  font-size: 3em;
  margin-bottom: 0.5em;
}
</style>
