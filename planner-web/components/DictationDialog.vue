<template>
  <dialog ref="dialogEl" @close="onDialogClosed">
    <article>
      <header>
        <h3><i class="bi bi-mic" /> Dictation</h3>
        <button class="close-btn" aria-label="Close" @click="requestClose" />
      </header>

      <div class="dictation-body">
        <div v-if="tabs.length > 1" class="dictation-tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            class="dictation-tab"
            :class="{ active: activeTab === tab.id }"
            :aria-selected="activeTab === tab.id"
            @click="activeTab = tab.id"
          >
            <i class="bi" :class="tab.icon" /> {{ tab.label }}
          </button>
        </div>

        <template v-if="activeTab === 'dictate'">
          <div v-if="dialogError" class="dialog-error" role="alert">
            <span>{{ dialogError }}</span>
            <button
              class="dialog-error-dismiss"
              aria-label="Dismiss error"
              @click="dialogError = ''"
            >
              ×
            </button>
          </div>

          <!-- RECORD -->
          <section v-if="mode === 'record'" class="dictation-record">
        <p v-if="enginePreparing" class="engine-preparing" role="status">
          <i class="bi bi-hourglass-split" />
          Preparing speech engine (first run)…
        </p>
        <p class="dictation-status" aria-live="polite">
          {{ recordStatus }}
        </p>
        <div class="mic-area">
          <button
            class="mic-button"
            :class="{ recording: isRecording }"
            :aria-pressed="isRecording"
            :aria-label="isRecording ? 'Stop recording' : 'Start recording'"
            @click="isRecording ? stopRecording() : startRecording()"
          >
            <i class="bi" :class="isRecording ? 'bi-stop-circle' : 'bi-mic'" />
          </button>
          <span class="mic-timer">{{ formattedElapsed }}</span>
        </div>
        <div class="level-track" aria-hidden="true">
          <div class="level-bar" :style="{ width: levelPercent }" />
        </div>
        <label v-if="languages.length > 1" class="language-select">
          <i class="bi bi-translate" />
          Language
          <select v-model="language" :disabled="isRecording">
            <option v-for="lang in languages" :key="lang" :value="lang">
              {{ languageLabel(lang) }}
            </option>
          </select>
        </label>
        <p class="review-note retention-note">
          <i class="bi bi-shield-lock" /> Audio is deleted right after
          transcription.
        </p>
        <footer class="dialog-footer">
          <button
            type="button"
            :disabled="isRecording"
            @click="finishRecording()"
          >
            <i class="bi bi-check2" /> Use recording
          </button>
          <button type="button" class="secondary" @click="requestClose">
            Cancel
          </button>
        </footer>

        <details v-if="recentJobs.length > 0" class="recent-dictations">
          <summary>Recent dictations ({{ recentJobs.length }})</summary>
          <ul class="recent-list">
            <li v-for="job in recentJobs" :key="job.jobId" class="recent-item">
              <div class="recent-info">
                <span class="recent-status" :class="`is-${job.status}`">
                  {{ recentStatusLabel(job) }}
                </span>
                <span class="recent-when">{{ recentWhen(job) }}</span>
                <span class="recent-preview">{{ recentPreview(job) }}</span>
              </div>
              <button
                type="button"
                class="secondary small-btn"
                @click="openRecent(job)"
              >
                {{ job.status === "processing" ? "Resume" : "Open" }}
              </button>
            </li>
          </ul>
          <p class="review-note">
            Dictation audio is deleted right after transcription: once a
            dictation has been transcribed, retrying it requires recording
            again.
          </p>
        </details>
      </section>

      <!-- PROCESSING -->
      <section v-else-if="mode === 'processing'" class="dictation-processing">
        <template v-if="dictationStore.status === 'error'">
          <p class="dictation-status" aria-live="assertive">
            <i class="bi bi-exclamation-triangle" />
            {{ dictationStore.error || "The dictation failed." }}
          </p>
          <footer class="dialog-footer">
            <button type="button" @click="retry">Try again</button>
            <button type="button" class="secondary" @click="discard">
              Discard
            </button>
          </footer>
        </template>
        <template v-else>
          <p v-if="enginePreparing" class="engine-preparing" role="status">
            <i class="bi bi-hourglass-split" />
            Preparing speech engine (first run)…
          </p>
          <div class="loading-indicator" aria-hidden="true" />
          <p v-if="etaLabel" class="eta-label">{{ etaLabel }}</p>
          <ol class="stages">
            <li
              v-for="(stage, index) in processingStages"
              :key="stage.key"
              :class="stageClass(index)"
            >
              {{ stage.label }}
            </li>
          </ol>
        </template>
      </section>

      <!-- REVIEW: opens as soon as the raw transcript exists -->
      <section v-else class="dictation-review">
        <div v-if="showAskTab" class="review-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="reviewTab === 'actions'"
            :class="{ active: reviewTab === 'actions' }"
            @click="reviewTab = 'actions'"
          >
            <i class="bi bi-check2-square" /> Actions
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="reviewTab === 'ask'"
            :class="{ active: reviewTab === 'ask' }"
            @click="reviewTab = 'ask'"
          >
            <i class="bi bi-question-circle" /> Ask
          </button>
        </div>

        <DictationAskPanel
          v-if="showAskTab && reviewTab === 'ask'"
          :answer="dictationStore.askAnswer"
          :loading="dictationStore.askLoading"
          :error="dictationStore.askError"
          :projects="projectsStore.activeProjects || []"
          @ask="onAsk"
        />

        <form v-else @submit.prevent="onReviewSubmit">
          <label>
            Dictated text
            <textarea
              v-model="reviewText"
              rows="6"
              placeholder="Dictated text"
              @input="reviewDirty = true"
            />
          </label>
          <p v-if="textSourceLabel || translatedToLabel" class="text-badges">
            <span v-if="textSourceLabel" class="text-badge">
              {{ textSourceLabel }}
            </span>
            <span v-if="translatedToLabel" class="text-badge is-translation">
              <i class="bi bi-translate" /> {{ translatedToLabel }}
            </span>
          </p>
          <p v-if="reviewProgress" class="review-progress" role="status">
            <span class="inline-spinner" aria-hidden="true" />
            {{ reviewProgress }}
          </p>
          <p
            v-if="canUsePolishedText || canRevertToRaw"
            class="review-note review-actions"
          >
            <button
              v-if="canUsePolishedText"
              type="button"
              class="secondary small-btn"
              @click="usePolishedText"
            >
              <i class="bi bi-stars" /> Use polished text
            </button>
            <button
              v-if="canRevertToRaw"
              type="button"
              class="secondary small-btn"
              @click="revertToRaw"
            >
              <i class="bi bi-arrow-counterclockwise" /> Revert to raw
            </button>
          </p>
          <p class="stage-timings" v-if="stageSummary">
            <i class="bi bi-stopwatch" /> {{ stageSummary }}
          </p>
          <p v-if="showRawFallback" class="review-note">
            <i class="bi bi-info-circle" />
            The text could not be improved automatically; the raw transcript is
            used as is.
          </p>
          <p v-if="showActionsUnavailable" class="review-note">
            <i class="bi bi-info-circle" />
            Action proposals are not available for this dictation.
          </p>
          <p v-if="showConfidenceUnavailable" class="review-note">
            <i class="bi bi-info-circle" />
            Word confidence is not available with the external engine.
          </p>

          <DictationConfidenceReview
            v-if="hasSegments"
            :segments="segments"
            :threshold="confidenceThreshold"
            :notice="correctionNotice"
            @apply="applyCorrection"
            @add-vocabulary="addVocabulary"
          />

          <details v-if="rawTranscript" class="raw-transcript">
            <summary>Raw transcript</summary>
            <p class="raw-transcript-text">{{ rawTranscript }}</p>
          </details>

          <details v-if="rawTranscript" class="transcript-diff">
            <summary>Compare with raw transcript</summary>
            <DictationDiff :raw="rawTranscript" :polished="reviewText" />
          </details>

          <template v-if="structuredActions">
            <h4>Proposed actions</h4>
            <p class="review-note">
              Review each proposal: uncheck what you do not want, resolve
              ambiguous matches, then apply the selected actions.
            </p>
            <p
              v-if="dictationStore.previewLoading"
              class="review-progress"
              role="status"
            >
              <span class="inline-spinner" aria-hidden="true" />
              Checking what these actions will change…
            </p>
            <p
              v-if="dictationStore.previewError"
              class="review-note is-error"
              role="alert"
            >
              {{ dictationStore.previewError }}
            </p>
            <p v-if="applyMessage" class="review-note" role="status">
              {{ applyMessage }}
            </p>
            <ul
              v-if="dictationStore.previews.length > 0"
              class="action-cards"
            >
              <DictationActionCard
                v-for="preview in dictationStore.previews"
                :key="preview.index"
                :preview="preview"
                :selected="isSelected(preview.index)"
                :result="resultFor(preview.index)"
                :projects="projectsStore.activeProjects || []"
                :overrides="overridesFor(preview.index)"
                :busy="committing"
                @update:selected="togglePreview(preview.index, $event)"
                @override="onOverride"
              />
            </ul>
            <button
              v-if="undoableBatch"
              type="button"
              class="secondary small-btn"
              :disabled="committing"
              @click="undoApplied"
            >
              <i class="bi bi-arrow-counterclockwise" /> Undo applied actions
            </button>
          </template>

          <template v-else-if="includedActions.length > 0">
            <h4>Proposed actions</h4>
            <p class="review-note">
              Review each proposal: uncheck what you do not want, then create
              the selected items.
            </p>
            <ul class="action-cards">
              <li
                v-for="(action, index) in includedActions"
                :key="index"
                class="action-card"
              >
                <div class="action-card-header">
                  <label class="action-include">
                    <input v-model="action.included" type="checkbox">
                    <span
                      class="action-type"
                      :class="action.type === 'create_task' ? 'is-task' : 'is-note'"
                    >
                      <i
                        class="bi"
                        :class="
                          action.type === 'create_task'
                            ? 'bi-check2-square'
                            : 'bi-journal-text'
                        " />
                      {{ action.type === "create_task" ? "Task" : "Note" }}
                    </span>
                  </label>
                  <input
                    v-model="action.title"
                    type="text"
                    class="action-title"
                    :aria-label="
                      action.type === 'create_task'
                        ? 'Task title'
                        : 'Note title'
                    "
                  />
                </div>
                <textarea
                  v-model="action.description"
                  rows="2"
                  :aria-label="
                    action.type === 'create_task'
                      ? 'Task description'
                      : 'Note description'
                  "
                />
                <div
                  v-if="action.type === 'create_task'"
                  class="action-selects"
                >
                  <ProjectSelect
                    :model-value="action.projectId"
                    aria-label="Task project"
                    @update:model-value="onActionProjectChange(action, $event)"
                  />
                  <span class="action-status">
                    <span
                      class="status-dot"
                      :style="{
                        backgroundColor: statusesStore.colorFor(action.status),
                      }"
                      :title="action.status"
                    />
                    <select v-model="action.status" aria-label="Task status">
                      <option
                        v-for="s in statusesForProject(action.projectId)"
                        :key="s"
                        :value="s"
                      >
                        {{ s }}
                      </option>
                    </select>
                  </span>
                </div>
                <p v-if="action.dueDate || action.priority" class="action-meta">
                  <span v-if="action.priority" class="action-priority"
                    ><i class="bi bi-flag" /> {{ action.priority }}</span
                  >
                  <span v-if="action.dueDate"
                    ><i class="bi bi-calendar" /> {{ action.dueDate }}</span
                  >
                </p>
              </li>
            </ul>
          </template>

          <p class="review-note retention-note">
            <i class="bi bi-shield-lock" /> Audio is deleted right after
            transcription.
          </p>
          <footer class="dialog-footer">
            <button
              v-if="structuredApplied"
              type="button"
              @click="finishApplied"
            >
              <i class="bi bi-check2" /> Done
            </button>
            <button
              v-else
              type="submit"
              :disabled="reviewSelectedCount === 0 || committing"
              :aria-busy="committing"
            >
              {{ createButtonLabel }}
            </button>
            <button
              v-if="!structuredApplied"
              type="button"
              class="secondary"
              :disabled="committing"
              @click="saveAsNote"
            >
              <i class="bi bi-journal-plus" /> Save as note
            </button>
            <button
              type="button"
              class="contrast"
              :disabled="committing"
              @click="discard"
            >
              {{ structuredApplied ? "Close" : "Discard" }}
            </button>
          </footer>
        </form>
      </section>
        </template>

        <QuickCapturePanel
          v-else-if="activeTab === 'capture' && open"
          @close="requestClose"
        />
        <MeetingImportPanel
          v-else-if="activeTab === 'import' && open"
          @close="requestClose"
          @open-inbox="activeTab = 'inbox'"
        />
        <InboxPanel
          v-else-if="activeTab === 'inbox' && open"
          @close="requestClose"
        />
      </div>
    </article>
  </dialog>
