<template>
  <div class="settings">
    <h1><i class="bi bi-gear" /> Settings</h1>

    <section>
      <h2>Appearance</h2>
      <div class="setting-row">
        <span class="setting-label"><i class="bi bi-palette" /> Theme</span>
        <div class="theme-controls">
          <span class="theme-name">{{ themeLabel }}</span>
          <button class="btn-theme" @click="toggleTheme()">
            <i :class="getThemeIcon()" />
            {{
              themeLabel === "System"
                ? "Follow system"
                : themeLabel === "Dark"
                  ? "Switch to light"
                  : "Switch to dark"
            }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="authStore.isAuthenticated && notificationsStore.supported">
      <h2>Notifications</h2>
      <div class="setting-row">
        <span class="setting-label"
          ><i class="bi bi-bell" /> Task reminders</span
        >
        <button
          class="btn-theme"
          :disabled="
            notificationsStore.loading || !notificationsStore.serverEnabled
          "
          @click="toggleNotifications"
        >
          <i
            :class="
              notificationsStore.active ? 'bi bi-bell-slash' : 'bi bi-bell'
            "
          />
          {{ notificationsStore.active ? "Disable" : "Enable" }}
        </button>
      </div>
      <p
        class="notification-status"
        :class="{ 'notification-status--error': notificationsStore.lastError }"
      >
        {{ notificationStatus }}
      </p>
    </section>

    <section v-if="authStore.isAuthenticated">
      <h2>Account</h2>
      <p class="user-info" v-if="authStore.currentUser">
        Signed in as <strong>{{ authStore.currentUser.name }}</strong>
      </p>
      <button class="btn-logout" @click="handleLogout">
        <i class="bi bi-box-arrow-right" /> Logout
      </button>
    </section>
  </div>
</template>

<script setup>
const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const router = useRouter();
const toggleTheme = inject("toggleTheme");
const theme = inject("theme");

const notificationStatus = computed(() => {
  if (!notificationsStore.serverEnabled) {
    return "Notifications are not available on this server.";
  }
  if (notificationsStore.permission === "denied") {
    return "Notifications are blocked by the browser. Allow them in the browser's site settings.";
  }
  if (notificationsStore.lastError) {
    return `Notifications could not be enabled: ${notificationsStore.lastError}`;
  }
  if (notificationsStore.active) {
    return "You will be notified the day before and on the day a task is due.";
  }
  return "Get notified the day before and on the day a task is due.";
});

onMounted(() => {
  if (authStore.isAuthenticated) {
    notificationsStore.init();
  }
});

async function toggleNotifications() {
  if (notificationsStore.active) {
    await notificationsStore.disable();
  } else {
    await notificationsStore.enable();
  }
}

const themeLabel = computed(() => {
  if (!theme?.value) return "System";
  return theme.value.charAt(0).toUpperCase() + theme.value.slice(1);
});

function getThemeIcon() {
  const current = theme?.value;
  if (current === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "bi bi-moon"
      : "bi bi-sun";
  }
  return current === "dark" ? "bi bi-moon" : "bi bi-sun";
}

function handleLogout() {
  authStore.logout();
  router.push("/login");
}
</script>

<style scoped>
.settings {
  max-width: 600px;
  margin: 0 auto;
}

.settings h1 {
  font-size: var(--text-xl);
  margin-bottom: var(--space-lg);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

section {
  margin-bottom: var(--space-lg);
  padding: var(--space-md);
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 8px);
  background: var(--pico-card-background-color, rgba(255, 255, 255, 0.02));
}

section h2 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
  color: var(--pico-muted-color);
  text-transform: uppercase;
  letter-spacing: var(--tracking-widest);
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
}

.setting-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: var(--weight-medium);
}

.theme-controls {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.theme-name {
  font-size: var(--text-md);
  opacity: 0.7;
  min-width: 3em;
}

.btn-theme {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0.4em 0.8em;
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 4px);
  background: transparent;
  color: var(--pico-color);
  cursor: pointer;
  font-size: var(--text-md);
  font-family: inherit;
}

.btn-theme:hover {
  background: var(--pico-primary-background, #1095c1);
  color: var(--pico-primary-inverse, #fff);
}

.user-info {
  margin-bottom: var(--space-sm);
  font-size: var(--text-md);
}

.notification-status {
  margin-top: var(--space-sm);
  margin-bottom: 0;
  font-size: var(--text-sm);
  opacity: 0.7;
}

.notification-status--error {
  color: var(--pico-del-color, #dc3545);
  opacity: 1;
}

.btn-logout {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0.4em 0.8em;
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 4px);
  background: transparent;
  color: var(--pico-color);
  cursor: pointer;
  font-size: var(--text-md);
  font-family: inherit;
}

.btn-logout:hover {
  background: #d32f2f;
  color: #fff;
  border-color: #d32f2f;
}
</style>
