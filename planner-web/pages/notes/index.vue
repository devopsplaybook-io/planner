<template>
  <div class="notes-page">
    <header class="page-header">
      <hgroup>
        <h1>Notes</h1>
        <p>Free-form notes</p>
      </hgroup>
      <div class="header-controls">
        <select
          :value="projectsStore.selectedProjectFilter"
          @change="onFilterChange"
        >
          <option value="">All projects</option>
          <option v-for="p in projectsStore.projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select>
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
    <dialog :open="showCreateDialog">
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
            <select v-model="newNote.projectId" required>
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
const creating = ref(false);
const newNote = ref({ projectId: "", title: "", description: "" });

const filteredNotes = computed(() => {
  if (!projectsStore.selectedProjectFilter) return notesStore.notes;
  return notesStore.notes.filter(
    (n) => n.projectId === projectsStore.selectedProjectFilter,
  );
});

function onFilterChange(event) {
  projectsStore.setProjectFilter(event.target.value);
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
    if (projectsStore.projects.length > 0) {
      newNote.value.projectId =
        projectsStore.defaultProject?.id || projectsStore.projects[0].id;
    }
    await notesStore.fetchAll();
  } catch {
    // Handle error
  } finally {
    loading.value = false;
  }
});

// Refresh list when note dialog closes
watch(
  () => route.query.noteId,
  (newVal, oldVal) => {
    if (oldVal && !newVal) {
      notesStore.fetchAll();
    }
  },
);

async function createNote() {
  creating.value = true;
  try {
    await notesStore.create(newNote.value);
    showCreateDialog.value = false;
    newNote.value = { projectId: "", title: "", description: "" };
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
  gap: var(--space-sm);
}
</style>
