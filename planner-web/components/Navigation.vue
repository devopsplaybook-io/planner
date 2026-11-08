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
          :aria-label="dictationAriaLabel"
          @click="openDictationMenu()"
        >
          <span class="dictation-icon">
            <i class="bi bi-mic"></i>
            <span
              v-if="badgeCount || processingCount"
              class="nav-badge"
              :class="{
                'nav-badge--processing': !badgeCount && processingCount,
              }"
              >{{ badgeCount > 9 ? "9+" : badgeCount || processingCount }}</span
            >
          </span>
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
const inboxStore = useInboxStore();
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
    dictationStore.fetchPreferences().catch(() => undefined);
    inboxStore.fetchBadge().catch(() => undefined);
  }
});

// Unread/processing badge: refreshed periodically and when the tab returns
useRegularRefresh(() => {
  if (authStore.isAuthenticated) {
    return inboxStore.fetchBadge();
  }
}, 60 * 1000);

const badgeCount = computed(() => inboxStore.badge.unread);
const processingCount = computed(() => inboxStore.badge.processing);

const dictationAriaLabel = computed(() => {
  if (badgeCount.value) {
    return `Open the dictation menu (${badgeCount.value} unread)`;
  }
  if (processingCount.value) {
    return `Open the dictation menu (${processingCount.value} processing)`;
  }
  return "Open the dictation menu";
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
const dictationDisabled = computed(() => !online.value);
const dictationTooltip = computed(() => {
  if (!online.value) {
    return "Dictation is unavailable offline";
  }
  if (
    !recommendationStore.isDictationSttConfigured &&
    !recommendationStore.dictationImportEnabled
  ) {
    return "Open the voice inbox";
  }
  if (!recommendationStore.isDictationSttConfigured) {
    return "Inbox and meeting import";
  }
  if (recommendationStore.dictationEngineState === "preparing") {
    return "Preparing speech engine…";
  }
  return "Dictation, capture, inbox and meeting import";
});

function openDictationMenu() {
  if (recommendationStore.isDictationSttConfigured) {
    dictationStore.openDialog("dictate");
  } else if (recommendationStore.dictationImportEnabled) {
    dictationStore.openDialog("import");
  } else {
    dictationStore.openDialog("inbox");
  }
}
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
  font-weight: var(--weight-bold);
  font-size: inherit;
  color: inherit;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.dictation-entry .nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The unread/processing count is pinned to the mic icon: inline it looked
   like an extra button next to the icon once the label is hidden on mobile */
.dictation-icon {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.dictation-icon i {
  margin-right: 0;
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

.nav-badge {
  position: absolute;
  top: -0.4em;
  right: -0.4em;
  min-width: 1.35em;
  padding: 0 0.3em;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-primary, #fff);
  font-size: 0.6em;
  font-weight: var(--weight-bold);
  text-align: center;
  line-height: 1.35;
  pointer-events: none;
}

.nav-badge--processing {
  background: var(--color-text-muted);
  animation: nav-badge-pulse 1.4s infinite ease-in-out;
}

@keyframes nav-badge-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
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
