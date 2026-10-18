<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" class="brand-link"
          ><img src="/images/logo.svg" alt="Planner" class="nav-logo" />
          <strong class="brand-name">Planner</strong></NuxtLink
        >
      </li>
      <li v-if="authStore.isAuthenticated" class="palette-entry">
        <button
          class="palette-button"
          aria-label="Open command palette"
          title="Search (Ctrl+K)"
          @click="commandPaletteStore.openPalette()"
        >
          <i class="bi bi-search"></i>
          <span class="nav-label">Search</span>
          <kbd class="palette-hint">{{ paletteHint }}</kbd>
        </button>
      </li>
      <li v-if="dictationAvailable" class="dictation-entry">
        <button
          class="dictation-button"
          :disabled="dictationDisabled"
          :title="dictationTooltip"
          aria-label="Start dictation"
          @click="dictationStore.openDialog()"
        >
          <i class="bi bi-mic"></i>
          <span class="nav-label">Dictation</span>
        </button>
      </li>
    </ul>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" :class="activeRoute == '/' ? 'active' : 'inactive'"
          ><i class="bi bi-speedometer2"></i>
          <span class="nav-label">Dashboard</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/tasks"
          :class="activeRoute == '/tasks' ? 'active' : 'inactive'"
          ><i class="bi bi-check2-square"></i>
          <span class="nav-label">Tasks</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/calendar"
          :class="activeRoute == '/calendar' ? 'active' : 'inactive'"
          ><i class="bi bi-calendar"></i>
          <span class="nav-label">Calendar</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/notes"
          :class="activeRoute == '/notes' ? 'active' : 'inactive'"
          ><i class="bi bi-journal-text"></i>
          <span class="nav-label">Notes</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/update-feed"
          :class="activeRoute == '/update-feed' ? 'active' : 'inactive'"
          ><i class="bi bi-activity"></i>
          <span class="nav-label">Update Feed</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/settings"
          :class="activeRoute == '/settings' ? 'active' : 'inactive'"
          ><i class="bi bi-gear"></i>
          <span class="nav-label">Settings</span></NuxtLink
        >
      </li>
    </ul>
  </nav>
</template>

<script setup>
const authStore = useAuthStore();
const recommendationStore = useRecommendationStore();
const dictationStore = useDictationStore();
const commandPaletteStore = useCommandPaletteStore();
const route = useRoute();

const paletteHint = computed(() => {
  const isApple = /Mac|iPhone|iPad/.test(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  return isApple ? "⌘K" : "Ctrl K";
});

const activeRoute = computed(() => {
  const segments = route.fullPath.split("?")[0].split("/");
  return segments.length > 1 ? `/${segments[1]}` : "/";
});

// App-wide feature flags: the config is only fetched on the dashboard and in
// the task dialog otherwise, but the dictation button is global
onMounted(() => {
  if (authStore.isAuthenticated) {
    recommendationStore.fetchConfig();
  }
});

const online = ref(typeof navigator === "undefined" || navigator.onLine);
function updateOnlineStatus() {
  online.value = navigator.onLine;
}
onMounted(() => {
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
});
onUnmounted(() => {
  window.removeEventListener("online", updateOnlineStatus);
  window.removeEventListener("offline", updateOnlineStatus);
});

const dictationAvailable = computed(
  () => authStore.isAuthenticated && recommendationStore.isDictationEnabled,
);
const dictationDisabled = computed(
  () => !recommendationStore.isDictationSttConfigured || !online.value,
);
const dictationTooltip = computed(() => {
  if (!online.value) {
    return "Dictation is unavailable offline";
  }
  if (!recommendationStore.isDictationSttConfigured) {
    return "Dictation needs a speech-to-text server configuration";
  }
  return "Start dictation";
});
</script>

<style scoped>
.menu-links {
  gap: var(--space-sm);
  font-weight: var(--weight-bold);
}

.menu-links li {
  padding-top: var(--space-2xs);
  padding-bottom: var(--space-2xs);
  font-size: var(--text-md);
}
.menu-links .inactive {
  opacity: 0.5;
}
.menu-links .active {
  color: var(--color-primary);
}
.menu-links {
  font-weight: var(--weight-bold);
}

.menu-links a {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-logo {
  height: 1.4em;
  vertical-align: middle;
  margin-right: 0.5rem;
}

.menu-links i {
  margin-right: var(--space-2xs);
  flex-shrink: 0;
}

.dictation-entry .dictation-button {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--weight-bold);
  font-size: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.dictation-entry .dictation-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.palette-entry .palette-button {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  font-weight: var(--weight-bold);
  font-size: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.palette-hint {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  padding: 0.05em 0.4em;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
}

/* Hide brand name on mobile and intermediate screens */
@media (max-width: 999px) {
  .brand-name {
    display: none;
  }
}

/* Hide nav labels on narrow screens */
@media (max-width: 767px) {
  .nav-label {
    display: none;
  }

  .palette-hint {
    display: none;
  }

  .menu-links li {
    font-size: calc(var(--text-md) * 1.5);
  }

  /* Touch targets for the nav buttons, matching the padded nav links */
  .dictation-entry .dictation-button,
  .palette-entry .palette-button {
    padding: var(--space-sm) var(--space-xs);
  }
}

:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: var(--color-primary);
}
</style>
