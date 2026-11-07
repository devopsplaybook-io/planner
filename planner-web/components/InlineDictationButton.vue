<template>
  <span v-if="visible" class="inline-dictation" data-inline-dictation>
    <span class="inline-dictation-main">
      <label
        v-if="languages.length > 1"
        class="inline-dictation-language"
        :title="'Dictation language'"
      >
        <span class="visually-hidden">Dictation language</span>
        <select
          v-model="language"
          :disabled="isRecording || phase === 'transcribing'"
          aria-label="Dictation language"
        >
          <option v-for="lang in languages" :key="lang" :value="lang">
            {{ languageLabel(lang) }}
          </option>
        </select>
      </label>
      <button
        type="button"
        class="inline-dictation-btn"
        :class="{ recording: isRecording }"
        :aria-label="isRecording ? 'Stop recording' : ariaLabel"
        :aria-pressed="isRecording ? 'true' : 'false'"
        :disabled="buttonDisabled"
        :title="buttonTitle"
        @click="onClick"
        @pointerdown="onPointerDown"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <i
          class="bi"
          :class="isRecording ? 'bi-stop-circle' : 'bi-mic'"
          aria-hidden="true"
        />
      </button>
    </span>

    <span
      v-if="statusVisible"
      class="inline-dictation-status"
      role="status"
      aria-live="polite"
    >
      <template v-if="isRecording">
        <span class="inline-dictation-timer">{{ formattedElapsed }}</span>
        <span class="inline-dictation-level" aria-hidden="true">
          <span :style="{ width: levelPercent }" />
        </span>
        <button
          type="button"
          class="inline-dictation-action"
          aria-label="Stop recording"
          @click="stopRecording"
        >
          <i class="bi bi-stop-circle" aria-hidden="true" /> Stop
        </button>
        <button
          type="button"
          class="inline-dictation-action"
          aria-label="Cancel recording"
          @click="cancelRecording"
        >
          <i class="bi bi-x" aria-hidden="true" /> Cancel
        </button>
      </template>
      <template v-else>
        <span v-if="phase === 'transcribing'" class="inline-dictation-phase">
          Transcribing…
        </span>
        <span v-else-if="phase === 'done'" class="inline-dictation-phase">
          Transcript ready
        </span>
        <button
          v-if="pendingInsert !== null"
          type="button"
          class="inline-dictation-action"
          @click="insertPending"
        >
          Insert transcript
        </button>
        <button
          v-if="canApplyPolished"
          type="button"
          class="inline-dictation-action"
          @click="applyPolished"
        >
          Use improved text
        </button>
        <button
          v-if="hasJob"
          type="button"
          class="inline-dictation-action"
          @click="promote"
        >
          Review in dictation
        </button>
        <button
          v-if="phase === 'transcribing'"
          type="button"
          class="inline-dictation-action"
          aria-label="Cancel dictation"
          @click="cancelRecording"
        >
          Cancel
        </button>
      </template>
    </span>

    <span v-if="error" class="inline-dictation-error" role="alert">
      {{ error }}
      <button
        type="button"
        class="inline-dictation-dismiss"
        aria-label="Dismiss dictation error"
        @click="dismissError"
      >
        ×
      </button>
    </span>
  </span>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useInlineDictation } from "../composables/useInlineDictation";
import { isVoiceRecordingSupported } from "../composables/useDictation";

const props = defineProps({
  // Element or getter returning the field to dictate into
  target: { type: [Object, Function], default: null },
  ariaLabel: { type: String, default: "Dictate" },
  // Offline/busy hints from the host
  disabled: { type: Boolean, default: false },
  // Shared controller so a host can render the button and drive the flow
  controller: { type: Object, default: null },
  showButton: { type: Boolean, default: true },
});

const recommendationStore = useRecommendationStore();

const voiceSupported = isVoiceRecordingSupported();

function targetElement() {
  const target = props.target;
  if (!target) {
    return null;
  }
  return typeof target === "function" ? target() : target;
}

const inline =
  props.controller ||
  useInlineDictation({
    target: () => targetElement(),
  });

const {
  phase,
  isRecording,
  elapsedSeconds,
  level,
  error,
  languages,
  language,
  pendingInsert,
  canApplyPolished,
  hasJob,
  isAvailable,
  isOnline,
} = inline;

const LANGUAGE_LABELS = {
  auto: "Auto",
  en: "EN",
  fr: "FR",
  de: "DE",
  es: "ES",
  it: "IT",
  pt: "PT",
  nl: "NL",
};

function languageLabel(code) {
  return LANGUAGE_LABELS[code] || String(code).toUpperCase();
}

const visible = computed(
  () =>
    props.showButton &&
    recommendationStore.isDictationEnabled &&
    recommendationStore.isDictationSttConfigured &&
    voiceSupported,
);

