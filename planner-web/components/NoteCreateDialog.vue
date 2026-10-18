<template>
  <dialog ref="dialogEl" @close="emit('close')">
    <article>
      <header class="dialog-header">
        <h3>Create Note</h3>
        <div class="dialog-actions">
          <button
            type="button"
            class="icon-btn"
            :aria-busy="creating"
            aria-label="Create note"
            @click="createNote"
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
const dialogError = ref("");

function setDialogError(e, fallback) {
  dialogError.value = e?.response?.data?.error || fallback;
}

function dismissDialogError() {
  dialogError.value = "";
}

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
      dialogError.value = "";
      form.value = {
        projectId: defaultProjectId(),
        title: "",
        description: "",
      };
    }
  },
);

async function createNote() {
  dialogError.value = "";
  creating.value = true;
  try {
    const created = await notesStore.create(form.value);
    emit("close");
    emit("created", created.id);
  } catch (e) {
    setDialogError(e, "Failed to create note");
  } finally {
    creating.value = false;
  }
}
</script>
