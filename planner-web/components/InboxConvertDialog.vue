<template>
  <div class="dialog-backdrop" @click.self="close">
    <div
      class="convert-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="convert-title"
    >
      <header>
        <h2 id="convert-title">
          <i class="bi bi-arrow-right-circle" /> Convert dictation
        </h2>
        <button
          type="button"
          class="icon-button"
          aria-label="Close convert dialog"
          @click="close"
        >
          <i class="bi bi-x-lg" />
        </button>
      </header>

      <p class="preview" :title="item.preview">{{ item.preview }}</p>

      <div class="targets" role="radiogroup" aria-label="Convert to">
        <button
          v-for="option in targets"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="target === option.value"
          class="target"
          :class="{ active: target === option.value }"
          @click="target = option.value"
        >
          <i class="bi" :class="option.icon" />
          {{ option.label }}
        </button>
      </div>

      <div v-if="loading" class="hint">
        <i class="bi bi-hourglass-split" /> Loading the transcript…
      </div>

      <template v-else>
        <label v-if="needsProject" class="field">
          Project
          <ProjectSelect v-model="projectId" all-label="Choose a project" />
        </label>

        <label v-if="needsTask" class="field">
          Task
          <select v-model="taskId">
            <option value="">Choose a task</option>
            <option
              v-for="task in taskOptions"
              :key="task.id"
              :value="task.id"
            >
              {{ task.title }}
            </option>
          </select>
        </label>

        <label v-if="needsTitle" class="field">
          Title
          <input v-model="title" type="text" maxlength="200">
        </label>

        <label class="field">
          {{ needsTitle ? "Description" : "Text" }}
          <textarea v-model="text" rows="6" />
        </label>

        <p class="hint">
          <i class="bi bi-info-circle" />
          {{
            target === "task"
              ? "Creates a task in the chosen project, assigned to you."
              : target === "note"
                ? "Creates a note in the chosen project."
                : target === "comment"
                  ? "Adds the text as a comment on the chosen task."
                  : "Each line becomes a checklist item on the chosen task."
          }}
        </p>

        <p v-if="error" class="error" role="alert">{{ error }}</p>

        <div class="actions">
          <button type="button" class="btn-secondary" @click="close">
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="submitting || !canSubmit"
            @click="submit"
          >
            <i class="bi bi-check2" />
            {{ submitting ? "Converting…" : "Convert" }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  item: { type: Object, required: true },
});
const emit = defineEmits(["close", "converted"]);

const inboxStore = useInboxStore();
const tasksStore = useTasksStore();
const { pushToast } = useToasts();

const targets = [
  { value: "task", label: "Task", icon: "bi-check2-square" },
  { value: "note", label: "Note", icon: "bi-journal-text" },
  { value: "comment", label: "Comment", icon: "bi-chat-left-text" },
  { value: "checklist", label: "Checklist", icon: "bi-list-check" },
];

const target = ref("task");
const projectId = ref("");
const taskId = ref("");
const title = ref("");
const text = ref("");
const loading = ref(true);
const submitting = ref(false);
const error = ref("");

const needsProject = computed(
  () => target.value === "task" || target.value === "note",
);
const needsTask = computed(
  () => target.value === "comment" || target.value === "checklist",
);
const needsTitle = computed(() => needsProject.value);

const taskOptions = computed(() => {
  const project = projectId.value;
  return tasksStore.tasks
    .filter((task) => !project || task.projectId === project)
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
});

const canSubmit = computed(() => {
  if (!text.value.trim()) return false;
  if (needsProject.value && !projectId.value) return false;
  if (needsTask.value && !taskId.value) return false;
  return true;
});

function firstLine(value) {
  return (
    (value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "Dictation"
  ).slice(0, 200);
}

async function load() {
  loading.value = true;
  try {
    const detail = await inboxStore.fetchDetail(props.item.id);
    const result = detail?.result;
    text.value = result?.polishedText || result?.rawTranscript || "";
    title.value = firstLine(text.value);
    projectId.value = "";
    await tasksStore.fetchAll().catch(() => undefined);
  } finally {
    loading.value = false;
  }
}

function close() {
  emit("close");
}

async function submit() {
  if (!canSubmit.value || submitting.value) {
    return;
  }
  error.value = "";
  submitting.value = true;
  const payload = {
    target: target.value,
    text: text.value.trim(),
    title: title.value.trim(),
  };
  if (needsProject.value) {
    payload.projectId = projectId.value;
  }
  if (needsTask.value) {
    payload.taskId = taskId.value;
  }
  const result = await inboxStore.convert(props.item.id, payload);
  submitting.value = false;
  if (result.error) {
    error.value = result.error;
    return;
  }
  pushToast({
    kind: "success",
    title: `Converted to ${target.value}`,
    message: needsTask.value ? "The task was updated." : undefined,
  });
  emit("converted", {
    target: target.value,
    targetId: result.targetId || null,
  });
  emit("close");
}

onMounted(load);
</script>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  padding: var(--space-sm);
}

.convert-dialog {
  width: min(520px, 100%);
  max-height: 90vh;
  overflow: auto;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.icon-button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: var(--space-2xs);
}

.preview {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  border-left: 3px solid var(--color-border-strong);
  padding-left: var(--space-sm);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.targets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2xs);
}

.target {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: none;
  color: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.target i {
  font-size: var(--text-lg);
}

.target.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  font-weight: var(--weight-bold);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  font-size: var(--text-sm);
}

.field input,
.field select,
.field textarea {
  font: inherit;
  color: inherit;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-2xs) var(--space-xs);
}

.field textarea {
  resize: vertical;
}

.hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.error {
  margin: 0;
  color: var(--color-danger, #d64545);
  font-size: var(--text-sm);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-md);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.btn-primary {
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  color: var(--color-on-primary, #fff);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: none;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text);
}

@media (max-width: 480px) {
  .targets {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>