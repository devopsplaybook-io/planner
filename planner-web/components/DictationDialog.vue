<template>
  <dialog ref="dialogEl" @close="onDialogClosed">
    <article>
      <header>
        <h3><i class="bi bi-mic" /> Dictation</h3>
        <button class="close-btn" aria-label="Close" @click="requestClose" />
      </header>

      <!-- RECORD -->
      <section v-if="mode === 'record'" class="dictation-record">
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
        <footer class="dialog-footer">
          <button
            type="button"
            :disabled="isRecording"
            @click="finishRecording"
          >
            <i class="bi bi-check2" /> Use recording
          </button>
          <button type="button" class="secondary" @click="requestClose">
            Cancel
          </button>
        </footer>
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
          <div class="loading-indicator" aria-hidden="true" />
          <p class="dictation-status" aria-live="polite">
            {{ processingStatus }}
          </p>
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

      <!-- REVIEW -->
      <section v-else class="dictation-review">
        <form @submit.prevent="commitSelected">
          <label>
            Dictated text
            <textarea
              v-model="polishedText"
              rows="6"
              placeholder="Dictated text"
            />
          </label>
          <p v-if="!dictationStore.result?.polished" class="review-note">
            <i class="bi bi-info-circle" />
            The text could not be improved automatically; the raw transcript is
            used as is.
          </p>

          <details class="raw-transcript">
            <summary>Raw transcript</summary>
            <p class="raw-transcript-text">
              {{ dictationStore.result?.rawTranscript }}
            </p>
          </details>

          <template v-if="includedActions.length > 0">
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

          <footer class="dialog-footer">
            <button
              type="submit"
              :disabled="selectedCount === 0 || committing"
              :aria-busy="committing"
            >
              {{ createButtonLabel }}
            </button>
            <button
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
              Discard
            </button>
          </footer>
        </form>
      </section>
    </article>
  </dialog>
</template>

<script setup>
import { useDictation } from "../composables/useDictation";

const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "committed"]);

const dictationStore = useDictationStore();
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const notesStore = useNotesStore();

const DICTATION_MAX_DURATION_SECONDS = 120;
const POLL_INTERVAL_MS = 1500;

const mode = ref("record"); // record | processing | review
const committing = ref(false);

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
  maxDurationSeconds: DICTATION_MAX_DURATION_SECONDS,
  onAutoStop: () => finishRecording(),
});

let pollingTimer = null;

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

const processingStatus = computed(() => {
  if (dictationStore.stage === "polishing") return "Improving text…";
  if (dictationStore.stage === "actions") return "Finding actions…";
  return "Transcribing…";
});

// ── Review state ──────────────────────────────────────────────────────────────

const polishedText = ref("");
const includedActions = ref([]);

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
  if (selectedTasks.value.length > 0 && selectedNotes.value.length > 0) {
    return `Create ${selectedCount.value} items`;
  }
  if (selectedNotes.value.length > 0) {
    return "Create notes";
  }
  return "Create tasks";
});

function enterReview() {
  const result = dictationStore.result;
  polishedText.value = result?.polishedText || "";
  includedActions.value = (result?.actions || []).map((action) => ({
    ...action,
    included: true,
  }));
  mode.value = "review";
}

// ── Flow ──────────────────────────────────────────────────────────────────────

async function startRecording() {
  await startRecordingInternal();
}

async function stopRecording() {
  await finishRecording();
}

async function finishRecording() {
  if (!isRecording.value) {
    return;
  }
  const recording = await stopRecordingInternal();
  if (!recording) {
    return;
  }
  mode.value = "processing";
  await dictationStore.submitAudio(recording.blob, recording.mimeType);
  if (dictationStore.status === "processing") {
    startPolling();
  }
}

function startPolling() {
  stopPolling();
  pollingTimer = setInterval(async () => {
    await dictationStore.poll();
    if (dictationStore.status === "done") {
      stopPolling();
      enterReview();
    } else if (dictationStore.status === "error") {
      stopPolling();
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function retry() {
  dictationStore.reset();
  mode.value = "record";
}

function discard() {
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
    cancelRecording();
  }
  emit("close");
}

function noteTitleFromText(text) {
  const firstLine = (text || "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/[*_`>-]/g, "").trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return `Dictation ${new Date().toISOString().slice(0, 10)}`;
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

async function commitSelected() {
  committing.value = true;
  try {
    const projectId = defaultProjectId();
    for (const action of selectedActions.value) {
      if (action.type === "create_task") {
        await tasksStore.create({
          projectId,
          title: action.title,
          description: action.description,
          priority: action.priority,
          dueDate: action.dueDate,
        });
      } else {
        await notesStore.create({
          projectId,
          title: action.title,
          description: action.description,
        });
      }
    }
    dictationStore.reset();
    mode.value = "record";
    emit("committed");
    emit("close");
  } catch (err) {
    alert(err?.response?.data?.error || "Failed to create the selected items.");
  } finally {
    committing.value = false;
  }
}

async function saveAsNote() {
  committing.value = true;
  try {
    await notesStore.create({
      projectId: defaultProjectId(),
      title: noteTitleFromText(polishedText.value),
      description: polishedText.value,
    });
    dictationStore.reset();
    mode.value = "record";
    emit("committed");
    emit("close");
  } catch (err) {
    alert(err?.response?.data?.error || "Failed to save the note.");
  } finally {
    committing.value = false;
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await ensureProjectsLoaded();
      if (dictationStore.isProcessing) {
        mode.value = "processing";
        startPolling();
      } else if (dictationStore.status === "done" && dictationStore.result) {
        enterReview();
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

.dictation-review h4 {
  margin-top: var(--space-md);
}

.review-note {
  font-size: var(--text-sm);
  opacity: 0.8;
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
