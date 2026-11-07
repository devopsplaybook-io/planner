<template>
  <div class="quick-capture-panel">
    <p class="hint">
      Record a short thought now; it is transcribed in the background and
      lands in your inbox, without interrupting what you are doing.
    </p>

    <div class="recording-row">
      <button
        v-if="!isRecording"
        type="button"
        class="record-button"
        :disabled="!supported"
        @click="start"
      >
        <i class="bi bi-mic-fill" /> Record
      </button>
      <button
        v-else
        type="button"
        class="record-button stop"
        @click="stopAndSave"
      >
        <i class="bi bi-stop-fill" /> Save
      </button>
      <span v-if="isRecording" class="timer">
        {{ formattedElapsed }}
        <span class="pulse" />
      </span>
    </div>

    <p v-if="recorder.error" class="error" role="alert">
      {{ recorder.error }}
    </p>
    <p v-if="!supported" class="hint">
      Voice recording is not supported by this browser.
    </p>

    <label class="field">
      Language
      <select v-model="language">
        <option v-for="code in languages" :key="code" :value="code">
          {{ languageLabel(code) }}
        </option>
      </select>
    </label>

    <label class="field">
      Project (optional)
      <ProjectSelect v-model="projectId" all-label="No project" />
    </label>

    <p class="hint offline-hint">
      <i class="bi bi-wifi-off" />
      Offline? The recording is queued locally (up to
      {{ QUEUE_MAX_ITEMS }} recordings) and uploaded automatically when the
      connection returns.
    </p>
  </div>
</template>

<script setup>
import { onUnmounted } from "vue";
import { QUEUE_MAX_ITEMS } from "../utils/dictationQueue";

const emit = defineEmits(["close"]);

const recommendationStore = useRecommendationStore();
const dictationStore = useDictationStore();
const { pushToast } = useToasts();
const offlineQueue = useOfflineDictationQueue();

const supported = isVoiceRecordingSupported();
const language = ref(dictationStore.language || "auto");
const projectId = ref("");
const languages = computed(() => recommendationStore.dictationLanguages);

const recorder = useDictation({
  maxDurationSeconds: 120,
  onAutoStop: (recording) => {
    if (recording) {
      saveInBackground(recording);
    }
  },
});

const { isRecording, elapsedSeconds } = recorder;

const formattedElapsed = computed(() => {
  const seconds = elapsedSeconds.value || 0;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
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

async function start() {
  await recorder.start();
}

function stopAndSave() {
  void (async () => {
    const recording = await recorder.stop();
    if (recording) {
      saveInBackground(recording);
    }
  })();
}

/**
 * Uploads without blocking the UI: the panel closes immediately and the
 * outcome is reported with a toast. Offline (or an unreachable server) falls
 * back to the durable queue.
 */
function saveInBackground(recording) {
  const payload = {
    blob: recording.blob,
    mimeType: recording.mimeType,
    language: language.value,
    projectId: projectId.value || null,
  };
  emit("close");
  void (async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        const result = await dictationStore.uploadJob(
          payload.blob,
          payload.mimeType,
          payload.language,
          "quick_capture",
          payload.projectId,
        );
        if (result.jobId || result.conflictJobId) {
          pushToast({
            kind: "success",
            title: "Saved to your inbox",
            url: "/inbox",
          });
          return;
        }
        if (!result.offline) {
          pushToast({
            kind: "error",
            title: "Capture failed",
            message: result.error || "The recording could not be uploaded.",
          });
          return;
        }
      }
      const queued = await offlineQueue.enqueue(payload);
      if (queued.queued) {
        pushToast({
          kind: "info",
          title: "Queued offline",
          message: "The recording will be uploaded when you are back online.",
        });
      } else {
        pushToast({
          kind: "error",
          title: "Capture not saved",
          message: queued.error || "The offline queue is unavailable.",
        });
      }
    } catch (err) {
      pushToast({
        kind: "error",
        title: "Capture failed",
        message: (err && err.message) || "The recording could not be saved.",
      });
    }
  })();
}

// Leaving the capture tab while recording discards the capture, like
// closing the former standalone dialog did.
onUnmounted(() => {
  if (isRecording.value) {
    void recorder.cancel();
  }
});
</script>

<style scoped>
.quick-capture-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.recording-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.record-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary, #fff);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.record-button.stop {
  background: var(--color-danger, #d64545);
  border-color: var(--color-danger, #d64545);
}

.record-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.timer {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-danger, #d64545);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.error {
  margin: 0;
  color: var(--color-danger, #d64545);
  font-size: var(--text-sm);
}

.offline-hint {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}
</style>
