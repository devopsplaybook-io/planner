<template>
  <div id="page-layout">
    <header>
      <VitePwaManifest />
      <Navigation />
    </header>
    <main>
      <NuxtPage />
    </main>

    <!-- App-level detail dialogs controlled by URL query params -->
    <TaskDetailDialog
      :task-id="route.query.taskId || null"
      @close="closeDialog('taskId')"
      @updated="onDialogUpdated"
    />
    <NoteDetailDialog
      :note-id="route.query.noteId || null"
      @close="closeDialog('noteId')"
      @updated="onDialogUpdated"
    />
    <ProjectDetailDialog
      :project-id="route.query.projectId || null"
      @close="closeDialog('projectId')"
      @updated="onDialogUpdated"
    />
  </div>
</template>

<script setup>
const route = useRoute();
const router = useRouter();

/**
 * Close a detail dialog by removing its query param from the URL.
 */
function closeDialog(param) {
  const newQuery = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => key !== param),
  );
  router.replace({ path: route.path, query: newQuery });
}

/**
 * When a dialog emits 'updated', the store is already mutated.
 * List pages react to store changes automatically via computed props.
 * No further action needed.
 */
function onDialogUpdated() {
  // no-op: stores are updated by the dialog itself;
  // list pages reactively update via computed properties.
}

// Theme management
const theme = ref(localStorage.getItem("theme") || "system");

function getEffectiveTheme() {
  if (theme.value === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme.value;
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", getEffectiveTheme());
}

function toggleTheme() {
  const current = getEffectiveTheme();
  theme.value = current === "dark" ? "light" : "dark";
}

watch(theme, (val) => {
  localStorage.setItem("theme", val);
  applyTheme();
});

// Layout height
function updateAppHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);
}

onMounted(() => {
  applyTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applyTheme);
  updateAppHeight();
  window.addEventListener("resize", updateAppHeight);
  window.visualViewport?.addEventListener("resize", updateAppHeight);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateAppHeight);
  window.visualViewport?.removeEventListener("resize", updateAppHeight);
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .removeEventListener("change", applyTheme);
});

// Provide theme to child components
provide("theme", theme);
provide("toggleTheme", toggleTheme);
</script>

<style>
#page-layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  width: 100vw;
  height: var(--app-height, 100dvh);
  overflow: hidden !important;
}

/* Layout */

header {
  height: var(--header-height, 3em);
}

header,
main {
  padding: var(--space-sm);
}

main {
  grid-column: 1;
  grid-row: 2;
  overflow-x: hidden;
  overflow-y: auto;
  width: 100%;
  height: auto;
}

/* Common Component */

.actions i {
  font-size: var(--text-xl);
  cursor: pointer;
  margin-left: var(--space-sm);
  margin-right: var(--space-sm);
}

@media (prefers-color-scheme: dark) {
  .actions i {
    color: var(--pico-color, #bcc6ce);
  }
}
@media (prefers-color-scheme: light) {
  .actions i {
    color: var(--pico-color, #1d2832);
  }
}

.fab-button {
  position: fixed;
  bottom: var(--space-xl);
  right: var(--space-xl);
  z-index: 1000;
  opacity: 0.3;
  color: var(--pico-primary-inverse, #fff);
  border: none;
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-lg);
  font-size: var(--text-default);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.13);
  cursor: pointer;
  background: var(--pico-primary-background);
  transition:
    background var(--transition-normal),
    opacity var(--transition-normal);
}
.fab-button:hover {
  background: var(--pico-primary-background);
  opacity: 0.9;
}

/* Dialogs */

dialog article {
  max-width: 90vw;
}
dialog kbd {
  font-size: var(--text-xs);
  margin-right: var(--space-sm);
  margin-bottom: var(--space-sm);
}
dialog pre {
  white-space: pre-wrap;
  word-break: break-all;
}
dialog article {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--space-md);
}
dialog article section {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 70vh;
}
dialog article header {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

/* Animations */

.fade-in-slow {
  animation: fadeIn 2s;
}
.fade-in-fast {
  animation: fadeIn var(--transition-normal);
}
@keyframes fadeIn {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

.blink {
  transition: all var(--transition-normal);
  animation: blink normal 3s infinite ease-in-out;
}
@keyframes blink {
  0% {
    color: inherit;
  }
  50% {
    color: var(--pico-primary, #039be5);
  }
  100% {
    color: inherit;
  }
}

/* Loading */

:root[data-theme="dark"] .loading-indicator {
  --c: no-repeat linear-gradient(var(--pico-color, #bcc6ce) 0 0);
}

:root[data-theme="light"] .loading-indicator {
  --c: no-repeat linear-gradient(var(--pico-color, #1d2832) 0 0);
}

.loading-indicator {
  width: 15%;
  margin-left: auto;
  margin-right: auto;
  margin-top: 20%;
  margin-bottom: 20%;
  aspect-ratio: 1;
  background:
    var(--c) 0% 50%,
    var(--c) 50% 50%,
    var(--c) 100% 50%;
  background-size: 20% 100%;
  animation: l1 2s infinite linear;
}
@keyframes l1 {
  0% {
    background-size:
      20% 100%,
      20% 100%,
      20% 100%;
  }
  200% {
    background-size:
      20% 10%,
      20% 100%,
      20% 100%;
  }
  50% {
    background-size:
      20% 100%,
      20% 10%,
      20% 100%;
  }
  66% {
    background-size:
      20% 100%,
      20% 100%,
      20% 10%;
  }
  100% {
    background-size:
      20% 100%,
      20% 100%,
      20% 100%;
  }
}
</style>
