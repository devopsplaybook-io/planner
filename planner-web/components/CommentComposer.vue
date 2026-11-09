<template>
  <div class="comment-composer">
    <div class="composer-header">
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
      </div>
      <label
        v-if="showAttachOption"
        class="composer-attach-audio"
        title="Also keep the recording as an audio attachment"
      >
        <input v-model="keepAudio" type="checkbox" :disabled="busy" />
        <i class="bi bi-paperclip" aria-hidden="true" />
        <span>Attach audio</span>
      </label>
    </div>
    <p v-if="voiceUploadError" class="composer-voice-error" role="alert">
      {{ voiceUploadError }}
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
        :keep-audio="keepAudio"
        :show-button="showVoice"
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
  // Voice dictation: offered when the comment belongs to a task and the
  // server supports the inline (transcript-first) flow. One microphone
  // transcribes into the text; the optional toggle also keeps the audio.
  allowVoice: { type: Boolean, default: false },
  taskId: { type: String, default: null },
});
const emit = defineEmits(["update:modelValue", "submit"]);

const recommendationStore = useRecommendationStore();
const tasksStore = useTasksStore();

const mode = ref("write");
const keepAudio = ref(false);
const { textarea, input, triggerResize } = useTextareaAutosize();

// Dictation into the comment text; when the user asked to attach the audio
// the recording is also uploaded as a regular audio attachment.
const inline = useInlineDictation({
  target: () => textarea.value,
  onKeepAudio: (recording) => uploadVoiceMessage(recording),
  onInserted: () => triggerResize(),
});

const { isRecording } = inline;

const voiceUploadError = ref("");

// MediaRecorder APIs are probed once; SSR is disabled in this app
const voiceSupported = isVoiceRecordingSupported();
const showVoice = computed(
  () =>
    props.allowVoice &&
    !!props.taskId &&
    recommendationStore.dictationInlineJobs === true &&
    !props.busy,
);
const showAttachOption = computed(
  () => showVoice.value && voiceSupported,
);

/**
 * The audio is kept as a task attachment; the inline dictation job handles
 * the transcription and the composer posts the single, edited comment.
 */
async function uploadVoiceMessage(recording) {
  if (!props.taskId || !recording?.blob) {
    return;
  }
  voiceUploadError.value = "";
  try {
    const file = new File(
      [recording.blob],
      voiceMessageFileName(recording.mimeType),
      { type: recording.mimeType },
    );
    await tasksStore.uploadAttachment(props.taskId, file);
  } catch (e) {
    voiceUploadError.value =
      e?.response?.data?.error || "Failed to upload the voice message.";
  }
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
    void inline.cancel();
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

.composer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2xs);
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

/* Optional audio retention, aligned with the Write/Preview tabs */
.composer-attach-audio {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
}

.composer-attach-audio input {
  margin: 0;
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
