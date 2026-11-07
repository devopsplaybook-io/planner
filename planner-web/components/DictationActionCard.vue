<template>
  <li class="action-card" :class="[`is-${preview.status}`, { 'is-selected': selected }]">
    <div class="action-card-header">
      <label class="action-include">
        <input
          type="checkbox"
          :checked="selected"
          :disabled="!canSelect || busy"
          :aria-label="`Include ${typeLabel}`"
          @change="$emit('update:selected', $event.target.checked)"
        >
        <span class="action-type" :class="`is-${kindClass}`">
          <i class="bi" :class="iconClass" />
          {{ typeLabel }}
        </span>
      </label>
      <span class="resolution-badge" :class="`is-${preview.status}`">
        {{ statusLabel }}
      </span>
    </div>

    <p v-if="preview.target" class="action-target">
      <i class="bi bi-bullseye" /> {{ targetLabel }}
    </p>

    <label v-if="editableTitle" class="action-field">
      <span>Title</span>
      <input
        type="text"
        class="action-title"
        :value="currentTitle"
        @input="emitOverride('title', $event.target.value)"
      >
    </label>

    <label v-if="editableDescription" class="action-field">
      <span>Description</span>
      <textarea
        rows="2"
        :value="currentDescription"
        @input="emitOverride('description', $event.target.value)"
      />
    </label>

    <div v-if="showsCreateOverrides" class="action-overrides">
      <label v-if="projects.length > 0">
        Project
        <select
          :value="currentProjectId"
          aria-label="Task project"
          @change="emitOverride('projectId', $event.target.value)"
        >
          <option value="">Default project</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label v-if="preview.type === 'create_task'">
        Status
        <select
          v-if="statusOptions.length > 0"
          :value="currentStatus"
          aria-label="Task status"
          @change="emitOverride('status', $event.target.value)"
        >
          <option
            v-if="currentStatus && !statusOptions.includes(currentStatus)"
            :value="currentStatus"
          >
            {{ currentStatus }}
          </option>
          <option
            v-for="status in statusOptions"
            :key="status"
            :value="status"
          >
            {{ status }}
          </option>
        </select>
        <input
          v-else
          type="text"
          :value="currentStatus"
          aria-label="Task status"
          @input="emitOverride('status', $event.target.value)"
        >
      </label>
    </div>

    <p v-if="detailText" class="action-detail">{{ detailText }}</p>

    <ul v-if="preview.diff.length > 0" class="action-diff">
      <li v-for="diff in preview.diff" :key="diff.field">
        <span class="diff-field">{{ diff.field }}</span>
        <span class="diff-before">{{ formatValue(diff.before) }}</span>
        <span aria-hidden="true">→</span>
        <span class="diff-after">{{ formatValue(diff.after) }}</span>
      </li>
    </ul>

    <div v-if="pickableCandidates.length > 0" class="action-candidates">
      <p>Several matches: choose one.</p>
      <button
        v-for="candidate in pickableCandidates"
        :key="`${candidate.kind}:${candidate.id}`"
        type="button"
        class="secondary small-btn"
        @click="pickCandidate(candidate)"
      >
        {{ candidate.label }}
        <span v-if="candidate.projectName"> · {{ candidate.projectName }}</span>
      </button>
    </div>

    <p v-if="preview.error" class="action-error">{{ preview.error }}</p>

    <p v-if="result" class="action-result" :class="`is-${result.status}`">
      {{ resultLabel }}
      <span v-if="result.error"> — {{ result.error }}</span>
    </p>
  </li>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  preview: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  result: { type: Object, default: null },
  projects: { type: Array, default: () => [] },
  overrides: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(["update:selected", "override"]);

const TYPE_LABELS = {
  create_task: "Task",
  create_note: "Note",
  update_task: "Update task",
  append_to_task: "Append to task",
  append_to_note: "Append to note",
  add_comment: "Comment",
  add_checklist_items: "Checklist",
  instantiate_template: "Template",
  create_multiple: "Multiple",
};

const TYPE_ICONS = {
  create_task: "bi-check2-square",
  create_note: "bi-journal-text",
  update_task: "bi-pencil-square",
  append_to_task: "bi-text-paragraph",
  append_to_note: "bi-text-paragraph",
  add_comment: "bi-chat-left-text",
  add_checklist_items: "bi-list-check",
  instantiate_template: "bi-file-earmark-plus",
  create_multiple: "bi-collection",
};