</template>

<script setup>
import { useDictation } from "../composables/useDictation";
import { formatLocalDate } from "../utils/date";

const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "committed"]);

const dictationStore = useDictationStore();
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const notesStore = useNotesStore();
const statusesStore = useStatusesStore();
const recommendationStore = useRecommendationStore();
const vocabularyStore = useDictationVocabularyStore();

const POLL_FALLBACK_MS = 1500;

const mode = ref("record"); // record | processing | review
const committing = ref(false);
const dialogError = ref("");
const submittedDurationSeconds = ref(0);
const recentJobs = computed(() => dictationStore.recentJobs || []);

// Consolidated dictation menu: dictate, quick capture, meeting import and the
// voice inbox are presented as tabs (same tab pattern as the Settings page)
// instead of separate navigation entries.
const activeTab = ref("dictate");
const canDictate = computed(
  () => recommendationStore.isDictationSttConfigured,
);
const canImport = computed(
  () => recommendationStore.dictationImportEnabled,
);
const tabs = computed(() => {
  const list = [];
  if (canDictate.value) {
    list.push({ id: "dictate", label: "Dictate", icon: "bi-mic" });
    list.push({
      id: "capture",
      label: "Capture",
      icon: "bi-lightning-charge",
    });
  }
  if (canImport.value) {
    list.push({
      id: "import",
      label: "Import",
      icon: "bi-file-earmark-music",
    });
  }
  list.push({ id: "inbox", label: "Inbox", icon: "bi-inbox" });
  return list;
});

