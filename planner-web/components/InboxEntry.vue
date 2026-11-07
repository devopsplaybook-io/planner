<template>
  <article
    class="inbox-entry"
    :class="{ archived: !!item.archivedAt, expanded }"
  >
    <div class="entry-main">
      <span class="entry-icon" :title="sourceLabel">
        <i class="bi" :class="iconClass" />
      </span>

      <div class="entry-body">
        <div class="entry-head">
          <h3 class="entry-title" :title="item.preview">
            {{ item.preview || "Untitled recording" }}
          </h3>
          <span class="entry-time" :title="new Date(item.createdAt).toLocaleString()">
            {{ formatRelativeTime(item.createdAt) }}
          </span>
        </div>

        <p class="entry-meta">
          <span class="chip">{{ kindLabel }}</span>
          <span v-if="item.language" class="chip">{{
            item.language.toUpperCase()
          }}</span>
          <span v-if="item.archivedAt" class="chip chip--archived">Archived</span>
          <span v-if="item.convertedType" class="chip chip--converted">
            Converted to {{ item.convertedType }}
          </span>
        </p>

        <div v-if="item.status === 'processing'" class="entry-progress">
          <div class="progress">
            <div
              class="progress-bar"
              :style="{ width: `${item.progress.percent}%` }"
            />
          </div>
          <span class="progress-label">
            {{ stageLabel }}
            <template v-if="item.progress.segmentsTotal">
              · {{ item.progress.segmentsDone }}/{{
                item.progress.segmentsTotal
              }}
            </template>
          </span>
        </div>
        <p v-else-if="item.status === 'error'" class="entry-error">
          <i class="bi bi-exclamation-triangle" /> Transcription failed
        </p>

        <div class="entry-actions">
          <button
            v-if="canConvert"
            type="button"
            class="entry-action primary"
            @click="emit('convert', item)"
          >
            <i class="bi bi-arrow-right-circle" /> Convert
          </button>
          <button
            v-if="item.status !== 'processing'"
            type="button"
            class="entry-action"
            @click="toggleExpanded"
          >
            <i class="bi bi-eye" /> {{ expanded ? "Hide" : "Review" }}
          </button>
          <button
            type="button"
            class="entry-action"
            @click="toggleArchive"
          >
            <i class="bi" :class="item.archivedAt ? 'bi-archive' : 'bi-archive'" />
            {{ item.archivedAt ? "Unarchive" : "Archive" }}
          </button>
          <button
            type="button"
            class="entry-action danger"
            :disabled="item.status === 'processing'"
            :title="
              item.status === 'processing'
                ? 'A processing recording cannot be deleted'
                : 'Delete this recording'
            "
            @click="remove"
          >
            <i class="bi bi-trash" /> Delete
          </button>
        </div>
      </div>
    </div>

    <div v-if="expanded" class="entry-detail">
      <div v-if="detailLoading" class="detail-hint">
        <i class="bi bi-hourglass-split" /> Loading…
      </div>
      <div v-else-if="detailError" class="detail-hint detail-hint--error">
        {{ detailError }}
      </div>
      <template v-else-if="detail">
        <section v-if="detail.summary" class="detail-section">
          <h4>Summary</h4>
          <p class="detail-text">{{ detail.summary }}</p>
        </section>

        <section v-if="detail.decisions?.length" class="detail-section">
          <h4>Decisions</h4>
          <ul class="detail-list">
            <li v-for="(decision, index) in detail.decisions" :key="index">
              {{ decision }}
            </li>
          </ul>
        </section>

        <section v-if="actionItems.length" class="detail-section">
          <h4>Action items</h4>
          <ul class="detail-list">
            <li v-for="(action, index) in actionItems" :key="index">
              <strong>{{ action.title }}</strong>
              <span v-if="action.description" class="action-description">
                — {{ action.description }}</span>
            </li>
          </ul>
        </section>

        <section v-if="detail.transcriptSegments?.length" class="detail-section">
          <h4>Transcript</h4>
          <ol class="transcript">
            <li
              v-for="(segment, index) in detail.transcriptSegments"
              :key="index"
            >
              <span class="segment-time">{{ formatMs(segment.fromMs) }}</span>
              <span class="segment-text">{{ segment.text }}</span>
            </li>
          </ol>
        </section>
        <section v-else-if="plainText" class="detail-section">
          <h4>Transcript</h4>
          <p class="detail-text detail-text--transcript">{{ plainText }}</p>
        </section>
        <p v-else class="detail-hint">No transcript is available yet.</p>
      </template>
    </div>
  </article>
</template>

<script setup>
import { formatRelativeTime } from "../utils/relativeTime";

const props = defineProps({
  item: { type: Object, required: true },
});
const emit = defineEmits(["convert"]);

