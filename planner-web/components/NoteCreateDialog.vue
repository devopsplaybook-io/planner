<template>
  <dialog ref="dialogEl" @close="emit('close')">
    <article>
      <header>
        <h3>Create Note</h3>
        <button class="close-btn" aria-label="Close" @click="emit('close')" />
      </header>
      <form @submit.prevent="createNote">
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
            placeholder="Note title"
          />
        </label>
        <label>
          Description
          <textarea
            v-model="form.description"
            placeholder="Note content"
            rows="5"
          />
        </label>
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
const props = defineProps({
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close", "created"]);

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => props.open);

const notesStore = useNotesStore();
const projectsStore = useProjectsStore();

const creating = ref(false);

function defaultProjectId() {
  // Archived projects cannot receive notes: a stored filter pointing at one
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

const form = ref({ projectId: "", title: "", description: "" });

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      form.value = {
        projectId: defaultProjectId(),
        title: "",
        description: "",
      };
    }
  },
);

async function createNote() {
  creating.value = true;
  try {
    const created = await notesStore.create(form.value);
    emit("close");
    emit("created", created.id);
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create note");
  } finally {
    creating.value = false;
  }
}
</script>
