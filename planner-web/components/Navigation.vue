<template>
  <nav>
    <ul class="menu-links">
      <li>
        <NuxtLink to="/" class="brand-link"
          ><img src="/images/logo.svg" alt="Planner" class="nav-logo" />
          <strong class="brand-name">Planner</strong></NuxtLink
        >
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
          to="/projects"
          :class="activeRoute == '/projects' ? 'active' : 'inactive'"
          ><i class="bi bi-folder"></i>
          <span class="nav-label">Projects</span></NuxtLink
        >
      </li>
      <li v-if="authStore.isAdmin">
        <NuxtLink
          to="/admin"
          :class="activeRoute == '/admin' ? 'active' : 'inactive'"
          ><i class="bi bi-gear"></i>
          <span class="nav-label">Admin</span></NuxtLink
        >
      </li>
      <li>
        <NuxtLink
          to="/settings"
          :class="activeRoute == '/settings' ? 'active' : 'inactive'"
          ><i class="bi bi-three-dots"></i>
          <span class="nav-label">Settings</span></NuxtLink
        >
      </li>
    </ul>
  </nav>
</template>

<script setup>
const authStore = useAuthStore();
const route = useRoute();

const activeRoute = computed(() => {
  const segments = route.fullPath.split("?")[0].split("/");
  return segments.length > 1 ? `/${segments[1]}` : "/";
});
</script>

<style scoped>
.menu-links li {
  padding-top: var(--space-2xs);
  padding-bottom: var(--space-2xs);
}
.menu-links li {
  padding-right: var(--space-sm);
  font-size: var(--text-md);
}
.menu-links .inactive {
  opacity: 0.5;
}
.menu-links .active {
  color: var(--pico-primary);
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

  .menu-links li {
    padding-right: var(--space-2xs);
  }
}

:root[data-theme="light"] .menu-links .inactive {
  opacity: 0.8;
}
:root[data-theme="light"] .menu-links .active {
  color: var(--pico-primary);
}
</style>
