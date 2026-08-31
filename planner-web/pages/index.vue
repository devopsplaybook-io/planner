<template>
  <div class="dashboard">
    <header class="page-header">
      <hgroup>
        <h1>Dashboard</h1>
        <p>Tasks that need your attention</p>
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

    <template v-else>
      <!-- LLM Recommendations Section -->
      <section
        v-if="recommendationStore.isLlmEnabled"
        class="recommendation-section"
      >
        <h2>
          <i class="bi bi-lightbulb" /> AI Recommendations
          <button
            v-if="recommendationStore.isLlmEnabled"
            class="btn-regenerate"
            :disabled="recommendationStore.generating"
            @click="regenerate"
          >
            <i
              class="bi bi-arrow-clockwise"
              :class="{ spin: recommendationStore.generating }"
            />
            {{
              recommendationStore.generating ? "Generating..." : "Regenerate"
            }}
          </button>
        </h2>
        <div v-if="recommendationStore.loading" class="loading-indicator" />
        <div
          v-else-if="recommendationStore.hasRecommendation"
          class="recommendation-content"
        >
          <p class="recommendation-date">
            Generated:
            {{ formatDate(recommendationStore.recommendation.generatedAt) }}
          </p>
          <div
            v-if="recommendationStore.recommendation.analysis"
            class="recommendation-block"
          >
            <div
              v-html="
                renderMarkdown(recommendationStore.recommendation.analysis)
              "
            />
          </div>
          <div
            v-if="recommendationStore.recommendation.recommendations"
            class="recommendation-block"
          >
            <div
              v-html="
                renderMarkdown(
                  recommendationStore.recommendation.recommendations,
                )
              "
            />
          </div>
        </div>
        <div v-else class="empty-state">
          <i class="bi bi-lightbulb" />
          <p>
            No recommendations yet. Click "Regenerate" to get AI-powered
            insights.
          </p>
        </div>
      </section>

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
  </div>

  <TaskCreateDialog
    :open="showCreateDialog"
    @close="showCreateDialog = false"
    @created="fetchDashboard"
  />
</template>

<script setup>
import { marked } from "marked";

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const recommendationStore = useRecommendationStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const showCreateDialog = ref(false);
const dashboardData = ref({
  overdue: [],
  upcoming: [],
  noDate: [],
  recentlyDone: [],
});

function renderMarkdown(text) {
  if (!text) return "";
  const html = marked(text, { breaks: true });
  return injectTaskLinks(html);
}

function injectTaskLinks(html) {
  if (!html || !recommendationStore.recommendation?.tasks) return html;
  let result = html;
  for (const task of recommendationStore.recommendation.tasks) {
    const escapedId = task.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escapedId, "g");
    result = result.replace(
      regex,
      `<a href="/tasks/${task.id}" class="task-badge">${task.title}</a>`,
    );
  }
  return result;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

async function regenerate() {
  await recommendationStore.regenerateRecommendation();
}

function onFilterChange(event) {
  projectsStore.setProjectFilter(event.target.value);
  fetchDashboard();
}

async function fetchDashboard() {
  loading.value = true;
  try {
    const params = {};
    if (projectsStore.selectedProjectFilter) {
      params.projectId = projectsStore.selectedProjectFilter;
    }
    dashboardData.value = await tasksStore.fetchDashboard(params);
  } catch {
    // Handle error silently
  } finally {
    loading.value = false;
  }
}

function openTask(task) {
  router.replace({
    path: route.path,
    query: { ...route.query, taskId: task.id },
  });
}

onMounted(async () => {
  await projectsStore.fetchAll();
  await recommendationStore.fetchConfig();
  if (recommendationStore.isLlmEnabled) {
    await recommendationStore.fetchRecommendation();
  }
  await fetchDashboard();
});
</script>

<style scoped>
.dashboard {
  max-width: 800px;
  margin: 0 auto;
}

.header-controls {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

section {
  margin-bottom: var(--space-lg);
}

section h2 {
  font-size: var(--text-lg);
  margin-bottom: var(--space-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.recommendation-section {
  margin-bottom: var(--space-lg);
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.recommendation-section h2 {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  justify-content: space-between;
}

.btn-regenerate {
  font-size: var(--text-base);
  padding: 0.25em 0.75em;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.btn-regenerate:hover:not(:disabled) {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.btn-regenerate:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.recommendation-content {
  max-height: 25vh;
  overflow-y: auto;
}

.recommendation-content :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  cursor: pointer;
}

.recommendation-content :deep(.task-badge) {
  display: inline-block;
  padding: 0.05em 0.5em;
  margin: 0 0.1em;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-radius: var(--radius-md);
  text-decoration: none;
  line-height: var(--leading-normal);
  white-space: nowrap;
}

.recommendation-content :deep(.task-badge:hover) {
  filter: brightness(1.15);
}

.recommendation-date {
  font-size: var(--text-base);
  opacity: 0.7;
  margin-bottom: var(--space-sm);
}

.recommendation-block {
  margin-bottom: var(--space-md);
  line-height: var(--leading-loose);
}

.recommendation-block :deep(p) {
  margin-bottom: var(--space-sm);
}

.recommendation-block :deep(ul),
.recommendation-block :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: var(--space-sm);
}
</style>