const typeLabel = computed(
  () => TYPE_LABELS[props.preview.type] || props.preview.type,
);
const iconClass = computed(
  () => TYPE_ICONS[props.preview.type] || "bi-lightning",
);
const kindClass = computed(() => {
  if (props.preview.type === "create_task" || props.preview.type === "update_task") {
    return "task";
  }
  if (
    props.preview.type === "create_note" ||
    props.preview.type === "append_to_note"
  ) {
    return "note";
  }
  return "other";
});
const statusLabel = computed(() => {
  if (props.preview.status === "resolved") {
    return "Ready";
  }
  if (props.preview.status === "ambiguous") {
    return "Needs a choice";
  }
  return "Cannot apply";
});
const canSelect = computed(() => {
  if (props.preview.status === "resolved") {
    return true;
  }
  if (props.preview.status !== "ambiguous") {
    return false;
  }
  // Picking a match (or a project) turns the card selectable
  return !!(props.overrides.targetId || props.overrides.projectId);
});
const PICKABLE_CANDIDATE_KINDS = ["project", "task", "note", "template"];
const pickableCandidates = computed(() =>
  props.preview.candidates.filter((candidate) =>
    PICKABLE_CANDIDATE_KINDS.includes(candidate.kind),
  ),
);
const statusOptions = computed(() => {
  const project = props.projects.find(
    (entry) => entry.id === currentProjectId.value,
  );
  return project?.statuses?.length ? project.statuses : [];
});
const targetLabel = computed(() => {
  const target = props.preview.target;
  if (!target) {
    return "";
  }
  if (target.kind === "project") {
    return `Project: ${target.label}`;
  }
  if (target.kind === "template") {
    return `Template: ${target.label}${
      target.projectName ? ` (${target.projectName})` : ""
    }`;
  }
  return `${target.kind === "note" ? "Note" : "Task"}: ${target.label}${
    target.projectName ? ` (${target.projectName})` : ""
  }`;
});

const editableTitle = computed(
  () =>
    props.preview.type === "create_task" ||
    props.preview.type === "create_note" ||
    props.preview.type === "instantiate_template",
);
const editableDescription = computed(
  () =>
    props.preview.type === "create_task" || props.preview.type === "create_note",
);
const showsCreateOverrides = computed(
  () =>
    props.preview.type === "create_task" ||
    props.preview.type === "create_note",
);

function currentValue(field) {
  if (Object.prototype.hasOwnProperty.call(props.overrides, field)) {
    return props.overrides[field];
  }
  if (field === "projectId") {
    return props.preview.resolvedProjectId || "";
  }
  if (field === "status") {
    return props.preview.resolvedStatus || props.preview.action.status || "";
  }
  return props.preview.action[field] || "";
}

const currentTitle = computed(() => currentValue("title"));
const currentDescription = computed(() => currentValue("description"));
const currentProjectId = computed(() => currentValue("projectId"));
const currentStatus = computed(() => currentValue("status"));

const detailText = computed(() => {
  const action = props.preview.action;
  if (action.text) {
    return action.text;
  }
  if (action.items && action.items.length > 0) {
    return action.items.join(" · ");
  }
  return "";
});

const resultLabel = computed(() => {
  if (!props.result) {
    return "";
  }
  if (props.result.status === "applied") {
    return "Applied";
  }
  if (props.result.status === "failed") {
    return "Failed";
  }
  return "Skipped";
});

function formatValue(value) {
  return value === null || value === undefined || value === "" ? "—" : value;
}

function emitOverride(field, value) {
  emit("override", { index: props.preview.index, field, value });
}

function pickCandidate(candidate) {
  // Projects are create targets; tasks/notes/templates are write targets
  emitOverride(
    candidate.kind === "project" ? "projectId" : "targetId",
    candidate.id,
  );
}
</script>

<style scoped>
.action-card {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.action-card.is-unresolved {
  opacity: 0.85;
}

.action-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.action-include {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.action-type {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.action-type.is-task {
  color: var(--color-primary);
}

.action-type.is-note {
  color: #8a5a00;
}

.resolution-badge {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
}

.resolution-badge.is-resolved {
  background: #d8f3dc;
  color: #1b4332;
}

.resolution-badge.is-ambiguous {
  background: #fff3bf;
  color: #664d03;
}

.resolution-badge.is-unresolved {
  background: #ffe3e3;
  color: #842029;
}

.action-target,
.action-detail {
  margin: 0;
  font-size: var(--text-sm);
  opacity: 0.85;
}

.action-field {
  display: grid;
  gap: 2px;
  font-size: var(--text-sm);
}

.action-overrides {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  font-size: var(--text-sm);
}

.action-overrides label {
  display: grid;
  gap: 2px;
}

.action-diff {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
  font-size: var(--text-sm);
}

.action-diff li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.diff-field {
  font-weight: 600;
}

.diff-before {
  opacity: 0.7;
  text-decoration: line-through;
}

.diff-after {
  color: #1b4332;
  font-weight: 600;
}

.action-candidates {
  display: grid;
  gap: var(--space-2xs);
}

.action-candidates p {
  margin: 0;
  font-size: var(--text-sm);
}

.action-error {
  margin: 0;
  color: #842029;
  font-size: var(--text-sm);
}

.action-result {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
}

.action-result.is-applied {
  color: #1b4332;
}

.action-result.is-failed {
  color: #842029;
}

.action-result.is-skipped {
  color: #664d03;
}
</style>
