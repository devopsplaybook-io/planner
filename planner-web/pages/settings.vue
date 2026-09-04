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

    <section v-if="authStore.isAuthenticated">
      <h2>API Key</h2>
      <p class="api-key-info">
        Use an API key to authenticate API calls. The key has the same
        permissions as your user account.
      </p>
      <div v-if="apiKey" class="api-key-display">
        <label>
          Your API key
          <div class="api-key-input-row">
            <input
              :value="apiKey.key"
              type="text"
              readonly
              class="api-key-input"
            />
            <button class="btn-copy" @click="copyApiKey">
              <i class="bi bi-clipboard" /> Copy
            </button>
          </div>
        </label>
        <small class="api-key-date"
          >Created {{ formatDate(apiKey.dateCreated) }}</small
        >
        <div class="api-key-actions">
          <button class="secondary" :aria-busy="regenerating" @click="regenerateApiKey">
            <i class="bi bi-arrow-clockwise" /> Regenerate
          </button>
          <button class="contrast" :aria-busy="deletingKey" @click="deleteApiKey">
            <i class="bi bi-trash" /> Delete
          </button>
        </div>
      </div>
      <div v-else class="api-key-generate">
        <p>No API key yet.</p>
        <button :aria-busy="generating" @click="generateApiKey">
          <i class="bi bi-key" /> Generate API Key
        </button>
      </div>
      <div v-if="newlyGeneratedKey" class="api-key-new">
        <label>
          <strong>New API key</strong> — copy it now, it won't be shown again:
          <div class="api-key-input-row">
            <input
              :value="newlyGeneratedKey"
              type="text"
              readonly
              class="api-key-input"
            />
            <button class="btn-copy" @click="copyNewKey">
              <i class="bi bi-clipboard" /> Copy
            </button>
          </div>
        </label>
      </div>
    </section>
  </div>
</template>

<script setup>
import api from "../utils/api";

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

// API Key management

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

// API Key management
const apiKey = ref(null);
const newlyGeneratedKey = ref("");
const generating = ref(false);
const regenerating = ref(false);
const deletingKey = ref(false);

onMounted(async () => {
  if (authStore.isAuthenticated) {
    notificationsStore.init();
    await fetchApiKey();
  }
});

async function fetchApiKey() {
  try {
    const res = await api.get("/users/api-key");
    apiKey.value = res.data;
  } catch {
    apiKey.value = null;
  }
}

async function generateApiKey() {
  generating.value = true;
  try {
    const res = await api.post("/users/api-key");
    newlyGeneratedKey.value = res.data.key;
    await fetchApiKey();
  } catch (e) {
    alert(e.response?.data?.error || "Failed to generate API key");
  } finally {
    generating.value = false;
  }
}

async function regenerateApiKey() {
  if (!confirm("Regenerating will invalidate the current key. Continue?")) return;
  regenerating.value = true;
  try {
    const res = await api.post("/users/api-key");
    newlyGeneratedKey.value = res.data.key;
    await fetchApiKey();
  } catch (e) {
    alert(e.response?.data?.error || "Failed to regenerate API key");
  } finally {
    regenerating.value = false;
  }
}

async function deleteApiKey() {
  if (!confirm("Delete your API key? This cannot be undone.")) return;
  deletingKey.value = true;
  try {
    await api.delete("/users/api-key");
    apiKey.value = null;
    newlyGeneratedKey.value = "";
  } catch (e) {
    alert(e.response?.data?.error || "Failed to delete API key");
  } finally {
    deletingKey.value = false;
  }
}

function copyApiKey() {
  navigator.clipboard.writeText(apiKey.value.key);
}

function copyNewKey() {
  navigator.clipboard.writeText(newlyGeneratedKey.value);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString();
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
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

section h2 {
  font-size: var(--text-default);
  margin-bottom: var(--space-sm);
  color: var(--color-text-muted);
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
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--text-md);
  font-family: inherit;
}

.btn-theme:hover {
  background: var(--color-primary);
  color: var(--color-on-primary);
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
  color: var(--color-danger);
  opacity: 1;
}

.btn-logout {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0.4em 0.8em;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--text-md);
  font-family: inherit;
}

.btn-logout:hover {
  background: #d32f2f;
  color: #fff;
  border-color: #d32f2f;
}

.api-key-info {
  font-size: var(--text-md);
  color: var(--color-text-secondary);
  margin-bottom: var(--space-sm);
}

.api-key-display,
.api-key-generate,
.api-key-new {
  margin-top: var(--space-sm);
}

.api-key-input-row {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
}

.api-key-input {
  flex: 1;
  font-family: monospace;
  font-size: var(--text-sm);
  background: var(--color-bg-secondary);
}

.btn-copy {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: 0.4em 0.8em;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: var(--text-md);
  font-family: inherit;
  white-space: nowrap;
}

.btn-copy:hover {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.api-key-date {
  display: block;
  margin-top: var(--space-xs);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.api-key-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.api-key-new {
  margin-top: var(--space-md);
  padding: var(--space-sm);
  background: var(--color-primary-light);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
}

.api-key-new label strong {
  color: var(--color-primary-dark);
}
</style>