const inboxStore = useInboxStore();
const { pushToast } = useToasts();

const expanded = ref(false);
const detailLoading = ref(false);
const detailError = ref("");
const detail = ref(null);

const STAGE_LABELS = {
  queued: "Queued",
  chunking: "Preparing",
  transcribing: "Transcribing",
  polishing: "Polishing",
  actions: "Extracting actions",
  summarizing: "Summarizing",
  done: "Ready",
};

const kindLabel = computed(() =>
  props.item.jobKind === "meeting" ? "Meeting" : "Voice note",
);

const sourceLabel = computed(() => {
  switch (props.item.source) {
    case "import":
      return "Imported meeting";
    case "quick_capture":
      return "Quick capture";
    case "inline":
      return "Inline dictation";
    case "voice_comment":
      return "Voice comment";
    default:
      return "Dictation";
  }
});

const iconClass = computed(() => {
  switch (props.item.source) {
    case "import":
      return "bi-file-earmark-music";
    case "quick_capture":
      return "bi-lightning-charge";
    case "inline":
      return "bi-pencil-square";
    case "voice_comment":
      return "bi-chat-quote";
    default:
      return "bi-mic-fill";
  }
});

const stageLabel = computed(
  () => STAGE_LABELS[props.item.stage] || "Processing",
);

const canConvert = computed(
  () =>
    props.item.status === "done" &&
    !props.item.convertedType &&
    !props.item.archivedAt,
);

const plainText = computed(() => {
  const result = detail.value?.result;
  return result?.polishedText || result?.rawTranscript || "";
});

const actionItems = computed(() => {
  const actions = detail.value?.result?.actions || [];
  return actions
    .filter((action) => action.type === "create_task")
    .map((action) => ({
      title: action.title || "Action item",
      description: action.description || "",
    }));
});

function formatMs(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function toggleExpanded() {
  expanded.value = !expanded.value;
  if (!expanded.value || detail.value) {
    return;
  }
  detailError.value = "";
  detailLoading.value = true;
  const loaded = await inboxStore.fetchDetail(props.item.id);
  detail.value = loaded;
  if (!loaded) {
    detailError.value = "The transcript could not be loaded.";
  }
  detailLoading.value = false;
}

async function toggleArchive() {
  const archived = !props.item.archivedAt;
  const result = await inboxStore.archive(props.item.id, archived);
  if (result.error) {
    pushToast({ kind: "error", title: "Archive failed", message: result.error });
    return;
  }
  pushToast({
    kind: "success",
    title: archived ? "Archived" : "Restored to the inbox",
  });
}

async function remove() {
  if (props.item.status === "processing") {
    return;
  }
  if (
    !window.confirm(
      "Delete this recording and its transcript? This cannot be undone.",
    )
  ) {
    return;
  }
  const result = await inboxStore.remove(props.item.id);
  if (result.error) {
    pushToast({ kind: "error", title: "Delete failed", message: result.error });
    return;
  }
  pushToast({ kind: "success", title: "Recording deleted" });
}
</script>

<style scoped>
.inbox-entry {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
}

.inbox-entry.archived {
  opacity: 0.7;
}

.entry-main {
  display: flex;
  gap: var(--space-sm);
}

.entry-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.2rem;
  height: 2.2rem;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-size: var(--text-lg);
}

.entry-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.entry-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}

.entry-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}

.entry-time {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.entry-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin: 0;
}

.chip {
  font-size: var(--text-xs);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  padding: 0 0.5em;
  color: var(--color-text-muted);
}

.chip--archived {
  border-style: dashed;
}

.chip--converted {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.entry-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.progress {
  height: 6px;
  border-radius: 3px;
  background: var(--color-border);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.3s ease;
}

.progress-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.entry-error {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-danger, #d64545);
}

.entry-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.entry-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
  padding: var(--space-2xs) var(--space-xs);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  background: none;
  color: var(--color-text);
  cursor: pointer;
}

.entry-action.primary {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: var(--weight-bold);
}

.entry-action.danger {
  color: var(--color-danger, #d64545);
}

.entry-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.entry-detail {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.detail-section h4 {
  margin: 0 0 var(--space-2xs);
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: var(--tracking-widest);
  color: var(--color-text-muted);
}

.detail-text {
  margin: 0;
  font-size: var(--text-sm);
  white-space: pre-wrap;
}

.detail-text--transcript {
  max-height: 50vh;
  overflow: auto;
}

.detail-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: var(--text-sm);
}

.action-description {
  color: var(--color-text-muted);
}

.transcript {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.transcript li {
  display: flex;
  gap: var(--space-sm);
}

.segment-time {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
  min-width: 3.5em;
}

.detail-hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.detail-hint--error {
  color: var(--color-danger, #d64545);
}
</style>