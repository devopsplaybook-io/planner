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

    <template v-else>
      <section v-if="isSearchActive">
        <h2><i class="bi bi-search" /> Search results</h2>
        <div v-if="searching" class="loading-indicator" />
        <template v-else>
          <div class="note-list">
            <NoteCard
              v-for="note in filteredSearchResults"
              :key="note.id"
              :note="note"
              @click="openNote(note)"
            />
          </div>
          <div v-if="filteredSearchResults.length === 0" class="empty-state">
            <i class="bi bi-search" />
            <p>No notes found</p>
          </div>
        </template>
      </section>

      <div v-else class="note-list">
        <NoteCard
          v-for="note in filteredNotes"
          :key="note.id"
          :note="note"
          @click="openNote(note)"
        />
      </div>
    </template>

    <NoteCreateDialog
      :open="showCreateDialog"
      @close="showCreateDialog = false"
      @created="onNoteCreated"
    />
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

// Label filter: a note must carry every selected label; it composes with
// the project subtree filter and, while searching, with the server-side
// search results
const selectedLabels = ref([]);

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
  return notes;
});

const searchQuery = ref("");
const searchResults = ref([]);
const searching = ref(false);

const isSearchActive = computed(() => searchQuery.value.trim().length > 0);

async function runSearch() {
  const q = searchQuery.value.trim();
  if (!q) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  try {
    const params = { q };
    const filterId = projectsStore.selectedProjectFilter;
    if (filterId) {
      params.projectIds = projectsStore.subtreeProjectIds(filterId);
    }
    searchResults.value = await notesStore.searchNotes(params);
  } catch {
    // Keep the previous results on failure
  } finally {
    searching.value = false;
  }
}

watchDebounced(searchQuery, runSearch, { debounce: 300 });

const filteredSearchResults = computed(() => {
  if (!selectedLabels.value.length) return searchResults.value;
  return searchResults.value.filter((n) =>
    selectedLabels.value.every((label) => (n.labels || []).includes(label)),
  );
});

function onFilterChange(projectId) {
  projectsStore.setProjectFilter(projectId);
  runSearch();
}

function openNote(note) {
  router.replace({
    path: route.path,
    query: { ...route.query, noteId: note.id },
  });
}

async function onNoteCreated(noteId) {
  // Open the note dialog on the freshly created note
  router.replace({
    path: route.path,
    query: { ...route.query, noteId },
  });
  await notesStore.fetchAll();
}

onMounted(async () => {
  try {
    await projectsStore.fetchAll();
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
</script>

<style scoped>
.note-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-md);
}

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
