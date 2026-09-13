<template>
  <div class="status-color-picker">
    <div class="swatch-grid">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        class="swatch"
        :class="{ 'is-selected': color === modelValue }"
        :style="{ backgroundColor: color }"
        :title="color"
        :aria-label="`Color ${color}`"
        @click="choose(color)"
      />
    </div>
  </div>
</template>

<script setup>
defineProps({
  modelValue: { type: String, required: true },
});

const emit = defineEmits(["update:modelValue", "select"]);

// 10 main hues, 3 shades each (light / base / dark)
const colors = [
  // Gray
  "#9ca3af",
  "#6b7280",
  "#374151",
  // Red
  "#fca5a5",
  "#ef4444",
  "#b91c1c",
  // Orange
  "#fdba74",
  "#f97316",
  "#c2410c",
  // Amber
  "#fcd34d",
  "#f59e0b",
  "#b45309",
  // Green
  "#86efac",
  "#22c55e",
  "#15803d",
  // Teal
  "#5eead4",
  "#14b8a6",
  "#0f766e",
  // Blue
  "#93c5fd",
  "#3b82f6",
  "#1d4ed8",
  // Indigo
  "#a5b4fc",
  "#6366f1",
  "#4338ca",
  // Purple
  "#d8b4fe",
  "#a855f7",
  "#7e22ce",
  // Pink
  "#f9a8d4",
  "#ec4899",
  "#be185d",
];

function choose(color) {
  emit("update:modelValue", color);
  emit("select", color);
}
</script>

<style scoped>
.swatch-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: var(--space-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  width: fit-content;
}

.swatch {
  width: 34px;
  height: 24px;
  padding: 0;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: transform 0.1s;
}

.swatch:hover {
  transform: scale(1.1);
}

.swatch.is-selected {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
