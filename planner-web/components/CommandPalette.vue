<template>
  <dialog
    ref="dialogEl"
    class="palette-dialog"
    aria-label="Command palette"
    @close="commandPaletteStore.closePalette()"
  >
    <div class="palette">
      <div class="palette-search">
        <i class="bi bi-search" aria-hidden="true" />
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          class="palette-input"
          placeholder="Search tasks and notes…"
          aria-label="Search tasks and notes"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-listbox"
          @keydown="onInputKeydown"
        />
      </div>
      <ul
        id="palette-listbox"
        class="palette-list"
        role="listbox"
        aria-label="Palette results"
      >
        <template v-for="(row, index) in rows" :key="row.key">
          <li
            v-if="isGroupStart(row, index)"
            class="palette-group"
            role="presentation"
          >
            {{ row.group }}
          </li>
          <li
            role="option"
            :aria-selected="index === selectedIndex"
            :class="{ selected: index === selectedIndex }"
            @click="activate(row)"
            @mousemove="selectedIndex = index"
          >
            <i class="bi" :class="row.icon" aria-hidden="true" />
            <span class="palette-row-title">{{ row.title }}</span>
            <span v-if="row.hint" class="palette-row-hint">{{
              row.hint
            }}</span>
          </li>
        </template>
        <li
          v-if="rows.length === 0"
          class="palette-empty"
          role="presentation"
        >
          <i class="bi bi-search" aria-hidden="true" />
          <p>{{ searching ? "Searching…" : "No matches" }}</p>
        </li>
      </ul>
      <footer class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </footer>
    </div>
  </dialog>
</template>

<script setup>
import { watchDebounced } from "@vueuse/core";
import { filterAndSort } from "../utils/fuzzyFilter";
import { displayName } from "../utils/projectHierarchy";

const emit = defineEmits(["new-task", "new-note"]);

const commandPaletteStore = useCommandPaletteStore();
const authStore = useAuthStore();
const tasksStore = useTasksStore();
const notesStore = useNotesStore();
const projectsStore = useProjectsStore();
const router = useRouter();
const route = useRoute();

// Modal dialog wiring: backdrop, focus trap, Escape to close
const dialogEl = useModalDialog(() => commandPaletteStore.open);

const query = ref("");
const searching = ref(false);
const taskResults = ref([]);
const noteResults = ref([]);
const selectedIndex = ref(0);

const goToViews = [
  { title: "Dashboard", path: "/", icon: "bi-speedometer2" },
  { title: "Tasks", path: "/tasks", icon: "bi-check2-square" },
  { title: "Calendar", path: "/calendar", icon: "bi-calendar" },
  { title: "Notes", path: "/notes", icon: "bi-journal-text" },
  { title: "Update Feed", path: "/update-feed", icon: "bi-activity" },
  { title: "History", path: "/history", icon: "bi-clock-history" },
  { title: "Settings", path: "/settings", icon: "bi-gear" },
];

const actionRows = computed(() =>
  filterAndSort(quickActions.value, query.value, (action) => action.title),
);

const quickActions = computed(() => [
  {
    key: "action-new-task",
    icon: "bi-plus-square",
    title: "New task",
    run: () => emit("new-task"),
  },
  {
    key: "action-new-note",
    icon: "bi-journal-plus",
    title: "New note",
    run: () => emit("new-note"),
  },
  ...goToViews.map((view) => ({
    key: `action-goto-${view.path}`,
    icon: view.icon,
    title: view.title,
    hint: "Go to",
    run: () => router.push(view.path),
  })),
]);

function projectNameFor(projectId) {
  const project = projectsStore.projects.find((p) => p.id === projectId);
  return project ? displayName(project.name) : "";
}

