<template>
  <nav :class="{ collapsed: isCollapsed }">
    <button
      class="menu-toggle"
      aria-label="Toggle menu"
      @click="isCollapsed = !isCollapsed"
    >
      <i :class="isCollapsed ? 'bi bi-list' : 'bi bi-x'" />
    </button>
    <div class="menu-items" :class="{ show: !isCollapsed }">
      <NuxtLink to="/" class="menu-item" @click="closeOnMobile">
        <i class="bi bi-speedometer2" />
        <span>Dashboard</span>
      </NuxtLink>
      <NuxtLink to="/projects" class="menu-item" @click="closeOnMobile">
        <i class="bi bi-folder" />
        <span>Projects</span>
      </NuxtLink>
      <NuxtLink to="/tasks" class="menu-item" @click="closeOnMobile">
        <i class="bi bi-check2-square" />
        <span>Tasks</span>
      </NuxtLink>
      <NuxtLink to="/notes" class="menu-item" @click="closeOnMobile">
        <i class="bi bi-journal-text" />
        <span>Notes</span>
      </NuxtLink>
      <NuxtLink to="/calendar" class="menu-item" @click="closeOnMobile">
        <i class="bi bi-calendar" />
        <span>Calendar</span>
      </NuxtLink>
      <hr class="menu-divider" />
      <NuxtLink
        v-if="authStore.isAdmin"
        to="/admin"
        class="menu-item"
        @click="closeOnMobile"
      >
        <i class="bi bi-gear" />
        <span>Admin</span>
      </NuxtLink>
      <button
        v-if="authStore.isAuthenticated"
        class="menu-item logout-btn"
        @click="handleLogout"
      >
        <i class="bi bi-box-arrow-right" />
        <span>Logout</span>
      </button>
      <button
        class="menu-item theme-btn"
        :title="
          getThemeIcon().includes('moon')
            ? 'Switch to light mode'
            : 'Switch to dark mode'
        "
        @click="toggleTheme()"
      >
        <i :class="getThemeIcon()" />
      </button>
    </div>
  </nav>
</template>

<script setup>
const authStore = useAuthStore();
const route = useRoute();
const isCollapsed = ref(true);
const toggleTheme = inject("toggleTheme");
const theme = inject("theme");

function getThemeIcon() {
  const current = theme?.value;
  if (current === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "bi bi-moon"
      : "bi bi-sun";
  }
  return current === "dark" ? "bi bi-moon" : "bi bi-sun";
}

function closeOnMobile() {
  if (window.innerWidth < 768) {
    isCollapsed.value = true;
  }
}

function handleLogout() {
  authStore.logout();
  navigateTo("/login");
  isCollapsed.value = true;
}

// Auto-close on route change on mobile
watch(route, () => {
  if (window.innerWidth < 768) {
    isCollapsed.value = true;
  }
});
</script>

<style scoped>
nav {
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.menu-toggle {
  background: none;
  border: none;
  font-size: 1.5em;
  cursor: pointer;
  padding: 0.2em 0.5em;
  color: var(--pico-primary);
}

.menu-items {
  display: flex;
  align-items: center;
  gap: 0.3em;
  flex-wrap: wrap;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.3em 0.6em;
  text-decoration: none;
  font-size: 0.9em;
  border-radius: 0.3em;
  color: var(--pico-color);
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.menu-item:hover {
  background: var(--pico-primary-hover-background);
  color: var(--pico-primary-inverse);
}

.menu-item.router-link-active {
  background: var(--pico-primary-background);
  color: var(--pico-primary-inverse);
}

.menu-item i {
  font-size: 1.1em;
}

.menu-divider {
  flex: 0 0 1px;
  height: 1.5em;
  background: var(--pico-muted-border-color);
  border: none;
  margin: 0 0.3em;
}

.logout-btn {
  margin-left: auto;
}

/* Mobile: collapse into hamburger */
@media (max-width: 767px) {
  nav.collapsed .menu-items {
    display: none;
  }

  nav:not(.collapsed) .menu-items {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: 3em;
    left: 0;
    right: 0;
    background: var(--pico-background-color);
    border-bottom: 1px solid var(--pico-muted-border-color);
    padding: 0.5em;
    z-index: 1000;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  nav:not(.collapsed) .menu-item {
    width: 100%;
    padding: 0.6em 0.8em;
  }

  nav:not(.collapsed) .menu-divider {
    width: 100%;
    height: 1px;
    margin: 0.3em 0;
  }
}
</style>