const enginePreparing = computed(
  () => recommendationStore.dictationEngineState === "preparing",
);

const buttonDisabled = computed(() => {
  if (isRecording.value) {
    return false;
  }
  return (
    props.disabled ||
    !isAvailable.value ||
    enginePreparing.value ||
    phase.value === "transcribing"
  );
});

const buttonTitle = computed(() => {
  if (isRecording.value) {
    return "Stop recording";
  }
  if (!isAvailable.value) {
    return isOnline.value
      ? "Dictation is not available"
      : "Dictation needs a connection";
  }
  if (enginePreparing.value) {
    return "The dictation engine is preparing";
  }
  if (phase.value === "transcribing") {
    return "Transcribing…";
  }
  return props.ariaLabel;
});

const formattedElapsed = computed(() => {
  const minutes = String(
    Math.floor(elapsedSeconds.value / 60),
  ).padStart(2, "0");
  const seconds = String(elapsedSeconds.value % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
});

const levelPercent = computed(() => `${Math.round(level.value * 100)}%`);

const statusVisible = computed(
  () =>
    isRecording.value ||
    phase.value === "transcribing" ||
    pendingInsert.value !== null ||
    canApplyPolished.value,
);

function toggle() {
  if (isRecording.value) {
    void inline.stop();
    return;
  }
  if (buttonDisabled.value) {
    return;
  }
  void inline.start();
}

let holdPointerId = null;
let suppressClick = false;

function onPointerDown(event) {
  if (event.pointerType === "mouse") {
    return;
  }
  if (buttonDisabled.value || isRecording.value) {
    return;
  }
  holdPointerId = event.pointerId;
  suppressClick = true;
  event.preventDefault();
  void inline.start();
}

function onPointerUp(event) {
  if (event.pointerId !== holdPointerId) {
    return;
  }
  holdPointerId = null;
  if (isRecording.value) {
    void inline.stop();
  }
}

function onPointerCancel(event) {
  if (event.pointerId !== holdPointerId) {
    return;
  }
  holdPointerId = null;
  void inline.cancel();
}

function onClick(event) {
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    return;
  }
  toggle();
}

function stopRecording() {
  void inline.stop();
}

function cancelRecording() {
  void inline.cancel();
}

function insertPending() {
  inline.insertPending();
}

function applyPolished() {
  inline.applyPolished();
}

function promote() {
  void inline.promote();
}

function dismissError() {
  error.value = null;
}

function onDocumentKeydown(event) {
  const field = targetElement();
  if (!field) {
    return;
  }
  const focused = document.activeElement === field;
  const key = (event.key || "").toLowerCase();
  if (
    focused &&
    (event.ctrlKey || event.metaKey) &&
    event.altKey &&
    key === "d"
  ) {
    event.preventDefault();
    toggle();
    return;
  }
  if (isRecording.value) {
    if (event.key === "Enter") {
      // Recording must never submit the surrounding form
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void inline.cancel();
      return;
    }
  } else if (event.key === "Escape" && phase.value === "transcribing") {
    void inline.cancel();
  }
}

onMounted(() => {
  document.addEventListener("keydown", onDocumentKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocumentKeydown, true);
});
</script>

<style scoped>
/* The root dissolves so the button joins the host layout and the status
   strip can span a host CSS grid (e.g. `.with-dictation`). */
.inline-dictation {
  display: contents;
}

.inline-dictation-main {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  justify-self: end;
}

.inline-dictation-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: var(--text-md);
  line-height: 1;
  padding: 0.2em 0.35em;
}

.inline-dictation-btn:hover:not(:disabled) {
  color: var(--color-text);
  border-color: var(--color-border);
}

.inline-dictation-btn.recording {
  color: var(--color-danger, #c0392b);
}

.inline-dictation-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.inline-dictation-language select {
  font-size: var(--text-xs);
  padding: 0.1em 0.2em;
}

.inline-dictation-status {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.inline-dictation-timer {
  font-variant-numeric: tabular-nums;
}

.inline-dictation-level {
  display: inline-block;
  width: 2.5em;
  height: 0.4em;
  border-radius: var(--radius-sm);
  background: var(--color-border);
  overflow: hidden;
}

.inline-dictation-level > span {
  display: block;
  height: 100%;
  background: var(--color-danger, #c0392b);
  transition: width 100ms linear;
}

.inline-dictation-action {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--text-sm);
  padding: 0.1em 0.5em;
}

.inline-dictation-error {
  grid-column: 1 / -1;
  color: var(--color-danger, #c0392b);
  font-size: var(--text-sm);
}

.inline-dictation-dismiss {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  margin-left: var(--space-2xs);
}
</style>
