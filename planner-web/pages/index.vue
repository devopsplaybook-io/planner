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
          <div
            v-if="recommendationStore.recommendation.tasks.length > 0"
            class="recommendation-tasks"
          >
            <h3>Referenced Tasks</h3>
            <div class="task-list">
              <TaskCard
                v-for="task in recommendationTasks"
                :key="task.id"
                :task="task"
                @click="openTask(task)"
              />
            </div>
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
</template>

<script setup>
import { marked } from "marked";

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const recommendationStore = useRecommendationStore();
const router = useRouter();

const loading = ref(true);
const filterProjectId = ref("");
const dashboardData = ref({
  overdue: [],
  upcoming: [],
  noDate: [],
  recentlyDone: [],
});

const recommendationTasks = computed(() => {
  if (!recommendationStore.recommendation?.tasks) return [];
  return recommendationStore.recommendation.tasks.map((t) => ({
    ...t,
    labels: [],
    assignees: [],
    comments: [],
    attachments: [],
    checklist: [],
    description: "",
    projectId: "",
    dateCreated: "",
    dateUpdated: "",
  }));
});

function renderMarkdown(text) {
  if (!text) return "";
  return marked(text, { breaks: true });
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

async function regenerate() {
  await recommendationStore.regenerateRecommendation();
}

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
  router.push(`/tasks/${task.id}`);
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
  font-size: 1.1em;
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
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 8px);
  background: var(--pico-card-background-color, rgba(255, 255, 255, 0.02));
}

.recommendation-section h2 {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  justify-content: space-between;
}

.btn-regenerate {
  font-size: 0.8em;
  padding: 0.25em 0.75em;
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 4px);
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
}

.btn-regenerate:hover:not(:disabled) {
  background: var(--pico-primary-background, #1095c1);
  color: var(--pico-primary-inverse, #fff);
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

.recommendation-date {
  font-size: 0.85em;
  opacity: 0.7;
  margin-bottom: var(--space-sm);
}

.recommendation-block {
  margin-bottom: var(--space-md);
  line-height: 1.6;
}

.recommendation-block :deep(p) {
  margin-bottom: 0.5em;
}

.recommendation-block :deep(ul),
.recommendation-block :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: 0.5em;
}

.recommendation-tasks {
  margin-top: var(--space-md);
}

.recommendation-tasks h3 {
  font-size: 1em;
  margin-bottom: var(--space-sm);
}
</style>
