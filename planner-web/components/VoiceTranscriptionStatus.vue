<template>
  <p class="voice-transcription-status" :class="`is-${state}`" role="status">
    <template v-if="state === 'processing'">
      <i class="bi bi-arrow-repeat spinning" aria-hidden="true" />
      <span>{{ processingLabel }}</span>
    </template>
    <template v-else-if="state === 'done'">
      <i class="bi bi-check2-circle" aria-hidden="true" />
      <span>Transcript ready</span>
    </template>
    <template v-else-if="state === 'error'">
      <i class="bi bi-exclamation-triangle" aria-hidden="true" />
      <span>Transcription failed</span>
      <button
        type="button"
        class="secondary small-btn"
        :disabled="retrying"
        :aria-busy="retrying"
        @click="emit('retry')"
      >
        {{ retrying ? "Retrying…" : "Retry" }}
      </button>
    </template>
    <template v-else-if="state === 'skipped'">
      <i class="bi bi-info-circle" aria-hidden="true" />
      <span>Transcription skipped</span>
      <button
        type="button"
        class="secondary small-btn"
        :disabled="retrying"
        :aria-busy="retrying"
        @click="emit('retry')"
      >
        {{ retrying ? "Retrying…" : "Retry" }}
      </button>
    </template>
    <template v-else>
      <i class="bi bi-mic" aria-hidden="true" />
      <span>Voice message</span>
      <button
        type="button"
        class="secondary small-btn"
        :disabled="retrying"
        :aria-busy="retrying"
        @click="emit('retry')"
      >
        {{ retrying ? "Transcribing…" : "Transcribe" }}
      </button>
    </template>
  </p>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  attachmentId: { type: String, default: "" },
  status: { type: String, default: null },
  stage: { type: String, default: null },
  retrying: { type: Boolean, default: false },
});
const emit = defineEmits(["retry"]);

const state = computed(() =>
  ["processing", "done", "error", "skipped"].includes(props.status)
    ? props.status
    : "idle",
);

const processingLabel = computed(() =>
  props.stage === "polishing" ? "Finishing transcript…" : "Transcribing…",
);
</script>

<style scoped>
.voice-transcription-status {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  margin: var(--space-2xs) 0 0;
  font-size: var(--text-sm);
}

.voice-transcription-status.is-processing {
  color: var(--color-primary);
}

.voice-transcription-status.is-error {
  color: var(--color-danger);
}

.voice-transcription-status.is-done {
  opacity: 0.85;
}

.voice-transcription-status .small-btn {
  padding: 0 var(--space-2xs);
  font-size: var(--text-sm);
}

.spinning {
  display: inline-block;
  animation: voice-spin 1s linear infinite;
}

@keyframes voice-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