function ensureAvailableTab() {
  if (!tabs.value.some((tab) => tab.id === activeTab.value)) {
    activeTab.value = tabs.value[0]?.id || "dictate";
  }
}

watch(tabs, ensureAvailableTab);

// Deep links (push notification, share target) can request a tab while the
// menu is already open
watch(
  () => dictationStore.dialogTab,
  (tab) => {
    if (props.open && tab) {
      activeTab.value = tab;
      ensureAvailableTab();
    }
  },
);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => props.open);

const {
  isRecording,
  elapsedSeconds,
  level,
  error: recordError,
  start: startRecordingInternal,
  stop: stopRecordingInternal,
  cancel: cancelRecording,
} = useDictation({
  // Server-driven limit (no hardcoded 120 s); read on every timer tick
  maxDurationSeconds: computed(
    () => recommendationStore.dictationMaxDurationSeconds,
  ),
  onAutoStop: (recording) => finishRecording(recording),
});

const languages = computed(() => recommendationStore.dictationLanguages);
const language = computed({
  get: () => dictationStore.language,
  set: (value) => dictationStore.setLanguage(value),
});

const LANGUAGE_LABELS = {
  auto: "Automatic detection",
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
};

function languageLabel(code) {
  return LANGUAGE_LABELS[code] || code.toUpperCase();
}

