<template>
  <div class="update-feed-page">
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
          <!-- div, not article: the shared item-card pattern is built for divs
               (bare <article> carries Pico's own card padding and header/footer
               margins — same reason TaskCard/NoteCard/ProjectCard are divs) -->
          <div
            v-for="entry in entries"
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
        </div>

        <div v-if="hasMore" class="load-more">
          <button :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? "Loading…" : "Load more" }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { readableTextColor } from "../utils/statusColor";
import { displayName } from "../utils/projectHierarchy";
import { formatRelativeTime } from "../utils/relativeTime";

const PAGE_SIZE = 50;

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const statusesStore = useStatusesStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const loadingMore = ref(false);
const entries = ref([]);

// The server answers at most `limit` rows per page: a full page means there
// may be more
const hasMore = computed(() => entries.value.length >= PAGE_SIZE);

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
  }
  try {
    entries.value = await tasksStore.fetchUpdateFeed({ limit: PAGE_SIZE });
  } catch {
    // Handle error silently
  } finally {
    if (!silent) {
      loading.value = false;
    }
  }
}

async function loadMore() {
  loadingMore.value = true;
  try {
    const next = await tasksStore.fetchUpdateFeed({
      limit: PAGE_SIZE,
      offset: entries.value.length,
    });
    entries.value = entries.value.concat(next);
  } catch {
    // Keep the current entries on failure
  } finally {
    loadingMore.value = false;
  }
}

onMounted(async () => {
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

.load-more {
  text-align: center;
  margin: var(--space-md) 0 var(--space-xl);
}

.load-more button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
