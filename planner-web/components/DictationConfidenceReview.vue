<template>
  <section class="confidence-review">
    <h4>Review uncertain words</h4>
    <template v-if="lowConfidence.length > 0">
      <p class="confidence-hint">
        These words were recognized with low confidence. Click one to correct
        it.
      </p>
      <ul class="confidence-spans">
        <li
          v-for="(segment, index) in lowConfidence"
          :key="`${segment.fromMs}-${index}`"
          class="confidence-item"
        >
          <button
            type="button"
            class="confidence-span"
            :aria-expanded="editingIndex === index"
            :aria-label="`Correct ${segment.text} (${confidencePercent(segment)} confidence)`"
            @click="startCorrection(index)"
          >
            <span class="confidence-text">{{ segment.text }}</span>
            <span class="confidence-value">{{ confidencePercent(segment) }}</span>
          </button>
          <form
            v-if="editingIndex === index"
            class="confidence-editor"
            @submit.prevent.stop="apply(index)"
          >
            <label>
              Correction
              <input
                ref="correctionInput"
                v-model="replacement"
                type="text"
                :aria-label="`Correction for ${segment.text}`"
              />
            </label>
            <div class="confidence-editor-actions">
              <button type="submit" :disabled="!replacement.trim()">
                Apply
              </button>
              <button
                type="button"
                class="secondary"
                @click="addVocabulary(index)"
              >
                Add to vocabulary
              </button>
              <button type="button" class="secondary" @click="closeEditor">
                Cancel
              </button>
            </div>
          </form>
        </li>
      </ul>
    </template>
    <p v-else class="confidence-hint">
      No low-confidence words were detected in this dictation.
    </p>
    <p v-if="notice" class="confidence-notice" role="status" aria-live="polite">
      {{ notice }}
    </p>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";

const props = defineProps({
  segments: { type: Array, default: () => [] },
  threshold: { type: Number, default: 0.6 },
  notice: { type: String, default: "" },
});
const emit = defineEmits(["apply", "add-vocabulary"]);

const MAX_SPANS = 20;

const editingIndex = ref(-1);
const replacement = ref("");
const correctionInput = ref(null);

const lowConfidence = computed(() =>
  props.segments
    .filter(
      (segment) =>
        segment.confidence !== null &&
        segment.confidence !== undefined &&
        segment.confidence < props.threshold,
    )
    .slice(0, MAX_SPANS),
);

function confidencePercent(segment) {
  return `${Math.round((segment.confidence ?? 0) * 100)}%`;
}

async function startCorrection(index) {
  editingIndex.value = index;
  replacement.value = lowConfidence.value[index]?.text || "";
  await nextTick();
  const input = Array.isArray(correctionInput.value)
    ? correctionInput.value[0]
    : correctionInput.value;
  input?.focus?.();
}

function closeEditor() {
  editingIndex.value = -1;
  replacement.value = "";
}

function apply(index) {
  const segment = lowConfidence.value[index];
  const value = replacement.value.trim();
  if (!segment || !value) {
    return;
  }
  emit("apply", { original: segment.text, replacement: value });
  closeEditor();
}

function addVocabulary(index) {
  const segment = lowConfidence.value[index];
  if (!segment) {
    return;
  }
  const term = replacement.value.trim() || segment.text;
  emit("add-vocabulary", term);
  closeEditor();
}
</script>

<style scoped>
.confidence-review {
  margin-top: var(--space-sm);
}

.confidence-review h4 {
  margin-top: var(--space-sm);
}

.confidence-hint {
  font-size: var(--text-sm);
  opacity: 0.8;
  margin: 0 0 var(--space-xs);
}

.confidence-spans {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.confidence-item {
  display: grid;
  gap: var(--space-2xs);
}

.confidence-span {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2xs);
  border: 1px solid var(--color-warning, #b8860b);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-warning, #b8860b) 14%, transparent);
  color: inherit;
  cursor: pointer;
  padding: 0.05em 0.35em;
  font-size: var(--text-sm);
}

.confidence-span:hover,
.confidence-span[aria-expanded="true"] {
  background: color-mix(in srgb, var(--color-warning, #b8860b) 26%, transparent);
}

.confidence-value {
  font-size: var(--text-xs);
  opacity: 0.75;
}

.confidence-editor {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-xs);
  display: grid;
  gap: var(--space-2xs);
}

.confidence-editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.confidence-notice {
  font-size: var(--text-sm);
  margin: var(--space-2xs) 0 0;
}
</style>
