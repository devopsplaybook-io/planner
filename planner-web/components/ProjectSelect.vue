<template>
  <select :value="modelValue" @change="onChange">
    <option v-if="allLabel" value="">{{ allLabel }}</option>
    <option v-for="p in options" :key="p.id" :value="p.id">
      {{ p.name }}{{ p.archived ? " (archived)" : "" }}
    </option>
  </select>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: String, default: "" },
  allLabel: { type: String, default: "" },
  includeArchived: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

const projectsStore = useProjectsStore();

// Active projects only, unless the consumer opts in (history). A persisted
// filter pointing at an archived project stays selectable so the select
// never shows an empty value; the API returns archived projects last.
const options = computed(() => {
  const projects = projectsStore.projects;
  if (props.includeArchived) {
    return projects;
  }
  return projects.filter(
    (p) => !p.archived || p.id === props.modelValue,
  );
});

function onChange(event) {
  emit("update:modelValue", event.target.value);
}
</script>
