<template>
  <div class="notes-page">
    <header class="page-header">
      <hgroup>
        <h1>Notes</h1>
        <p>Free-form notes</p>
      </hgroup>
      <div class="header-controls">
        <div class="search-box">
          <i class="bi bi-search" />
          <input
            v-model="searchQuery"
            type="search"
            class="search-input"
            placeholder="Search notes…"
            aria-label="Search notes"
          />
        </div>
        <ProjectSelect
          :model-value="projectsStore.selectedProjectFilter"
          all-label="All projects"
          @update:model-value="onFilterChange"
        />
        <div class="label-filter">
          <LabelMultiSelect
            v-model="selectedLabels"
            :suggestions="noteLabelSuggestions"
            placeholder="Filter by label…"
            aria-label="Filter by labels"
          />
        </div>
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
import { watchDebounced } from "@vueuse/core";

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

// All client-side on the loaded notes: search (title + description), the
// label filter (a note must carry every selected label) and the project
// subtree filter AND-combine
const searchQuery = ref("");
const appliedSearch = ref("");
const selectedLabels = ref([]);

watchDebounced(
  searchQuery,
  () => {
    appliedSearch.value = searchQuery.value;
  },
  { debounce: 300 },
);

// Suggestions come from the labels actually in use on the loaded notes
const noteLabelSuggestions = computed(() => {
  const counts = new Map();
  for (const note of notesStore.notes) {
    for (const label of note.labels || []) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});

const filteredNotes = computed(() => {
  let notes = notesStore.notes;
  const filterId = projectsStore.selectedProjectFilter;
  if (filterId) {
    // The filter spans the selected project's whole subtree
    const ids = new Set(projectsStore.subtreeProjectIds(filterId));
    notes = notes.filter((n) => ids.has(n.projectId));
  }
  if (selectedLabels.value.length) {
    notes = notes.filter((n) =>
      selectedLabels.value.every((label) => (n.labels || []).includes(label)),
    );
  }
  const term = appliedSearch.value.trim().toLowerCase();
  if (term) {
    notes = notes.filter(
      (n) =>
        n.title.toLowerCase().includes(term) ||
        (n.description || "").toLowerCase().includes(term),
    );
  }
  return notes;
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
// Regular in-place refresh: notes may have been updated elsewhere; the silent
// refresh keeps the scroll position and re-reads the current filter
useRegularRefresh(() => notesStore.fetchAll());

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

/* Search box: same markup and styles as the dashboard search */
.search-box {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0 0.6em;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.search-box:focus-within {
  border-color: var(--color-primary);
}

.search-box > i {
  opacity: 0.55;
}

.search-input {
  width: 13rem;
  max-width: 40vw;
  padding: 0.45em 0;
  border: none;
  background: transparent;
  font-size: var(--text-md);
  color: var(--color-text);
}

.search-input:focus {
  outline: none;
  /* Pico paints its focus ring with a box-shadow, which reads as a border
     inset from the outer search box; keep the highlight on .search-box */
  box-shadow: none;
}

/* Compact chip editor for the label filter */
.label-filter {
  width: 12rem;
  max-width: 40vw;
}

.label-filter :deep(.lms-input) {
  min-width: 6em;
}
</style>
