<template>
  <div class="inbox-page">
    <header class="page-header">
      <hgroup>
        <h1>Inbox</h1>
        <p>Voice notes, quick captures and meeting transcripts</p>
      </hgroup>
      <div class="header-controls">
        <button
          v-if="importEnabled"
          type="button"
          class="header-button"
          @click="openMeetingImport()"
        >
          <i class="bi bi-file-earmark-music" />
          <span class="button-label">Import meeting</span>
        </button>
        <button
          v-if="captureEnabled"
          type="button"
          class="header-button primary"
          @click="openQuickCapture()"
        >
          <i class="bi bi-lightning-charge" />
          <span class="button-label">Capture</span>
        </button>
      </div>
    </header>

    <div class="filters" role="tablist" aria-label="Inbox filters">
      <button
        v-for="option in filters"
        :key="option.id"
        type="button"
        role="tab"
        :aria-selected="filterId === option.id"
        class="filter"
        :class="{ active: filterId === option.id }"
        @click="selectFilter(option)"
      >
        {{ option.label }}
        <span
          v-if="option.id === 'processing' && inboxStore.badge.processing"
          class="filter-count"
        >{{ inboxStore.badge.processing }}</span>
      </button>
    </div>

    <div v-if="inboxStore.loading" class="loading-indicator" />

    <div v-else-if="inboxStore.error" class="state state--error">
      <i class="bi bi-exclamation-triangle" />
      <p>{{ inboxStore.error }}</p>
      <button type="button" class="header-button" @click="reload">
        Retry
      </button>
    </div>

    <div v-else-if="displayItems.length === 0" class="state">
      <i class="bi bi-inbox" />
      <p>{{ emptyLabel }}</p>
      <p v-if="filterId === 'all'" class="state-hint">
        Use capture for a quick thought, dictate from the microphone, or
        import a meeting recording. Everything lands here for review.
      </p>
    </div>

    <template v-else>
      <div class="entry-list">
        <InboxEntry
          v-for="item in displayItems"
          :key="item.id"
          :item="item"
          @convert="openConvert"
        />
      </div>
      <div v-if="inboxStore.hasMore" class="load-more">
        <button
          type="button"
          class="header-button"
          :disabled="inboxStore.loadingMore"
          @click="inboxStore.loadMore()"
        >
          {{ inboxStore.loadingMore ? "Loading…" : "Load more" }}
        </button>
      </div>
      <p class="list-meta">
        {{ listMeta }}
      </p>
    </template>

    <InboxConvertDialog
      v-if="convertItem"
      :item="convertItem"
      @close="convertItem = null"
      @converted="onConverted"
    />
  </div>
</template>

<script setup>
const inboxStore = useInboxStore();
const dictationStore = useDictationStore();
const recommendationStore = useRecommendationStore();
const offlineQueue = useOfflineDictationQueue();
const { pushToast } = useToasts();
const { openQuickCapture } = useQuickCapture();
const { openMeetingImport } = useMeetingImport();
const route = useRoute();
const router = useRouter();

const FILTERS = [
  { id: "all", label: "All", status: null, includeArchived: false },
  {
    id: "processing",
    label: "Processing",
    status: "processing",
    includeArchived: false,
  },
  { id: "done", label: "Ready", status: "done", includeArchived: false },
  { id: "error", label: "Failed", status: "error", includeArchived: false },
  {
    id: "archived",
    label: "Archived",
    status: null,
    includeArchived: true,
    archivedOnly: true,
  },
];

const filters = FILTERS;
const filterId = ref("all");
const convertItem = ref(null);
let timer = null;
let polling = false;

const importEnabled = computed(
  () => recommendationStore.isDictationEnabled && recommendationStore.dictationImportEnabled,
);
const captureEnabled = computed(
  () => recommendationStore.isDictationEnabled && recommendationStore.isDictationSttConfigured,
);

const activeFilter = computed(
  () => FILTERS.find((option) => option.id === filterId.value) || FILTERS[0],
);

const displayItems = computed(() =>
  activeFilter.value.archivedOnly
    ? inboxStore.items.filter((item) => !!item.archivedAt)
    : inboxStore.items,
);

