<template>
  <div class="meeting-import-panel">
    <template v-if="!job">
      <p class="hint">
        Upload a recording (up to {{ maxMinutes }} minutes, {{ maxMb }} MB).
        It is transcribed in the background with timestamped segments, a
        summary and the agreed action items. Interactive dictation keeps
        working while it runs.
      </p>

      <label class="field">
        Audio file
        <input
          type="file"
          accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg"
          :disabled="submitting"
          @change="onFileSelected"
        >
      </label>
      <p v-if="fileLabel" class="file-label">
        <i class="bi bi-file-earmark" /> {{ fileLabel }}
      </p>

      <div class="field-row">
        <label class="field">
          Language
          <select v-model="language" :disabled="submitting">
            <option v-for="code in languages" :key="code" :value="code">
              {{ languageLabel(code) }}
            </option>
          </select>
        </label>
        <label class="field">
          Default project (optional)
          <ProjectSelect v-model="projectId" all-label="No project" />
        </label>
      </div>

      <label class="checkbox">
        <input v-model="keepAudio" type="checkbox" :disabled="submitting">
        Keep the audio for {{ retentionDays }} days (max
        {{ keepMaxMb }} MB per user)
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button type="button" class="btn-secondary" @click="close">
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!file || submitting"
          @click="submit"
        >
          <i class="bi bi-cloud-upload" />
          {{ submitting ? `Uploading ${uploadPercent}%` : "Import" }}
        </button>
      </div>
      <div v-if="submitting" class="progress">
        <div class="progress-bar" :style="{ width: `${uploadPercent}%` }" />
      </div>
    </template>

    <template v-else>
      <p class="stage">
        <i class="bi bi-hourglass-split" />
        {{ stageLabel }}
      </p>
      <div class="progress" :class="{ indeterminate: !percent }">
        <div
          class="progress-bar"
          :style="percent ? { width: `${percent}%` } : undefined"
        />
      </div>
      <p class="hint">
        <template v-if="percent">{{ percent }}%</template>
        <template v-if="etaLabel"> · {{ etaLabel }}</template>
        <span v-if="job.error" class="error">{{ job.error }}</span>
      </p>
      <p class="hint">
        You can close this dialog: the import keeps running and the inbox
        badge updates when it is ready.
      </p>
      <div class="actions">
        <button type="button" class="btn-secondary" @click="close">
          Close
        </button>
        <button type="button" class="btn-primary" @click="openInbox">
          Open inbox
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onUnmounted } from "vue";
import api from "../utils/api";

const emit = defineEmits(["close", "open-inbox"]);

const recommendationStore = useRecommendationStore();
const dictationStore = useDictationStore();
const inboxStore = useInboxStore();
const { pushToast } = useToasts();

const file = ref(null);
const fileLabel = ref("");
const language = ref(dictationStore.language || "auto");
const projectId = ref("");
const keepAudio = ref(dictationStore.keepAudio);
const submitting = ref(false);
const uploadPercent = ref(0);
const error = ref("");
const job = ref(null);
const pollingStartedAt = ref(0);

let stopped = false;
let pollToken = 0;

const languages = computed(() => recommendationStore.dictationLanguages);
const maxMb = computed(() => recommendationStore.dictationImportMaxMb);
const maxMinutes = computed(() =>
  Math.round(recommendationStore.dictationImportMaxDurationSeconds / 60),
);
const retentionDays = computed(
  () => recommendationStore.dictationAudioRetentionDays,
);
const keepMaxMb = computed(
  () => recommendationStore.dictationAudioKeepMaxMb,
);

const percent = computed(() => {
  const total = job.value?.segmentsTotal || 0;
  const done = job.value?.segmentsDone || 0;
  if (!total) {
    return 0;
  }
  return Math.min(100, Math.round((done / total) * 100));
});

const stageLabel = computed(() => {
  if (!job.value) return "";
  if (job.value.error) return "Import failed";
  if (job.value.status === "done") return "Import complete";
  switch (job.value.stage) {
    case "queued":
      return "Waiting for the transcription worker…";
    case "chunking":
      return "Preparing the recording…";
    case "transcribing":
      return job.value.segmentsTotal
        ? `Transcribing segment ${Math.min(
            job.value.segmentsDone + 1,
            job.value.segmentsTotal,
          )} of ${job.value.segmentsTotal}…`
        : "Transcribing…";
    case "summarizing":
      return "Summarizing the meeting…";
    case "polishing":
      return "Polishing the transcript…";
    default:
      return "Processing…";
  }
});