const formattedElapsed = computed(() => {
  const minutes = String(Math.floor(elapsedSeconds.value / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds.value % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
});

const levelPercent = computed(() => `${Math.round(level.value * 100)}%`);

const recordStatus = computed(() => {
  if (recordError.value) {
    return recordError.value;
  }
  if (isRecording.value) {
    return "Recording… speak now, then press stop.";
  }
  return "Press the microphone and dictate your text.";
});

// The embedded model may still be downloading at startup: make that visible
// instead of letting the first dictation look stuck.
const enginePreparing = computed(() => {
  if (recommendationStore.dictationEngineState === "preparing") {
    return true;
  }
  const state = dictationStore.engineState;
  return (
    dictationStore.status === "processing" &&
    (state === "downloading" || state === "idle")
  );
});

const processingStages = [
  { key: "transcribing", label: "Transcribing…" },
  { key: "polishing", label: "Improving text…" },
  { key: "actions", label: "Finding actions…" },
];

const stageIndex = computed(() => {
  const index = processingStages.findIndex(
    (stage) => stage.key === dictationStore.stage,
  );
  return index === -1 ? 0 : index;
});

function stageClass(index) {
  return {
    done: index < stageIndex.value,
    active: index === stageIndex.value,
  };
}

// Rough ETA before STT: recorded duration × configured real-time factor
const etaLabel = computed(() => {
  if (dictationStore.hasRawTranscript) {
    return "";
  }
  const rtf = recommendationStore.dictationEstimatedRtf;
  if (!submittedDurationSeconds.value || !rtf) {
    return "";
  }
  const seconds = Math.max(1, Math.ceil(submittedDurationSeconds.value * rtf));
  return `Estimated transcription time: about ${seconds} s`;
});

// ── Review state ──────────────────────────────────────────────────────────────

const reviewText = ref("");
const reviewDirty = ref(false);
const includedActions = ref([]);
const correctionNotice = ref("");
let reviewInitialized = false;
let actionsPatched = false;

// ── Structured actions (schema v2 servers) ──────────────────────────────────
const reviewTab = ref("actions");
const showAskTab = computed(() => recommendationStore.dictationAskEnabled);
const structuredActions = computed(
  () =>
    recommendationStore.dictationApplyActions &&
    !!dictationStore.result?.actionsAvailable,
);
const actionOverrides = ref({});
const selectedIndexes = ref([]);
const applyMessage = ref("");
const requestId = ref("");
let previewsInitialized = false;
let previewsRequestedFor = "";

const structuredApplied = computed(
  () =>
    structuredActions.value &&
    dictationStore.applyResults.some((result) => result.status === "applied"),
);
const undoableBatch = computed(() => {
  const batch = dictationStore.latestBatch;
  if (!batch) {
    return null;
  }
  return batch.actions.some(
    (action) => action.status === "applied" && !action.undoneAt,
  )
    ? batch
    : null;
});
const reviewSelectedCount = computed(() =>
  structuredActions.value ? selectedIndexes.value.length : selectedCount.value,
);

function newRequestId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to the random fallback
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSelected(index) {
  return selectedIndexes.value.includes(index);
}

function overridesFor(index) {
  return actionOverrides.value[index] || {};
}

function resultFor(index) {
  return (
    dictationStore.applyResults.find((result) => result.index === index) ||
    null
  );
}

function togglePreview(index, checked) {
  if (checked) {
    if (!isSelected(index)) {
      selectedIndexes.value = [...selectedIndexes.value, index];
    }
    return;
  }
  selectedIndexes.value = selectedIndexes.value.filter(
    (value) => value !== index,
  );
}

function onOverride({ index, field, value }) {
  const next = { ...(actionOverrides.value[index] || {}), [field]: value };
  if (field === "projectId") {
    // A different project may not support the previous status
    delete next.status;
  }
  actionOverrides.value = { ...actionOverrides.value, [index]: next };
  if (
    (field === "targetId" || field === "projectId") &&
    value &&
    !isSelected(index)
  ) {
    selectedIndexes.value = [...selectedIndexes.value, index];
  }
}

function initializeSelections() {
  if (previewsInitialized) {
    return;
  }
  previewsInitialized = true;
  selectedIndexes.value = dictationStore.previews
    .filter((preview) => preview.status === "resolved")
    .map((preview) => preview.index);
}

async function loadPreviews() {
  const jobId = dictationStore.jobId;
  if (!jobId || !structuredActions.value) {
    return;
  }
  if (previewsInitialized && previewsRequestedFor === jobId) {
    return;
  }
  previewsRequestedFor = jobId;
  const res = await dictationStore.previewActions(jobId);
  if (res?.error) {
    previewsRequestedFor = "";
    return;
  }
  initializeSelections();
  dictationStore.fetchAppliedActions(jobId).catch(() => undefined);
}

const rawTranscript = computed(
  () => dictationStore.result?.rawTranscript || "",
);
const polishedText = computed(() => dictationStore.result?.polishedText || "");
const polishedAvailable = computed(
  () => !!dictationStore.availability?.polishedText && !!polishedText.value,
);
const canUsePolishedText = computed(
  () =>
    polishedAvailable.value &&
    reviewDirty.value &&
    reviewText.value !== polishedText.value,
);
const canRevertToRaw = computed(
  () => !!rawTranscript.value && reviewText.value !== rawTranscript.value,
);
const segments = computed(() => dictationStore.result?.segments || []);
const hasSegments = computed(() => segments.value.length > 0);
const confidenceThreshold = computed(
  () => recommendationStore.dictationConfidenceThreshold,
);
const showConfidenceUnavailable = computed(
  () =>
    dictationStore.status === "done" &&
    !!dictationStore.result &&
    !hasSegments.value &&
    dictationStore.engine === "external",
);
const textSourceLabel = computed(() => {
  if (reviewDirty.value) {
    return "Edited by you";
  }
  if (polishedAvailable.value && reviewText.value === polishedText.value) {
    return "Polished";
  }
  if (rawTranscript.value && reviewText.value === rawTranscript.value) {
    return "Raw transcript";
  }
  return "";
});
const translatedToLabel = computed(() => {
  const target = dictationStore.jobTargetLanguage;
  return target ? `Translated to ${languageLabel(target)}` : "";
});
const reviewProgress = computed(() => {
  if (dictationStore.status !== "processing") {
    return "";
  }
  if (dictationStore.stage === "actions") {
    return "Finding actions…";
  }
  if (dictationStore.stage === "polishing") {
    return "Improving text…";
  }
  return "Transcribing…";
});
const showRawFallback = computed(
  () =>
    dictationStore.status === "done" &&
    !!dictationStore.result &&
    !dictationStore.result.polished,
);
const showActionsUnavailable = computed(
  () =>
    dictationStore.status === "done" &&
    !!dictationStore.result &&
    !dictationStore.result.actionsAvailable,
);

function formatStageDuration(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

const stageSummary = computed(() => {
  const timings = dictationStore.timings;
  if (!timings) {
    return "";
  }
  const parts = [];
  if (timings.sttMs !== null && timings.sttMs !== undefined) {
    parts.push(`Transcribed in ${formatStageDuration(timings.sttMs)}`);
  }
  if (timings.polishMs !== null && timings.polishMs !== undefined) {
    parts.push(`Improved in ${formatStageDuration(timings.polishMs)}`);
  }
  if (timings.actionsMs !== null && timings.actionsMs !== undefined) {
    parts.push(`Actions in ${formatStageDuration(timings.actionsMs)}`);
  }
  return parts.join(" · ");
});

const selectedActions = computed(() =>
  includedActions.value.filter((action) => action.included),
);
const selectedCount = computed(() => selectedActions.value.length);
const selectedTasks = computed(() =>
  selectedActions.value.filter((action) => action.type === "create_task"),
);
const selectedNotes = computed(() =>
  selectedActions.value.filter((action) => action.type === "create_note"),
);

const createButtonLabel = computed(() => {
  if (structuredActions.value) {
    return selectedIndexes.value.length === 1
      ? "Apply action"
      : `Apply ${selectedIndexes.value.length} actions`;
  }
  if (selectedTasks.value.length > 0 && selectedNotes.value.length > 0) {
    return `Create ${selectedCount.value} items`;
  }
  if (selectedNotes.value.length > 0) {
    return "Create notes";
  }
  return "Create tasks";
});

function patchActions(actions) {
  if (actionsPatched) {
    return;
  }
  actionsPatched = true;
  const projectId = defaultProjectId();
  includedActions.value = (actions || []).map((action) =>
    action.type === "create_task"
      ? {
          ...action,
          included: true,
          projectId,
          status: firstStatusFor(projectId),
        }
      : { ...action, included: true },
  );
}

function resetReviewState() {
  reviewInitialized = false;
  actionsPatched = false;
  reviewText.value = "";
  reviewDirty.value = false;
  includedActions.value = [];
  correctionNotice.value = "";
  reviewTab.value = "actions";
  actionOverrides.value = {};
  selectedIndexes.value = [];
  applyMessage.value = "";
  requestId.value = "";
  previewsInitialized = false;
  previewsRequestedFor = "";
}

function enterReview() {
  dialogError.value = "";
  mode.value = "review";
  if (reviewInitialized) {
    return;
  }
  reviewInitialized = true;
  const result = dictationStore.result;
  // Prefer the polished text, but the raw transcript is already usable
  reviewText.value = result?.polishedText || result?.rawTranscript || "";
  reviewDirty.value = false;
  if (result?.actionsAvailable) {
    if (structuredActions.value) {
      void loadPreviews();
    } else {
      patchActions(result.actions || []);
    }
  }
  if (dictationStore.jobId && recommendationStore.dictationApplyActions) {
    dictationStore.fetchAppliedActions(dictationStore.jobId).catch(() => undefined);
  }
}

function usePolishedText() {
  if (polishedText.value) {
    reviewText.value = polishedText.value;
    reviewDirty.value = false;
  }
}

function revertToRaw() {
  reviewText.value = rawTranscript.value;
  reviewDirty.value = true;
  correctionNotice.value = "";
}

// Replaces only the first case-insensitive occurrence, so a correction never
// touches repeated words elsewhere in the text.
function applyCorrection({ original, replacement }) {
  correctionNotice.value = "";
  const needle = (original || "").toLowerCase();
  const index = needle
    ? reviewText.value.toLowerCase().indexOf(needle)
    : -1;
  if (index === -1) {
    correctionNotice.value = `Could not find “${original}” in the text. You can add it to your vocabulary instead.`;
    return;
  }
  reviewText.value =
    reviewText.value.slice(0, index) +
    replacement +
    reviewText.value.slice(index + original.length);
  reviewDirty.value = true;
}

async function addVocabulary(term) {
  correctionNotice.value = "";
  const res = await vocabularyStore.add(term, null);
  if (res?.error) {
    correctionNotice.value = res.error;
    return;
  }
  correctionNotice.value = `Added “${term}” to your personal vocabulary.`;
}

// Progressive delivery: patch the polished text and actions as they arrive,
// without clobbering what the user already typed.
watch(polishedText, (value) => {
  if (!value || mode.value !== "review") {
    return;
  }
  if (!reviewDirty.value) {
    reviewText.value = value;
  }
});

watch(
  () => dictationStore.availability?.actions,
  (available) => {
    if (!available || mode.value !== "review") {
      return;
    }
    if (structuredActions.value) {
      void loadPreviews();
    } else {
      patchActions(dictationStore.result?.actions || []);
    }
  },
);

// The server capabilities may arrive after the review opened: switch from the
// legacy cards to resolved previews at that point.
watch(structuredActions, (isStructured) => {
  if (isStructured && mode.value === "review") {
    void loadPreviews();
  }
});

// ── Flow ──────────────────────────────────────────────────────────────────────

// Token-based loop: closing the dialog or starting a new job cancels it; the
// job keeps running server-side.
let pollToken = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollLoop(token) {
  while (token === pollToken && dictationStore.isProcessing) {
    if (dictationStore.hasRawTranscript && mode.value === "processing") {
      enterReview();
    }
    const refreshed = await dictationStore.poll(true);
    if (token !== pollToken) {
      return;
    }
    if (dictationStore.hasRawTranscript && mode.value === "processing") {
      enterReview();
    }
    if (!dictationStore.isProcessing) {
      return;
    }
    if (!refreshed) {
      // Long-poll unavailable (proxy timeout, network hiccup): short-poll as
      // a fallback, then try the push channel again.
      await sleep(POLL_FALLBACK_MS);
      if (token !== pollToken) {
        return;
      }
      await dictationStore.poll(false);
      if (dictationStore.hasRawTranscript && mode.value === "processing") {
        enterReview();
      }
      if (!dictationStore.isProcessing) {
        return;
      }
      await sleep(POLL_FALLBACK_MS);
    }
  }
}

function startPolling() {
  stopPolling();
  const token = ++pollToken;
  void pollLoop(token);
}

function stopPolling() {
  pollToken += 1;
}

async function startRecording() {
  await startRecordingInternal();
}

async function stopRecording() {
  await finishRecording();
}

async function finishRecording(preStopped = null) {
  // The auto-stop path has already stopped the recorder and hands the audio
  // over; a manual stop still has to stop it here.
  const recording =
    preStopped ??
    (isRecording.value ? await stopRecordingInternal() : null);
  if (!recording) {
    return;
  }
  submittedDurationSeconds.value = elapsedSeconds.value;
  resetReviewState();
  mode.value = "processing";
  await dictationStore.submitAudio(
    recording.blob,
    recording.mimeType,
    language.value,
  );
  if (dictationStore.isProcessing) {
    startPolling();
  } else if (
    dictationStore.status === "done" &&
    dictationStore.hasRawTranscript
  ) {
    enterReview();
  }
}

async function openRecent(job) {
  dialogError.value = "";
  resetReviewState();
  submittedDurationSeconds.value = 0;
  await dictationStore.openJob(job.jobId);
  if (dictationStore.status === "error") {
    mode.value = "processing";
    return;
  }
  if (dictationStore.hasRawTranscript) {
    enterReview();
  } else {
    mode.value = "processing";
    startPolling();
  }
}

function recentStatusLabel(job) {
  if (job.status === "processing") {
    return "In progress";
  }
  if (job.status === "error") {
    return "Failed";
  }
  return "Done";
}

function recentWhen(job) {
  const date = new Date(job.dateCreated);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
  return `${formatLocalDate(date)} ${time}`;
}

function recentPreview(job) {
  const text = job.result?.rawTranscript || "";
  if (!text) {
    return "No transcript yet";
  }
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function retry() {
  dialogError.value = "";
  resetReviewState();
  dictationStore.reset();
  mode.value = "record";
}

function discard() {
  dialogError.value = "";
  resetReviewState();
  dictationStore.reset();
  mode.value = "record";
  emit("close");
}

function requestClose() {
  emit("close");
}

function onDialogClosed() {
  // Fires on Escape and backdrop click: keep a running job alive server-side,
  // the dialog resumes polling when reopened
  stopPolling();
  if (isRecording.value) {
    void cancelRecording();
  }
  emit("close");
}

function noteTitleFromText(text) {
  const firstLine = (text || "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/[*_`>-]/g, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return `Dictation ${formatLocalDate(new Date())}`;
  }
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
}

function defaultProjectId() {
  const def = projectsStore.defaultProject;
  if (def && !def.archived) {
    return def.id;
  }
  const active = projectsStore.activeProjects;
  return active.length > 0 ? active[0].id : "";
}

async function ensureProjectsLoaded() {
  if (projectsStore.projects.length === 0) {
    try {
      await projectsStore.fetchAll();
    } catch {
      // Committed items fall back to an empty project id rather than failing
    }
  }
}

function statusesForProject(projectId) {
  const statuses = projectsStore.projects.find(
    (p) => p.id === projectId,
  )?.statuses;
  return statuses?.length ? statuses : ["To Do", "In Progress", "Done"];
}

function firstStatusFor(projectId) {
  return statusesForProject(projectId)[0];
}

function onActionProjectChange(action, projectId) {
  action.projectId = projectId;
  if (!statusesForProject(projectId).includes(action.status)) {
    action.status = firstStatusFor(projectId);
  }
}

function ensureStatusesLoaded() {
  if (statusesStore.catalog.length === 0) {
    statusesStore.fetchAll().catch(() => {});
  }
}

function onReviewSubmit() {
  if (structuredActions.value) {
    return applyStructured();
  }
  return commitSelected();
}

async function applyStructured() {
  const jobId = dictationStore.jobId;
  if (!jobId || selectedIndexes.value.length === 0) {
    return;
  }
  committing.value = true;
  dialogError.value = "";
  applyMessage.value = "";
  try {
    if (!requestId.value) {
      requestId.value = newRequestId();
    }
    const rid = requestId.value;
    const selections = selectedIndexes.value.map((index) => ({
      index,
      ...overridesFor(index),
    }));
    const res = await dictationStore.applyActions(jobId, rid, selections);
    if (res?.error) {
      dialogError.value = res.error;
      return;
    }
    const results = res.outcome?.results || [];
    const applied = results.filter((item) => item.status === "applied").length;
    const failed = results.filter((item) => item.status === "failed").length;
    applyMessage.value =
      applied > 0
        ? `${applied} ${applied === 1 ? "action" : "actions"} applied${
            failed > 0 ? `, ${failed} failed` : ""
          }.`
        : "No action was applied.";
    if (applied > 0) {
      emit("committed");
    }
    // A retried confirm must use a new key: reusing this one would replay the
    // stored outcomes instead of retrying the failures.
    if (failed > 0 || applied === 0) {
      requestId.value = "";
    }
  } catch (err) {
    dialogError.value =
      err?.response?.data?.error || "The selected actions could not be applied.";
  } finally {
    committing.value = false;
  }
}

async function undoApplied() {
  const jobId = dictationStore.jobId;
  const batch = undoableBatch.value;
  if (!jobId || !batch) {
    return;
  }
  committing.value = true;
  dialogError.value = "";
  applyMessage.value = "";
  try {
    const res = await dictationStore.undoActions(jobId, batch.requestId);
    if (res?.error) {
      dialogError.value = res.error;
      return;
    }
    const undone =
      res.outcome?.results.filter((item) => item.status === "undone").length || 0;
    applyMessage.value =
      undone > 0
        ? `${undone} ${undone === 1 ? "action" : "actions"} undone.`
        : "Nothing could be undone.";
    emit("committed");
  } finally {
    committing.value = false;
  }
}

function finishApplied() {
  dictationStore.reset();
  resetReviewState();
  mode.value = "record";
  emit("committed");
  emit("close");
}

async function onAsk({ question, projectId }) {
  await dictationStore.ask(question, projectId);
}

async function commitSelected() {
  committing.value = true;
  dialogError.value = "";
  try {
    const fallbackProjectId = defaultProjectId();
    for (const action of selectedActions.value) {
      if (action.type === "create_task") {
        const projectId = action.projectId || fallbackProjectId;
        await tasksStore.create({
          projectId,
          title: action.title,
          description: action.description,
          status: action.status || firstStatusFor(projectId),
          priority: action.priority,
          dueDate: action.dueDate,
        });
      } else {
        await notesStore.create({
          projectId: fallbackProjectId,
          title: action.title,
          description: action.description,
        });
      }
    }
    dictationStore.reset();
    resetReviewState();
    mode.value = "record";
    emit("committed");
    emit("close");
  } catch (err) {
    dialogError.value =
      err?.response?.data?.error || "Failed to create the selected items.";
  } finally {
    committing.value = false;
  }
}

async function saveAsNote() {
  committing.value = true;
  dialogError.value = "";
  try {
    await notesStore.create({
      projectId: defaultProjectId(),
      title: noteTitleFromText(reviewText.value),
      description: reviewText.value,
    });
    dictationStore.reset();
    resetReviewState();
    mode.value = "record";
    emit("committed");
    emit("close");
  } catch (err) {
    dialogError.value = err?.response?.data?.error || "Failed to save the note.";
  } finally {
    committing.value = false;
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      activeTab.value = dictationStore.dialogTab || "dictate";
      ensureAvailableTab();
      dialogError.value = "";
      await ensureProjectsLoaded();
      ensureStatusesLoaded();
      if (!recommendationStore.config) {
        recommendationStore.fetchConfig().catch(() => undefined);
      }
      dictationStore.fetchRecentJobs().catch(() => undefined);
      dictationStore.fetchPreferences().catch(() => undefined);
      if (dictationStore.isProcessing) {
        if (dictationStore.hasRawTranscript) {
          enterReview();
        } else {
          mode.value = "processing";
          startPolling();
        }
      } else if (dictationStore.jobId && dictationStore.result) {
        enterReview();
      } else if (dictationStore.status === "error" && dictationStore.jobId) {
        mode.value = "processing";
      } else if (mode.value !== "record") {
        mode.value = "record";
      }
    } else {
      stopPolling();
    }
  },
);

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
.dictation-body {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

/* Same tab pattern as the Settings page */
.dictation-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: var(--space-2xs);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
}

.dictation-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: var(--space-xs) var(--space-md);
  color: var(--color-text-muted);
  font-weight: var(--weight-medium);
  margin-bottom: -1px;
  flex-shrink: 0;
  white-space: nowrap;
}

.dictation-tab:hover {
  color: var(--color-primary);
}

.dictation-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.dictation-record,
.dictation-processing {
  display: grid;
  gap: var(--space-sm);
  justify-items: center;
  padding: var(--space-sm) 0;
}

.dictation-status {
  text-align: center;
  margin: 0;
}

.engine-preparing {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.85;
}

.mic-area {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.mic-button {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-full);
  border: none;
  display: grid;
  place-items: center;
  font-size: 2rem;
  color: var(--color-on-primary);
  background: var(--color-primary);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    background 0.2s ease;
}

.mic-button.recording {
  background: #b02a37;
  animation: mic-pulse 1.5s infinite ease-in-out;
}

@keyframes mic-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(176, 42, 55, 0.5);
  }
  70% {
    box-shadow: 0 0 0 18px rgba(176, 42, 55, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(176, 42, 55, 0);
  }
}

.mic-timer {
  font-variant-numeric: tabular-nums;
  font-size: var(--text-lg);
}

.language-select {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.language-select select {
  margin: 0;
  width: auto;
}

.level-track {
  width: 100%;
  max-width: 320px;
  height: 6px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 15%, transparent);
  overflow: hidden;
}

.level-bar {
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  transition: width 0.15s ease;
}

.dictation-processing .loading-indicator {
  margin: var(--space-md) auto;
}

.eta-label {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.8;
}

.stages {
  display: grid;
  gap: var(--space-2xs);
  width: 100%;
  max-width: 320px;
  margin: 0;
  padding-left: var(--space-lg);
}

.stages li {
  opacity: 0.5;
}

.stages li.active {
  opacity: 1;
  font-weight: var(--weight-bold);
}

.stages li.done {
  opacity: 0.8;
}

.stages li.done::marker {
  content: "✓ ";
}

.recent-dictations {
  width: 100%;
  margin-top: var(--space-sm);
}

.recent-dictations summary {
  cursor: pointer;
  font-size: var(--text-sm);
}

.recent-list {
  list-style: none;
  padding: 0;
  margin: var(--space-xs) 0;
  display: grid;
  gap: var(--space-2xs);
}

.recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2xs) var(--space-xs);
}