const emptyLabel = computed(() => {
  switch (filterId.value) {
    case "processing":
      return "Nothing is being transcribed right now.";
    case "done":
      return "No ready recordings. New transcriptions appear here.";
    case "error":
      return "No failed recordings.";
    case "archived":
      return "Nothing archived yet.";
    default:
      return "Your inbox is empty.";
  }
});

const listMeta = computed(() => {
  if (activeFilter.value.archivedOnly) {
    return `${displayItems.value.length} archived`;
  }
  return `${inboxStore.items.length} of ${inboxStore.total}`;
});

async function reload() {
  await inboxStore.fetchPage(true);
}

async function selectFilter(option) {
  if (filterId.value === option.id) {
    return;
  }
  filterId.value = option.id;
  await inboxStore.setFilter({
    status: option.status,
    source: null,
    includeArchived: option.includeArchived,
  });
}

function openConvert(item) {
  convertItem.value = item;
}

async function onConverted(outcome) {
  inboxStore.markSeen();
  await inboxStore.fetchBadge();
  if (outcome?.target === "task" && outcome.targetId) {
    await navigateTo(`/tasks?taskId=${encodeURIComponent(outcome.targetId)}`);
  } else if (outcome?.target === "note" && outcome.targetId) {
    await navigateTo(`/notes?noteId=${encodeURIComponent(outcome.targetId)}`);
  } else if (outcome?.target === "comment" && outcome.targetId) {
    await navigateTo(`/tasks?taskId=${encodeURIComponent(outcome.targetId)}`);
  } else if (outcome?.target === "checklist" && outcome.targetId) {
    await navigateTo(`/tasks?taskId=${encodeURIComponent(outcome.targetId)}`);
  }
}

async function pollProcessing() {
  if (polling || document.hidden) {
    return;
  }
  if (!inboxStore.items.some((item) => item.status === "processing")) {
    return;
  }
  polling = true;
  try {
    await inboxStore.fetchPage(true);
    await inboxStore.fetchBadge();
  } finally {
    polling = false;
  }
}

/**
 * A shared audio file lands here from the service worker (already queued in
 * IndexedDB) or from the server fallback (no share support in this browser).
 */
async function handleShareEntry() {
  const shared = route.query.shared;
  if (!shared) {
    return;
  }
  if (shared === "1") {
    pushToast({
      kind: "success",
      title: "Shared audio queued",
      message: "It will appear here as soon as it is uploaded.",
    });
    await offlineQueue.flush();
    await inboxStore.fetchPage(true);
  } else if (shared === "unsupported") {
    pushToast({
      kind: "info",
      title: "Sharing audio to Planner is not supported here",
      message: "Use “Import meeting” to upload a recording instead.",
    });
  }
  const query = { ...route.query };
  delete query.shared;
  await router.replace({ path: "/inbox", query });
}

onMounted(async () => {
  await inboxStore.fetchPage(true);
  // Opening the inbox clears the unread badge; the processing count remains
  inboxStore.markSeen();
  await inboxStore.fetchBadge();
  // Push notifications deep-link to the finished job
  const jobId =
    typeof route.query.jobId === "string" ? route.query.jobId : "";
  if (jobId) {
    dictationStore.openDialog();
    await dictationStore.openJob(jobId);
  }
  await handleShareEntry();
  timer = setInterval(pollProcessing, 5000);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  convertItem.value = null;
});
</script>

<style scoped>
.inbox-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  max-width: 900px;
  margin: 0 auto;
}

.header-controls {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
}

.header-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-strong);
  background: none;
  color: var(--color-text);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.header-button.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary, #fff);
}

.header-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-strong);
  background: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
}

.filter.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: var(--weight-bold);
}

.filter-count {
  font-size: var(--text-xs);
  background: var(--color-primary);
  color: var(--color-on-primary, #fff);
  border-radius: var(--radius-full);
  padding: 0 0.4em;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xl) var(--space-sm);
  text-align: center;
  color: var(--color-text-muted);
}

.state i {
  font-size: 2rem;
  opacity: 0.6;
}

.state p {
  margin: 0;
}

.state-hint {
  font-size: var(--text-sm);
  max-width: 45ch;
}

.state--error {
  color: var(--color-danger, #d64545);
}

.load-more {
  display: flex;
  justify-content: center;
}

.list-meta {
  margin: 0;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

@media (max-width: 600px) {
  .button-label {
    display: none;
  }
}
</style>