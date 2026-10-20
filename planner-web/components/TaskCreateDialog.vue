<template>
  <dialog ref="dialogEl" @close="emit('close')">
    <article>
      <header class="dialog-header">
        <h3>Create Task</h3>
        <div class="dialog-actions">
          <button
            type="button"
            class="icon-btn"
            :aria-busy="creating"
            aria-label="Create task"
            @click="createTask"
          >
            <i class="bi bi-check" />
          </button>
          <button
            type="button"
            class="secondary icon-btn"
            aria-label="Cancel"
            @click="emit('close')"
          >
            <i class="bi bi-arrow-counterclockwise" />
          </button>
          <button class="close-btn" aria-label="Close" @click="emit('close')">
            ×
          </button>
        </div>
      </header>

      <div v-if="dialogError" class="dialog-error" role="alert">
        <span>{{ dialogError }}</span>
        <button
          class="dialog-error-dismiss"
          aria-label="Dismiss error"
          @click="dismissDialogError"
        >
          ×
        </button>
      </div>

      <form @submit.prevent="createTask">
        <label>
          Project
          <ProjectSelect v-model="form.projectId" />
        </label>
        <label>
          Title
          <input
            v-model="form.title"
            type="text"
            required
            placeholder="Task title"
          />
        </label>
        <label>
          Description
          <textarea
            v-model="form.description"
            placeholder="Optional description"
          />
        </label>
        <label>
          Priority
          <select v-model="form.priority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Due date
          <input v-model="form.dueDate" type="date" />
        </label>
        <fieldset>
          <legend>Assignees</legend>
          <UserMultiSelect v-model="form.assignees" :users="users" />
        </fieldset>
        <fieldset>
          <legend>Labels</legend>
          <LabelMultiSelect
            v-model="form.labels"
            :suggestions="labelsStore.labels"
            :exclude-prefixes="MACHINE_LABEL_PREFIXES"
          />
        </fieldset>
        <fieldset>
          <legend>Checklist</legend>
          <div
            v-for="(item, idx) in form.checklist"
            :key="idx"
            class="checklist-input-row"
          >
            <input
              v-model="form.checklist[idx].text"
              type="text"
              placeholder="Checklist item"
            />
            <button
              type="button"
              class="small secondary"
              @click="form.checklist.splice(idx, 1)"
            >
              <i class="bi bi-x" />
            </button>
          </div>
          <button
            type="button"
            class="small"
            @click="form.checklist.push({ text: '', done: false })"
          >
            <i class="bi bi-plus" /> Add item
          </button>
        </fieldset>
      </form>
    </article>
  </dialog>
</template>

<script setup>
import api from "../utils/api";
import { MACHINE_LABEL_PREFIXES } from "../utils/labels";

const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "created"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => props.open);

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const authStore = useAuthStore();
const labelsStore = useLabelsStore();

const users = ref([]);
const creating = ref(false);
const dialogError = ref("");

function setDialogError(e, fallback) {
  dialogError.value = e?.response?.data?.error || fallback;
}

function dismissDialogError() {
  dialogError.value = "";
}

function defaultProjectId() {
  // Archived projects cannot receive tasks: a stored filter pointing at one
  // falls back to the default project, then to the first active project
  const stored = projectsStore.selectedProjectFilter;
  if (projectsStore.activeProjects.some((p) => p.id === stored)) {
    return stored;
  }
  const def = projectsStore.defaultProject;
  if (def && !def.archived) {
    return def.id;
  }
  const active = projectsStore.activeProjects;
  return active.length > 0 ? active[0].id : "";
}

const form = ref({
  projectId: defaultProjectId(),
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
  assignees: [],
  labels: [],
  checklist: [],
});

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      dialogError.value = "";
      form.value = {
        projectId: defaultProjectId(),
        title: "",
        description: "",
        priority: "medium",
        dueDate: "",
        assignees: authStore.currentUser?.id ? [authStore.currentUser.id] : [],
        labels: [],
        checklist: [],
      };
      // Fetch users for the assignee picker
      try {
        const res = await api.get("/users/picker");
        users.value = res.data;
      } catch {
        users.value = [];
      }
      // Existing labels feed the autocomplete suggestions
      labelsStore.fetchAll().catch(() => {});
    }
  },
);

async function createTask() {
  dialogError.value = "";
  creating.value = true;
  try {
    const data = {
      projectId: form.value.projectId,
      title: form.value.title,
      description: form.value.description,
      priority: form.value.priority,
      dueDate: form.value.dueDate || undefined,
      assignees: form.value.assignees,
      labels: form.value.labels,
      checklist: form.value.checklist.filter((c) => c.text.trim()),
    };
    const created = await tasksStore.create(data);
    emit("close");
    emit("created", created.id);
  } catch (e) {
    setDialogError(e, "Failed to create task");
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.checklist-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-xs);
  margin-bottom: var(--space-xs);
  align-items: center;
}

.checklist-input-row button {
  padding: 0.2em 0.5em;
}
</style>