const etaLabel = computed(() => {
  const total = job.value?.segmentsTotal || 0;
  const done = job.value?.segmentsDone || 0;
  if (!total || !done || done >= total || !pollingStartedAt.value) {
    return "";
  }
  const elapsed = Date.now() - pollingStartedAt.value;
  const remaining = Math.round((elapsed / done) * (total - done));
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.round((remaining % 60000) / 1000);
  return `about ${minutes ? `${minutes} min ` : ""}${seconds}s left`;
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
  return LANGUAGE_LABELS[code] || String(code).toUpperCase();
}

function onFileSelected(event) {
  error.value = "";
  const selected = event.target.files?.[0] || null;
  if (selected && selected.size > maxMb.value * 1024 * 1024) {
    error.value = `The file is larger than ${maxMb.value} MB.`;
    file.value = null;
    fileLabel.value = "";
    return;
  }
  file.value = selected;
  fileLabel.value = selected
    ? `${selected.name} (${Math.round(selected.size / 1024 / 1024)} MB)`
    : "";
}

async function submit() {
  if (!file.value || submitting.value) {
    return;
  }
  error.value = "";
  submitting.value = true;
  uploadPercent.value = 0;
  const form = new FormData();
  form.append("file", file.value);
  form.append("language", language.value);
  if (projectId.value) {
    form.append("projectId", projectId.value);
  }
  form.append("keepAudio", keepAudio.value ? "true" : "false");
  const result = await inboxStore.importMeeting(form, (value) => {
    uploadPercent.value = value;
  });
  submitting.value = false;
  if (result.error) {
    error.value = result.error;
    return;
  }
  const jobId = result.jobId || result.conflictJobId;
  if (!jobId) {
    error.value = "The import could not be started.";
    return;
  }
  if (result.conflictJobId) {
    pushToast({
      kind: "info",
      title: "An import is already running",
      message: "Showing its progress instead.",
    });
  }
  job.value = { status: "processing", stage: "queued" };
  pollingStartedAt.value = Date.now();
  void pollJob(jobId);
}

async function pollJob(jobId) {
  const token = ++pollToken;
  while (!stopped && token === pollToken) {
    try {
      const res = await api.get(`/dictation/${jobId}`);
      job.value = res.data;
      if (job.value?.status !== "processing") {
        break;
      }
    } catch {
      // Transient network failure: keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (stopped || token !== pollToken) {
    return;
  }
  if (job.value?.status === "done") {
    pushToast({
      kind: "success",
      title: "Meeting ready",
      message: "The transcript, summary and action items are in your inbox.",
      url: "/inbox",
    });
    await inboxStore.fetchBadge();
    emit("open-inbox");
  } else if (job.value?.status === "error") {
    error.value = job.value.error || "The meeting import failed.";
    pushToast({
      kind: "error",
      title: "Meeting import failed",
      message: error.value,
    });
  }
}

function openInbox() {
  pollToken += 1;
  emit("open-inbox");
}

function close() {
  pollToken += 1;
  job.value = null;
  submitting.value = false;
  file.value = null;
  fileLabel.value = "";
  error.value = "";
  uploadPercent.value = 0;
  emit("close");
}

onUnmounted(() => {
  stopped = true;
  pollToken += 1;
});
</script>

<style scoped>
.meeting-import-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-sm);
}

.checkbox {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.file-label {
  margin: 0;
  font-size: var(--text-sm);
}

.error {
  margin: 0;
  color: var(--color-danger, #d64545);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  font-weight: var(--weight-bold);
  cursor: pointer;
  text-decoration: none;
}

.btn-primary {
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  color: var(--color-on-primary, #fff);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text);
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

.progress.indeterminate .progress-bar {
  width: 35%;
  animation: slide 1.2s infinite ease-in-out;
}

@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(300%);
  }
}

.stage {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: 0;
  font-weight: var(--weight-bold);
}
</style>
