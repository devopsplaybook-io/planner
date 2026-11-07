<template>
  <div class="dictation-diff">
    <p v-if="diff.limited" class="diff-note">
      These texts are too long to compare inline. The raw transcript and the
      current text are shown side by side.
    </p>
    <div v-if="diff.limited" class="diff-columns">
      <div class="diff-column">
        <h5>Raw transcript</h5>
        <p class="diff-text">{{ raw }}</p>
      </div>
      <div class="diff-column">
        <h5>Current text</h5>
        <p class="diff-text">{{ polished }}</p>
      </div>
    </div>
    <p
      v-else
      class="diff-inline"
      aria-label="Differences between the raw transcript and the current text"
    >
      <template v-for="(token, index) in diff.tokens" :key="index">
        <del v-if="token.type === 'removed'">{{ token.text }}</del>
        <ins v-else-if="token.type === 'added'">{{ token.text }}</ins>
        <template v-else>{{ token.text }}</template>
      </template>
    </p>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { computeTextDiff } from "../utils/textDiff";

const props = defineProps({
  raw: { type: String, default: "" },
  polished: { type: String, default: "" },
});

const diff = computed(() => computeTextDiff(props.raw, props.polished));
</script>

<style scoped>
.dictation-diff {
  margin: var(--space-xs) 0;
}

.diff-inline,
.diff-text {
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.diff-inline del {
  background: color-mix(in srgb, var(--color-danger) 18%, transparent);
  color: var(--color-danger);
  text-decoration: line-through;
}

.diff-inline ins {
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
  color: var(--color-primary);
  text-decoration: none;
}

.diff-note {
  font-size: var(--text-sm);
  opacity: 0.8;
}

.diff-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
}

.diff-column h5 {
  margin: 0 0 var(--space-2xs);
  font-size: var(--text-sm);
}

.diff-text {
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-2xs) var(--space-xs);
}

@media (max-width: 600px) {
  .diff-columns {
    grid-template-columns: 1fr;
  }
}
</style>