.recent-info {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.recent-status {
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.recent-status.is-processing {
  color: var(--color-primary);
}

.recent-status.is-error {
  color: var(--color-danger);
}

.recent-when {
  font-size: var(--text-xs);
  opacity: 0.75;
}

.recent-preview {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dictation-review h4 {
  margin-top: var(--space-md);
}

.review-note {
  font-size: var(--text-sm);
  opacity: 0.8;
}

.review-note.is-error {
  color: #842029;
  opacity: 1;
}

.review-tabs {
  display: flex;
  gap: var(--space-2xs);
  margin-bottom: var(--space-sm);
  border-bottom: 1px solid var(--color-border);
}

.review-tabs button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: inherit;
  padding: var(--space-2xs) var(--space-sm);
  opacity: 0.75;
}

.review-tabs button.active {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
  opacity: 1;
}

.review-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.85;
}

.text-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin: var(--space-2xs) 0 0;
}

.text-badge {
  font-size: var(--text-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0 0.4em;
  opacity: 0.85;
}

.text-badge.is-translation {
  border-color: var(--color-primary);
  color: var(--color-primary);
  opacity: 1;
}

.review-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.retention-note {
  margin-top: var(--space-sm);
}

.inline-spinner {
  width: 0.9em;
  height: 0.9em;
  border: 2px solid color-mix(in srgb, var(--color-text) 25%, transparent);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: inline-spin 0.8s linear infinite;
}

@keyframes inline-spin {
  to {
    transform: rotate(360deg);
  }
}

.stage-timings {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.85;
}

.raw-transcript {
  margin: var(--space-xs) 0;
}

.raw-transcript summary {
  cursor: pointer;
  font-size: var(--text-sm);
}

.raw-transcript-text {
  font-size: var(--text-sm);
  opacity: 0.85;
  white-space: pre-wrap;
}

.transcript-diff {
  margin: var(--space-xs) 0;
}

.transcript-diff summary {
  cursor: pointer;
  font-size: var(--text-sm);
}

.action-cards {
  display: grid;
  gap: var(--space-sm);
  list-style: none;
  padding: 0;
  margin: 0;
}

.action-card {
  border: 1px solid color-mix(in srgb, var(--color-text) 20%, transparent);
  border-radius: var(--radius-sm);
  padding: var(--space-xs);
  display: grid;
  gap: var(--space-2xs);
}

.action-card-header {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: var(--space-xs);
}

.action-include {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: 0;
}

.action-type {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
  padding: 2px var(--space-2xs);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.action-type.is-task {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.action-type.is-note {
  background: color-mix(in srgb, var(--color-text) 12%, transparent);
}

.action-title {
  font-weight: var(--weight-bold);
}

.action-selects {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--space-2xs);
  align-items: center;
}

.action-status {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.action-status select {
  margin: 0;
  flex: 1;
  min-width: 0;
}

/* Color chip reflecting the selected status color */
.status-dot {
  width: 0.85em;
  height: 0.85em;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.action-meta {
  display: flex;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  margin: 0;
  opacity: 0.85;
}

.dialog-footer {
  display: flex;
  gap: var(--space-xs);
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
