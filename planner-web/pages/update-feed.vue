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
          <article v-for="entry in entries" :key="entry.id" class="feed-entry">
            <button
              class="entry-main"
              :title="entry.taskTitle"
              @click="openTask(entry.taskId)"
            >
              <span class="entry-title">{{ entry.taskTitle }}</span>
              <span class="entry-summary">
                <span v-if="entry.actorName" class="entry-actor">
                  <i class="bi bi-person-fill" /> {{ entry.actorName }}
                </span>
                {{ entry.summary }}
              </span>
            </button>
            <time
              class="entry-date"
              :title="formatFullDate(entry.dateCreated)"
            >
              {{ formatRelativeTime(entry.dateCreated) }}
            </time>
          </article>
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
import { formatRelativeTime } from "../utils/relativeTime";

const PAGE_SIZE = 50;

const tasksStore = useTasksStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const loadingMore = ref(false);
const entries = ref([]);

// The server answers at most `limit` rows per page: a full page means there
// may be more
const hasMore = computed(() => entries.value.length >= PAGE_SIZE);

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
  await fetchFeed();
});

// Refresh when the task dialog closes: the dialog may have changed the task
useDialogCloseRefresh("taskId", () => fetchFeed({ silent: true }));
</script>

<style scoped>
.update-feed-page {
  max-width: 800px;
  margin: 0 auto;
}

.feed-list {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}

.feed-entry {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-xs) var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-border);
}

.feed-entry:last-child {
  border-bottom: none;
}

.entry-main {
  /* Block-level grid: the global design system makes buttons inline-flex with
     centered content, which would center and clip the two text lines */
  display: grid;
  width: 100%;
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  gap: var(--space-2xs);
}

.entry-main:hover .entry-title {
  color: var(--color-primary);
  text-decoration: underline;
}

.entry-title {
  font-weight: var(--weight-semibold);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-summary {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-actor {
  font-weight: var(--weight-medium);
  color: var(--color-text);
  margin-right: var(--space-2xs);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.entry-date {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.load-more {
  text-align: center;
  margin: var(--space-md) 0 var(--space-xl);
}

.load-more button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: var(--space-xl) var(--space-md);
  color: var(--color-text-muted);
}

/* Mobile: the date moves under the summary instead of competing for width */
@media (max-width: 767px) {
  .feed-entry {
    grid-template-columns: 1fr;
  }

  .entry-date {
    order: 1;
  }
}
</style>