const resultRows = computed(() => {
  if (!query.value.trim()) {
    return [];
  }
  const taskRows = filterAndSort(
    taskResults.value,
    query.value,
    (task) => task.title,
  ).map((task) => ({
    key: `task-${task.id}`,
    group: "Tasks",
    icon: "bi-check2-square",
    title: task.title,
    hint: [projectNameFor(task.projectId), task.status]
      .filter(Boolean)
      .join(" · "),
    run: () => openDetail("taskId", task.id),
  }));
  const noteRows = filterAndSort(
    noteResults.value,
    query.value,
    (note) => note.title,
  ).map((note) => ({
    key: `note-${note.id}`,
    group: "Notes",
    icon: "bi-journal-text",
    title: note.title,
    hint: projectNameFor(note.projectId),
    run: () => openDetail("noteId", note.id),
  }));
  return [...taskRows, ...noteRows];
});

const rows = computed(() => [...actionRows.value, ...resultRows.value]);

function isGroupStart(row, index) {
  return !!row.group && (index === 0 || rows.value[index - 1].group !== row.group);
}

function openDetail(param, id) {
  router.replace({ path: route.path, query: { ...route.query, [param]: id } });
}

function activate(row) {
  commandPaletteStore.closePalette();
  row.run();
}

async function runSearch() {
  const q = query.value.trim();
  if (!q) {
    taskResults.value = [];
    noteResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  try {
    const [tasks, notes] = await Promise.all([
      tasksStore.searchTasks({ q }),
      notesStore.searchNotes({ q }),
    ]);
    // Ignore stale responses once the query has moved on
    if (query.value.trim() === q) {
      taskResults.value = tasks;
      noteResults.value = notes;
    }
  } catch {
    // Keep the previous results on failure
  } finally {
    if (query.value.trim() === q) {
      searching.value = false;
    }
  }
}

watchDebounced(query, runSearch, { debounce: 300 });

watch(
  () => rows.value.length,
  (length) => {
    if (selectedIndex.value >= length) {
      selectedIndex.value = 0;
    }
  },
);

watch(selectedIndex, () => {
  nextTick(() => {
    dialogEl.value
      ?.querySelector(".palette-list li.selected")
      ?.scrollIntoView({ block: "nearest" });
  });
});

// Fresh state on every open; project names for result hints come along
watch(
  () => commandPaletteStore.open,
  (isOpen) => {
    if (isOpen) {
      query.value = "";
      taskResults.value = [];
      noteResults.value = [];
      searching.value = false;
      selectedIndex.value = 0;
      if (projectsStore.projects.length === 0) {
        projectsStore.fetchAll().catch(() => {});
      }
    }
  },
);

function onInputKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (rows.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % rows.value.length;
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (rows.value.length > 0) {
      selectedIndex.value =
        (selectedIndex.value - 1 + rows.value.length) % rows.value.length;
    }
  } else if (event.key === "Enter") {
    event.preventDefault();
    const row = rows.value[selectedIndex.value];
    if (row) {
      activate(row);
    }
  }
}

// Ctrl/Cmd+K works on every page, even while focus is in an input
function onGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (commandPaletteStore.open) {
      commandPaletteStore.closePalette();
    } else if (authStore.isAuthenticated) {
      commandPaletteStore.openPalette();
    }
  }
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
});
</script>

<style scoped>
/* Palette panel: top-centered instead of the standard centered article */
.palette-dialog {
  place-items: start center;
  padding-top: 8vh;
}

.palette {
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(92%, 560px);
  max-height: 70vh;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  animation: dialog-in var(--transition-fast);
}

.palette-search {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-border);
}

.palette-search > i {
  opacity: 0.55;
}

.palette-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--text-lg);
  color: var(--color-text);
}

.palette-input:focus {
  outline: none;
  box-shadow: none;
}

.palette-list {
  list-style: none;
  margin: 0;
  padding: var(--space-xs);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-group {
  padding: var(--space-xs) var(--space-xs) var(--space-2xs);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-muted);
}

.palette-list li[role="option"] {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.palette-list li[role="option"]:hover {
  background: var(--color-surface-hover);
}

.palette-list li[role="option"].selected {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.palette-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-row-hint {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.palette-list li[role="option"].selected .palette-row-hint {
  color: var(--color-on-primary);
  opacity: 0.8;
}

.palette-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-lg);
  color: var(--color-text-muted);
}

.palette-footer {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-2xs) var(--space-md);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

@media (max-width: 576px) {
  .palette {
    width: 96%;
  }

  .palette-footer {
    display: none;
  }
}
</style>
