<template>
  <div class="comment-composer">
    <div class="composer-tabs" role="tablist" aria-label="Comment editor mode">
      <button
        type="button"
        role="tab"
        class="composer-tab"
        :class="{ active: mode === 'write' }"
        :aria-selected="mode === 'write'"
        @click="mode = 'write'"
      >
        Write
      </button>
      <button
        type="button"
        role="tab"
        class="composer-tab"
        :class="{ active: mode === 'preview' }"
        :aria-selected="mode === 'preview'"
        @click="mode = 'preview'"
      >
        Preview
      </button>
      <button
        v-if="showVoiceButton"
        type="button"
        class="composer-tab composer-voice-btn"
        :class="{ recording: isRecording }"
        :aria-pressed="isRecording"
        :aria-label="
          isRecording ? 'Stop recording' : 'Record a voice comment'
        "
        @click="isRecording ? stopVoiceRecording() : startVoiceMessage()"
      >
        <i class="bi" :class="isRecording ? 'bi-stop-circle' : 'bi-mic'" />
      </button>
    </div>
    <p v-if="allowVoice" class="composer-retention">
      <i class="bi bi-shield-lock" /> Voice-comment audio is kept as a task
      attachment; delete the attachment to remove it.
    </p>
    <div
      v-if="isRecording"
      class="composer-voice-status"
      aria-live="polite"
    >
      <span class="composer-voice-timer">{{ formattedVoiceElapsed }}</span>
      <button
        type="button"
        class="composer-tab"
        aria-label="Stop recording"
        @click="stopVoiceRecording"
      >
        <i class="bi bi-stop-circle" /> Stop
      </button>
      <button
        type="button"
        class="composer-tab"
        aria-label="Cancel recording"
        @click="cancelVoiceRecording"
      >
        <i class="bi bi-x" /> Cancel
      </button>
    </div>
    <p v-if="voiceError && !isRecording" class="composer-voice-error" role="alert">
      {{ voiceError }}
    </p>
    <div v-show="mode === 'write'" class="composer-input-row">
      <textarea
        ref="textarea"
        v-model="input"
        rows="2"
        :placeholder="placeholder"
        @keydown="onKeydown"
      />
      <InlineDictationButton
        :controller="inline"
        :target="textarea"
        :disabled="busy"
        :show-button="!isVoiceMessageActive"
        aria-label="Dictate comment"
      />
    </div>
    <div
      v-if="mode === 'preview'"
      class="composer-preview markdown-body"
      v-html="previewHtml"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import { useTextareaAutosize } from "@vueuse/core";
import { renderMarkdown } from "../composables/useMarkdown";
import { saveCommentDraft } from "../composables/useCommentDraft";
import { useInlineDictation } from "../composables/useInlineDictation";
import { isVoiceRecordingSupported } from "../composables/useDictation";
import { voiceMessageFileName } from "../utils/dictationMime";

const props = defineProps({
  modelValue: { type: String, default: "" },
  // When set, every input is persisted to localStorage under this key
  // (immediate, non-debounced) and an empty value clears it
  draftKey: { type: String, default: null },
  placeholder: {
    type: String,
    default: "Add a comment... (Markdown supported)",
  },
  busy: { type: Boolean, default: false },
  // Voice messages: offer the record button when the comment belongs to a
  // task and the server supports the inline (no auto-comment) flow
  allowVoice: { type: Boolean, default: false },
  taskId: { type: String, default: null },
});
const emit = defineEmits(["update:modelValue", "submit", "voice-busy"]);

const recommendationStore = useRecommendationStore();
const tasksStore = useTasksStore();

const mode = ref("write");
const { textarea, input, triggerResize } = useTextareaAutosize();

// Dictation into the comment text and recorded voice messages share one
// controller so they can never run at the same time.
const inline = useInlineDictation({
  target: () => textarea.value,
  onKeepAudio: (recording) => uploadVoiceMessage(recording),
  onInserted: () => triggerResize(),
});

const {
  phase,
  recordingMode,
  isRecording,
  elapsedSeconds: voiceElapsedSeconds,
  error: inlineError,
  language: voiceLanguage,
} = inline;

const voiceUploadError = ref("");
const voiceError = computed(() => inlineError.value || voiceUploadError.value);

