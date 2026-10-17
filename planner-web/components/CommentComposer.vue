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
        :class="{ recording: isVoiceRecording }"
        :aria-pressed="isVoiceRecording"
        :aria-label="
          isVoiceRecording ? 'Stop recording' : 'Record a voice comment'
        "
        @click="isVoiceRecording ? stopVoiceRecording() : startVoiceRecording()"
      >
        <i class="bi" :class="isVoiceRecording ? 'bi-stop-circle' : 'bi-mic'" />
      </button>
    </div>
    <div
      v-if="isVoiceRecording"
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
    <p v-if="voiceError && !isVoiceRecording" class="composer-voice-error" role="alert">
      {{ voiceError }}
    </p>
    <textarea
      v-show="mode === 'write'"
      ref="textarea"
      v-model="input"
      rows="2"
      :placeholder="placeholder"
      @keydown="onKeydown"
    />
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
import { useDictation, isVoiceRecordingSupported } from "../composables/useDictation";

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
  // Voice comments: when true, offer a record button (the parent uploads
  // the recording through the voice event)
  allowVoice: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue", "submit", "voice"]);

const mode = ref("write");
const { textarea, input, triggerResize } = useTextareaAutosize();

// Voice recording shares the dictation dialog's recorder composable; the
// composer stays decoupled from the task APIs: it only emits the result
const {
  isRecording: isVoiceRecording,
  elapsedSeconds: voiceElapsedSeconds,
  error: voiceError,
  start: startVoiceRecordingInternal,
  stop: stopVoiceRecordingInternal,
  cancel: cancelVoiceRecordingInternal,
} = useDictation();

// MediaRecorder APIs are probed once; SSR is disabled in this app
const voiceSupported = isVoiceRecordingSupported();
const showVoiceButton = computed(
  () => props.allowVoice && voiceSupported && !props.busy,
);

const formattedVoiceElapsed = computed(() => {
  const minutes = String(Math.floor(voiceElapsedSeconds.value / 60)).padStart(2, "0");
  const seconds = String(voiceElapsedSeconds.value % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
});

async function startVoiceRecording() {
  await startVoiceRecordingInternal();
}

async function stopVoiceRecording() {
  const recording = await stopVoiceRecordingInternal();
  if (recording) {
    emit("voice", recording);
  }
}

function cancelVoiceRecording() {
  cancelVoiceRecordingInternal();
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
  if (event.key === "Escape" && isVoiceRecording.value) {
    event.stopPropagation();
    cancelVoiceRecording();
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

textarea {
  margin: 0;
  width: 100%;
  overflow: hidden;
  resize: none;
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
