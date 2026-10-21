<template>
  <section v-if="sortedTags.length" class="tag-cloud">
    <h2><i class="bi bi-tags" /> Tags</h2>
    <div class="tag-cloud-list">
      <button
        v-for="tag in sortedTags"
        :key="tag.name"
        type="button"
        class="cloud-tag"
        :class="{ 'is-active': isActive(tag.name) }"
        :style="tagStyle(tag)"
        :aria-pressed="isActive(tag.name)"
        :title="`Used ${tag.count} time${tag.count === 1 ? '' : 's'} — click to ${
          isActive(tag.name) ? 'remove from' : 'add to'
        } the filter`"
        @click="toggle(tag.name)"
      >
        <i class="bi bi-tag" />
        {{ tag.name }}
        <span class="cloud-tag-count">{{ tag.count }}</span>
      </button>
    </div>
  </section>
</template>

<script setup>
// Dashboard tag cloud: every label in use, sized by usage count, wired to the
// dashboard label filter (click toggles the label in the selection).
// Explicit imports so the component also mounts under plain vitest
// (without Nuxt's auto-imports) — see TagCloud.spec.ts
import { computed } from "vue";

const props = defineProps({
  tags: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
});
const emit = defineEmits(["update:modelValue"]);

const sortedTags = computed(() =>
  [...props.tags].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  ),
);

// Square-root scaling keeps a very popular tag from dwarfing the others
const maxCount = computed(() =>
  Math.max(1, ...sortedTags.value.map((tag) => tag.count)),
);

function tagStyle(tag) {
  const ratio = Math.sqrt(tag.count) / Math.sqrt(maxCount.value);
  return { fontSize: `${(0.8 + 0.3 * ratio).toFixed(2)}em` };
}

function isActive(name) {
  return props.modelValue.includes(name);
}

function toggle(name) {
  emit(
    "update:modelValue",
    isActive(name)
      ? props.modelValue.filter((label) => label !== name)
      : [...props.modelValue, name],
  );
}
</script>

<style scoped>
.tag-cloud h2 {
  font-size: var(--text-lg);
  margin-bottom: var(--space-sm);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.tag-cloud-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
}

.cloud-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0.15em 0.6em;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-primary-text);
  line-height: var(--leading-normal);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.cloud-tag:hover {
  background: var(--color-primary-soft);
  border-color: var(--color-primary);
}

.cloud-tag.is-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-on-primary);
}

.cloud-tag-count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  padding: 0 0.35em;
  border-radius: var(--radius-full);
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
}

.cloud-tag.is-active .cloud-tag-count {
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
}

@media (max-width: 767px) {
  .cloud-tag {
    padding: 0.3em 0.7em;
  }
}
</style>
