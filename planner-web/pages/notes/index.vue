<template>
  <div class="notes-page">
    <header class="page-header">
      <hgroup>
        <h1>Notes</h1>
        <p>Free-form notes</p>
      </hgroup>
      <div class="header-controls">
        <ProjectSelect
          :model-value="projectsStore.selectedProjectFilter"
          all-label="All projects"
          @update:model-value="onFilterChange"
        />
        <button class="fab-button" @click="showCreateDialog = true">
          <i class="bi bi-plus-lg" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-indicator" />

    <div v-else class="note-list">
      <NoteCard
        v-for="note in filteredNotes"
        :key="note.id"
        :note="note"
        @click="openNote(note)"
      />
    </div>

    <!-- Create Dialog -->
    <dialog
      ref="createDialogEl"
      @close="showCreateDialog = false"
    >
      <article>
        <header>
          <h3>Create Note</h3>
          <button
            class="close-btn"
            aria-label="Close"
            @click="showCreateDialog = false"
          />
        </header>
        <form @submit.prevent="createNote">
          <label>
            Project
            <ProjectSelect v-model="newNote.projectId" />
          </label>
          <label>
            Title
            <input
              v-model="newNote.title"
              type="text"
              required
              placeholder="Note title"
            />
          </label>
          <label>
            Description
            <textarea
              v-model="newNote.description"
              placeholder="Note content"
              rows="5"
            />
          </label>
          <footer class="dialog-footer">
            <button type="submit" :aria-busy="creating">Create</button>
            <button
              class="secondary"
              type="button"
              @click="showCreateDialog = false"
            >
              Cancel
            </button>
          </footer>
        </form>
      </article>
    </dialog>
  </div>
</template>

<script setup>
const notesStore = useNotesStore();
const projectsStore = useProjectsStore();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const showCreateDialog = ref(false);
// Modal dialog wiring: backdrop, focus trap, Escape to close
const createDialogEl = useModalDialog(() => showCreateDialog.value);
const creating = ref(false);
const newNote = ref({ projectId: "", title: "", description: "" });

const filteredNotes = computed(() => {
  const filterId = projectsStore.selectedProjectFilter;
  if (!filterId) return notesStore.notes;
  // The filter spans the selected project's whole subtree
  const ids = new Set(projectsStore.subtreeProjectIds(filterId));
  return notesStore.notes.filter((n) => ids.has(n.projectId));
});

function onFilterChange(projectId) {
  projectsStore.setProjectFilter(projectId);
}

function openNote(note) {
  router.replace({
    path: route.path,
    query: { ...route.query, noteId: note.id },
  });
}

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
    // Archived projects cannot receive notes: default to the default
    // project when active, then to the first active project
    if (projectsStore.activeProjects.length > 0) {
      const def = projectsStore.defaultProject;
      newNote.value.projectId =
        def && !def.archived ? def.id : projectsStore.activeProjects[0].id;
    }
    await notesStore.fetchAll();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

// Refresh list when note dialog closes
useDialogCloseRefresh("noteId", () => notesStore.fetchAll());

async function createNote() {
  creating.value = true;
  try {
    const created = await notesStore.create(newNote.value);
    showCreateDialog.value = false;
    newNote.value = { projectId: "", title: "", description: "" };
    // Open the note dialog on the freshly created note
    router.replace({
      path: route.path,
      query: { ...route.query, noteId: created.id },
    });
  } catch (e) {
    alert(e.response?.data?.error || "Failed to create note");
  } finally {
    creating.value = false;
  }
}
</script>

<style scoped>
.note-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-md);
}
</style>
