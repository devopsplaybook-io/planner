<template>
  <dialog ref="dialogEl" @close="emit('close')">
    <article>
      <header>
        <h3>Create Task</h3>
        <button class="close-btn" aria-label="Close" @click="emit('close')" />
      </header>
      <form @submit.prevent="createTask">
        <label>
          Project
          <select v-model="form.projectId" required>
            <option
              v-for="p in projectsStore.projects"
              :key="p.id"
              :value="p.id"
            >
              {{ p.name }}
            </option>
          </select>
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
          <div v-if="users.length" class="assignee-picker">
            <label
              v-for="u in users"
              :key="u.id"
              class="assignee-option"
            >
              <input
                v-model="form.assignees"
                type="checkbox"
                :value="u.id"
              />
              {{ u.name }}
            </label>
          </div>
          <small v-else class="text-muted">No users available</small>
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
        <footer class="dialog-footer">
          <button type="submit" :aria-busy="creating">Create</button>
          <button class="secondary" type="button" @click="emit('close')">
            Cancel
          </button>
        </footer>
      </form>
    </article>
  </dialog>
</template>

<script setup>
import api from "../utils/api";

const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "created"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => props.open);

const tasksStore = useTasksStore();
const projectsStore = useProjectsStore();
const authStore = useAuthStore();

const users = ref([]);
const creating = ref(false);

function defaultProjectId() {
  return (
    projectsStore.selectedProjectFilter ||
    projectsStore.defaultProject?.id ||
    (projectsStore.projects.length > 0 ? projectsStore.projects[0].id : "")
  );
}

const form = ref({
  projectId: defaultProjectId(),
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
  assignees: [],
  checklist: [],
});

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      form.value = {
        projectId: defaultProjectId(),
        title: "",
        description: "",
        priority: "medium",
        dueDate: "",
        assignees: authStore.currentUser?.id ? [authStore.currentUser.id] : [],
        checklist: [],
      };
      // Fetch users for the assignee picker
      try {
        const res = await api.get("/users/picker");
        users.value = res.data;
      } catch {
        users.value = [];
      }
    }
  },
);

async function createTask() {
  creating.value = true;
  try {
    const data = {
      projectId: form.value.projectId,
      title: form.value.title,
      description: form.value.description,
      priority: form.value.priority,
      dueDate: form.value.dueDate || undefined,
      assignees: form.value.assignees,
      checklist: form.value.checklist.filter((c) => c.text.trim()),
    };
    await tasksStore.create(data);
    emit("close");
    emit("created");
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create task");
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

.assignee-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.assignee-option {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  cursor: pointer;
  font-weight: var(--weight-normal);
}

.assignee-option input[type="checkbox"] {
  margin: 0;
}

.text-muted {
  color: var(--color-text-muted);
}
</style>
