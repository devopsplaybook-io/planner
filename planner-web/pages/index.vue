<template>
  <div class="dashboard">
    <header class="page-header">
      <hgroup>
        <h1>Dashboard</h1>
        <p>Tasks that need your attention</p>
      </hgroup>
      <div class="header-controls">
        <select v-model="filterProjectId" @change="fetchDashboard">
          <option value="">All projects</option>
          <option v-for="p in projectsStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <section v-if="dashboardData.overdue.length > 0">
        <h2><i class="bi bi-exclamation-triangle" /> Overdue</h2>
        <div class="task-list">
          <TaskCard
            v-for="task in dashboardData.overdue"
            :key="task.id"
            :task="task"
            @click="openTask(task)"
          />
        </div>
      </section>

      <section v-if="dashboardData.upcoming.length > 0">
        <h2><i class="bi bi-clock" /> Upcoming</h2>
        <div class="task-list">
          <TaskCard
            v-for="task in dashboardData.upcoming"
            :key="task.id"
            :task="task"
            @click="openTask(task)"
          />
        </div>
      </section>

      <section v-if="dashboardData.noDate.length > 0">
        <h2><i class="bi bi-inbox" /> No Due Date</h2>
        <div class="task-list">
          <TaskCard
            v-for="task in dashboardData.noDate"
            :key="task.id"
            :task="task"
            @click="openTask(task)"
          />
        </div>
      </section>

      <section v-if="dashboardData.recentlyDone.length > 0">
        <h2><i class="bi bi-check-circle" /> Recently Done</h2>
        <div class="task-list">
          <TaskCard
            v-for="task in dashboardData.recentlyDone"
            :key="task.id"
            :task="task"
            @click="openTask(task)"
          />
        </div>
      </section>

      <div
        v-if="
          dashboardData.overdue.length === 0 &&
          dashboardData.upcoming.length === 0 &&
          dashboardData.noDate.length === 0 &&
          dashboardData.recentlyDone.length === 0
        "
        class="empty-state"
      >
        <i class="bi bi-check-circle" />
        <p>All caught up! No tasks need immediate attention.</p>
      </div>
    </template>

    <TaskDetailDialog
      :task-id="selectedTaskId"
      @close="selectedTaskId = null"
      @updated="refreshDashboard"
    />
  </div>
</template>

<script setup>
const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();

const loading = ref(true);
const filterProjectId = ref("");
const selectedTaskId = ref(null);
const dashboardData = ref({
  overdue: [],
  upcoming: [],
  noDate: [],
  recentlyDone: [],
});

async function fetchDashboard() {
  loading.value = true;
  try {
    const params = {};
    if (filterProjectId.value) {
      params.projectId = filterProjectId.value;
    }
    dashboardData.value = await tasksStore.fetchDashboard(params);
  } catch {
    // Handle error silently
  } finally {
    loading.value = false;
  }
}

function openTask(task) {
  selectedTaskId.value = task.id;
}

async function refreshDashboard() {
  await fetchDashboard();
}

onMounted(async () => {
  await projectsStore.fetchAll();
  await fetchDashboard();
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
  gap: 0.3em;
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
