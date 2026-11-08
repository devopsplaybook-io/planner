<template>
  <div class="inbox-panel">
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
        Record a thought, dictate from the microphone, or import a meeting
        recording. Everything lands here for review.
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
const emit = defineEmits(["close"]);

const inboxStore = useInboxStore();

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
  // The converted item now lives elsewhere: close the menu and follow it.
  emit("close");
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

onMounted(async () => {
  await inboxStore.fetchPage(true);
  // Opening the inbox clears the unread badge; the processing count remains
  inboxStore.markSeen();
  await inboxStore.fetchBadge();
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
.inbox-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
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
</style>
