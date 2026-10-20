<template>
  <div class="dashboard">
    <header class="page-header">
      <hgroup>
        <h1>Dashboard</h1>
        <p>Tasks that need your attention</p>
      </hgroup>
      <div class="header-controls">
        <ProjectSelect
          :model-value="projectsStore.selectedProjectFilter"
          all-label="All projects"
          @update:model-value="onFilterChange"
        />
        <div class="label-filter">
          <LabelMultiSelect
            v-model="selectedLabels"
            :suggestions="labelsStore.labels"
            placeholder="Filter by label…"
            aria-label="Filter by labels"
          />
        </div>
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
                renderRecommendationMarkdown(
                  recommendationStore.recommendation.analysis,
                )
              "
            />
          </div>
          <div
            v-if="recommendationStore.recommendation.recommendations"
            class="recommendation-block"
          >
            <div
              v-html="
                renderRecommendationMarkdown(
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

      <section v-if="recentlyDone.length > 0">
        <h2>
          <i class="bi bi-check-circle" /> Recently Done
          <span class="section-hint">last {{ DONE_WINDOW_DAYS }} days</span>
        </h2>
        <div class="task-list">
          <TaskCard
            v-for="task in recentlyDone"
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
          recentlyDone.length === 0
        "
        class="empty-state"
      >
        <i class="bi bi-check-circle" />
        <p>All caught up! No tasks need immediate attention.</p>
      </div>

      <nav class="page-links" aria-label="Dashboard views">
        <NuxtLink to="/history">
          <i class="bi bi-clock-history" /> History
        </NuxtLink>
        <NuxtLink to="/update-feed">
          <i class="bi bi-activity" /> Update Feed
        </NuxtLink>
      </nav>
    </template>
  </div>

  <TaskCreateDialog
    :open="showCreateDialog"
    @close="showCreateDialog = false"
    @created="onTaskCreated"
  />
</template>

<script setup>
import { renderMarkdown } from "../composables/useMarkdown";
import { parseLabelQuery, serializeLabelQuery } from "../utils/labels";

const DONE_WINDOW_DAYS = 30;

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();
const labelsStore = useLabelsStore();
const recommendationStore = useRecommendationStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const showCreateDialog = ref(false);
// Label filter: applies to every dashboard section, including the Recently
// Done list; empty selection = no filter. Initialized from ?labels= so a
// filtered view survives a reload or a shared/bookmarked URL.
const selectedLabels = ref(parseLabelQuery(route.query.labels));
const dashboardData = ref({
  overdue: [],
  upcoming: [],
  noDate: [],
});

// Like the kanban board: all Done tasks updated within the last 30 days.
// The server (doneSince) already limits Done tasks to the window, so a
// client-side status filter is enough.
const recentlyDone = computed(() =>
  tasksStore.tasks
    .filter((t) => t.status === "Done")
    .sort(
      (a, b) =>
        new Date(b.dateUpdated || b.dateCreated) -
        new Date(a.dateUpdated || a.dateCreated),
    ),
);

function renderRecommendationMarkdown(text) {
  if (!text) return "";
  return injectTaskLinks(renderMarkdown(text));
}

// Task titles are interpolated into HTML attributes and content below, so
// they must be escaped even though the markdown itself is already sanitized
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function injectTaskLinks(html) {
  if (!html || !recommendationStore.recommendation?.tasks) return html;
  let result = html;
  for (const task of recommendationStore.recommendation.tasks) {
    const escapedId = task.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escapedId, "g");
    result = result.replace(
      regex,
      `<a href="/tasks/${escapeHtml(task.id)}" class="task-badge">${escapeHtml(task.title)}</a>`,
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

function onFilterChange(projectId) {
  projectsStore.setProjectFilter(projectId);
  fetchDashboard();
}

// The chips are the visible hint; re-slice every section when the label
// selection changes and persist it in the URL (other query keys such as
// taskId are preserved) so the view is bookmarkable
watch(selectedLabels, (labels) => {
  const serialized = serializeLabelQuery(labels);
  if (serializeLabelQuery(parseLabelQuery(route.query.labels)) !== serialized) {
    router.replace({
      path: route.path,
      query: { ...route.query, labels: serialized },
    });
  }
  fetchDashboard({ silent: true });
});

// Follow URL changes to ?labels= (browser back/forward, shared links)
watch(
  () => route.query.labels,
  (value) => {
    if (
      serializeLabelQuery(parseLabelQuery(value)) !==
      serializeLabelQuery(selectedLabels.value)
    ) {
      selectedLabels.value = parseLabelQuery(value);
    }
  },
);

// silent: refresh in place (no loading indicator) so the view stays mounted
// and the scroll position is preserved
async function fetchDashboard({ silent = false } = {}) {
  if (!silent) {
    loading.value = true;
  }
  try {
    // A selected project filters its whole subtree (the project plus its
    // sub-projects); ids are expanded outside the select component
    const filterId = projectsStore.selectedProjectFilter;
    const projectIds = filterId
      ? projectsStore.subtreeProjectIds(filterId)
      : undefined;
    const params = projectIds ? { projectIds } : {};
    if (selectedLabels.value.length) {
      params.labels = selectedLabels.value.join(",");
    }
    const doneSince = new Date(
      Date.now() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [dashboard] = await Promise.all([
      tasksStore.fetchDashboard(params),
      tasksStore.fetchAll(undefined, {
        doneSince,
        projectIds,
        labels: selectedLabels.value,
      }),
    ]);
    dashboardData.value = dashboard;
  } catch {
    // Handle error silently
  } finally {
    if (!silent) {
      loading.value = false;
    }
  }
}

function openTask(task) {
  router.replace({
    path: route.path,
    query: { ...route.query, taskId: task.id },
  });
}

async function onTaskCreated(taskId) {
  // Open the task dialog on the freshly created task
  router.replace({
    path: route.path,
    query: { ...route.query, taskId },
  });
  await fetchDashboard({ silent: true });
}

// Dashboard data is a local snapshot (not a store computed), so refresh it
// when the task dialog closes: the dialog may have changed the task
useDialogCloseRefresh("taskId", () => fetchDashboard({ silent: true }));
// Regular in-place refresh: tasks may have been updated elsewhere; the silent
// refresh keeps the scroll position and re-reads the current filter
useRegularRefresh(() => fetchDashboard({ silent: true }));

onMounted(async () => {
  await Promise.all([
    projectsStore.fetchAll(),
    statusesStore.fetchAll(),
    labelsStore.fetchAll(),
  ]);
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
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header-controls {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

/* Compact chip editor: the filter stays one row with the project select;
   the dropdown still overflows the box by design */
.label-filter {
  width: 12rem;
  max-width: 40vw;
}

.label-filter :deep(.lms-input) {
  min-width: 6em;
}


section {
  margin-bottom: var(--space-lg);
}

/* The section is the percentage bridge: it caps at 90% of the dashboard
   area and its task-list scrolls internally when the tasks exceed that */
.dashboard > section {
  max-height: 90%;
  display: flex;
  flex-direction: column;
}

section h2 {
  font-size: var(--text-lg);
  margin-bottom: var(--space-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

/* Each section's list scrolls internally once the section reaches its 90%
   cap, so one long section can't push the others (and the History link)
   out of reach. flex-shrink: 0 keeps cards at their natural height:
   TaskCard has overflow: hidden, so a flex child with default
   flex-shrink would be squashed to a sliver instead of overflowing */
.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.task-list > * {
  flex-shrink: 0;
}

.section-hint {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--color-text-muted);
}

/* Bottom links row (History, Update Feed): flex-wrap so both links stay
   reachable on narrow screens. The extra bottom margin keeps the links
   from sitting against the main container's small (0.5em) padding. */
.page-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--space-md) var(--space-lg);
  margin: var(--space-xl) 0 var(--space-xl);
}

.page-links a {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-primary);
  text-decoration: none;
  font-weight: var(--weight-medium);
}

.page-links a:hover {
  text-decoration: underline;
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
  color: var(--color-text);
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

/* On mobile the 90% percentage bridge has less room to work with, so cap
   each task-list directly at 70vh (same breakpoint as calendar/Navigation) */
@media (max-width: 767px) {
  .task-list {
    max-height: 70vh;
  }
}
</style>