const isVoiceMessageActive = computed(
  () => recordingMode.value === "voice-message" && phase.value !== "idle",
);
const isInlineDictationActive = computed(
  () => recordingMode.value === "dictation" && phase.value !== "idle",
);

// MediaRecorder APIs are probed once; SSR is disabled in this app
const voiceSupported = isVoiceRecordingSupported();
const showVoiceButton = computed(
  () =>
    props.allowVoice &&
    !!props.taskId &&
    recommendationStore.dictationInlineJobs === true &&
    voiceSupported &&
    !props.busy &&
    !isInlineDictationActive.value,
);

const formattedVoiceElapsed = computed(() => {
  const minutes = String(Math.floor(voiceElapsedSeconds.value / 60)).padStart(2, "0");
  const seconds = String(voiceElapsedSeconds.value % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
});

/**
 * The audio is kept as a task attachment; the server skips its automatic
 * transcript comment so the composer posts the single, edited comment.
 */
async function uploadVoiceMessage(recording) {
  if (!props.taskId || !recording?.blob) {
    return;
  }
  voiceUploadError.value = "";
  emit("voice-busy", true);
  try {
    const file = new File(
      [recording.blob],
      voiceMessageFileName(recording.mimeType),
      { type: recording.mimeType },
    );
    await tasksStore.uploadAttachment(props.taskId, file, {
      language: voiceLanguage.value,
      transcribe: false,
    });
  } catch (e) {
    voiceUploadError.value =
      e?.response?.data?.error || "Failed to upload the voice message.";
  } finally {
    emit("voice-busy", false);
  }
}

async function startVoiceMessage() {
  voiceUploadError.value = "";
  mode.value = "write";
  await inline.start({ keepAudio: true });
}

async function stopVoiceRecording() {
  await inline.stop();
}

function cancelVoiceRecording() {
  void inline.cancel();
}

// External value changes (draft restore, clear on send) flow into the
// autosized textarea; user input flows back out and into the draft store.
watch(
  () => props.modelValue,
  (value) => {
    if (value !== input.value) {
      input.value = value;
      triggerResize();
    }
  },
  { immediate: true },
);

watch(input, (value) => {
  emit("update:modelValue", value);
  saveCommentDraft(props.draftKey, value);
});

// Returning from Preview: the hidden textarea reported scrollHeight 0, so
// re-measure once it is visible again
watch(mode, async () => {
  if (mode.value === "write") {
    await nextTick();
    triggerResize();
  }
});

const previewHtml = computed(() => renderMarkdown(props.modelValue));

function onKeydown(event) {
  if (event.key === "Escape" && isRecording.value) {
    event.stopPropagation();
    cancelVoiceRecording();
    return;
  }
  if (event.key === "Enter" && isRecording.value) {
    // Recording must never submit the comment form
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    // Sync first: the input watcher job may not have flushed yet
    emit("update:modelValue", input.value);
    if (input.value.trim() && !props.busy) {
      emit("submit");
    }
  }
}
</script>

<style scoped>
.comment-composer {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-2xs);
  min-width: 0;
}

.composer-tabs {
  display: flex;
  gap: var(--space-2xs);
}

.composer-tab {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  padding: 0.05em 0.6em;
  cursor: pointer;
}

.composer-tab:hover {
  color: var(--color-text);
}

.composer-tab.active {
  border-color: var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}

/* Voice record button, at the end of the Write/Preview tab row */
.composer-voice-btn {
  margin-left: auto;
  font-size: var(--text-md);
}

.composer-voice-btn.recording {
  color: var(--color-danger);
}

/* Recording state: elapsed time plus stop/cancel, one row */
.composer-voice-status {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.composer-voice-timer {
  font-variant-numeric: tabular-nums;
  color: var(--color-danger);
  font-size: var(--text-sm);
}

.composer-voice-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}

.composer-retention {
  margin: 0;
  font-size: var(--text-xs);
  opacity: 0.7;
}

textarea {
  margin: 0;
  width: 100%;
  overflow: hidden;
  resize: none;
}

.composer-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: start;
  gap: var(--space-xs);
  min-width: 0;
}

/* Mirrors the .comment-body look so Preview shows what readers will get */
.composer-preview {
  margin-left: var(--space-sm);
  border-left: 3px solid var(--color-border);
  padding-left: var(--space-sm);
  font-size: var(--text-md);
  line-height: 1.5;
  overflow-wrap: break-word;
  min-height: 2em;
}
</style>
