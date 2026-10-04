<template>
  <div ref="pageRoot" class="update-feed-page">
    <header class="page-header">
      <hgroup>
        <h1>Update Feed</h1>
        <p>Latest activity on your tasks</p>
      </hgroup>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <template v-else>
      <div v-if="entries.length === 0" class="empty-state">
        <i class="bi bi-activity" />
        <p>No updates yet.</p>
      </div>

      <template v-else>
        <div class="feed-list">
          <section
            v-for="group in groups"
            :key="group.key"
            class="day-group"
          >
            <h2 class="day-header">{{ group.label }}</h2>
            <!-- div, not article: the shared item-card pattern is built for divs
                 (bare <article> carries Pico's own card padding and header/footer
                 margins — same reason TaskCard/NoteCard/ProjectCard are divs) -->
            <div
              v-for="entry in group.entries"
              :key="entry.id"
              class="item-card feed-entry"
              role="button"
              tabindex="0"
              :title="entry.taskTitle"
              @click="openTask(entry.taskId)"
              @keydown.enter="openTask(entry.taskId)"
            >
              <div class="card-accent" />
              <div class="card-body">
                <header>
                  <div class="card-title-row">
                    <span class="item-icon"><i class="bi bi-kanban" /></span>
                    <span class="item-title">{{ entry.taskTitle }}</span>
                  </div>
                  <small
                    class="card-date"
                    :title="formatFullDate(entry.dateCreated)"
                  >
                    {{ formatRelativeTime(entry.dateCreated) }}
                  </small>
                </header>
                <p class="card-desc">
                  <span v-if="entry.actorName" class="entry-actor">
                    <i class="bi bi-person-fill" /> {{ entry.actorName }}
                  </span>
                  {{ entry.summary }}
                </p>
                <footer>
                  <span
                    class="status-badge"
                    :style="statusBadgeStyle(entry.status)"
                    :title="entry.status"
                    >{{ entry.status }}</span
                  >
                  <span
                    v-if="projectName(entry.projectId)"
                    class="project-name"
                    :title="projectName(entry.projectId)"
                    >{{ projectName(entry.projectId) }}</span
                  >
                </footer>
              </div>
            </div>
          </section>
        </div>

        <div v-if="loadingMore" class="loading-more-row">
          <span class="spinner" aria-hidden="true" /> Loading…
        </div>
        <div v-if="loadError && hasMore" class="load-more">
          <button :disabled="loadingMore" @click="loadMore">Load more</button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { useInfiniteScroll } from "@vueuse/core";
import { readableTextColor } from "../utils/statusColor";
import { displayName } from "../utils/projectHierarchy";
import { formatRelativeTime } from "../utils/relativeTime";
import { groupEntriesByDay } from "../utils/updateFeedGroups";

const PAGE_SIZE = 50;

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const loadingMore = ref(false);
const entries = ref([]);
const loadError = ref(false);
const refreshing = ref(false);
const pageRoot = ref(null);
const scroller = ref(null);

// The server answers at most `limit` rows per page: a full page means there
// may be more
const hasMore = computed(() => entries.value.length >= PAGE_SIZE);

// Day grouping is derived from the flat entries list, so appending a page
// never needs merge logic (entries from one day across a page boundary
// merge naturally)
const groups = computed(() => groupEntriesByDay(entries.value));

const { reset: resetInfiniteScroll } = useInfiniteScroll(
  scroller,
  () => loadMore(),
  {
    distance: 400,
    // Keep the flat entry count (not the day groups) as the paging signal
    canLoadMore: () =>
      hasMore.value &&
      !loading.value &&
      !loadingMore.value &&
      !refreshing.value,
  },
);

// Same status badge as TaskCard: colored from the status catalog
function statusBadgeStyle(status) {
  const color = statusesStore.colorFor(status);
  return { background: color, color: readableTextColor(color) };
}

function projectName(projectId) {
  const project = projectsStore.projects.find((p) => p.id === projectId);
  return project ? displayName(project.name) : "";
}

function formatFullDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString();
}

function openTask(taskId) {
  // Opens the app-level task dialog, like everywhere else
  router.replace({
    path: route.path,
    query: { ...route.query, taskId },
  });
}

// silent: refresh in place (no loading indicator) so the feed stays mounted
// and the scroll position is preserved
async function fetchFeed({ silent = false } = {}) {
  if (!silent) {
    loading.value = true;
    entries.value = [];
  } else {
    // A silent refresh replaces the flat list: pause paging until it lands,
    // then re-arm the scroll check
    refreshing.value = true;
  }
  try {
    entries.value = await tasksStore.fetchUpdateFeed({ limit: PAGE_SIZE });
    loadError.value = false;
  } catch {
    // Handle error silently
  } finally {
    if (!silent) {
      loading.value = false;
    } else {
      refreshing.value = false;
      resetInfiniteScroll();
    }
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || refreshing.value) return;
  loadingMore.value = true;
  try {
    const next = await tasksStore.fetchUpdateFeed({
      limit: PAGE_SIZE,
      offset: entries.value.length,
    });
    entries.value = entries.value.concat(next);
    loadError.value = false;
  } catch {
    // Keep the current entries on failure; the retry button covers the edge
    // where no further scroll event fires after an error
    loadError.value = true;
  } finally {
    loadingMore.value = false;
  }
}

onMounted(async () => {
  // The app shell scrolls inside <main> (app.vue, overflow-y: auto), not the
  // window: the infinite scroll must observe it
  scroller.value = pageRoot.value?.closest("main") ?? null;
  // Status colors and project names for the entries (same as history page)
  try {
    await Promise.all([projectsStore.fetchAll(), statusesStore.fetchAll()]);
  } catch {
    // The feed still renders without them
  }
  await fetchFeed();
});

// Refresh when the task dialog closes: the dialog may have changed the task
useDialogCloseRefresh("taskId", () => fetchFeed({ silent: true }));
</script>

<style scoped>
/* Same content width as the dashboard (the feed's sibling view) */
.update-feed-page {
  max-width: 800px;
  margin: 0 auto;
}

.feed-list {
  display: grid;
  gap: var(--space-xs);
}

.day-group {
  display: grid;
  gap: var(--space-xs);
}

/* Compact section header, visually subordinate to the page h1 */
.day-header {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
  letter-spacing: var(--tracking-wide);
  margin: var(--space-sm) 0 var(--space-xs);
}

.feed-entry:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.card-date {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.card-desc {
  margin: 0;
  font-size: var(--text-base);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-actor {
  font-weight: var(--weight-semibold);
  color: var(--color-text-secondary);
  margin-right: var(--space-2xs);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

/* Status badge (same look as TaskCard's) colored via the status catalog,
   then the project name fills the rest of the row with an ellipsis */
.status-badge {
  flex-shrink: 0;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  padding: 0.1em 0.5em;
  border-radius: var(--radius-full);
  background: var(--color-text-muted);
  color: #fff;
  white-space: nowrap;
}

.project-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.loading-more-row {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-xs);
  margin: var(--space-md) 0 var(--space-xl);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.loading-more-row .spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: var(--radius-full);
  animation: busy-spinner 0.75s linear infinite;
}

/* Manual retry for a failed page (infinite scroll handles the normal flow) */
.load-more {
  text-align: center;
  margin: var(--space-md) 0 var(--space-xl);
}

.load-more button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
