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
const router = useRouter();
const toggleTheme = inject("toggleTheme");
const theme = inject("theme");

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
  font-size: 1.3em;
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
  font-size: 1em;
  margin-bottom: var(--space-sm);
  color: var(--pico-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  font-weight: 500;
}

.theme-controls {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.theme-name {
  font-size: 0.9em;
  opacity: 0.7;
  min-width: 3em;
}

.btn-theme {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.4em 0.8em;
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 4px);
  background: transparent;
  color: var(--pico-color);
  cursor: pointer;
  font-size: 0.9em;
  font-family: inherit;
}

.btn-theme:hover {
  background: var(--pico-primary-background, #1095c1);
  color: var(--pico-primary-inverse, #fff);
}

.user-info {
  margin-bottom: var(--space-sm);
  font-size: 0.95em;
}

.btn-logout {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.4em 0.8em;
  border: 1px solid var(--pico-muted-border-color, #444);
  border-radius: var(--pico-border-radius, 4px);
  background: transparent;
  color: var(--pico-color);
  cursor: pointer;
  font-size: 0.9em;
  font-family: inherit;
}

.btn-logout:hover {
  background: #d32f2f;
  color: #fff;
  border-color: #d32f2f;
}
</style>
