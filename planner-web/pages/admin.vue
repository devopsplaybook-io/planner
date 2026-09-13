<template>
  <div class="admin-page">
    <hgroup>
      <h1>Admin</h1>
      <p>Administration</p>
    </hgroup>

    <div v-if="!authStore.isAdmin" class="access-denied">
      <i class="bi bi-shield-lock" />
      <p>Access denied. Admin privileges required.</p>
    </div>

    <template v-else>
      <div class="admin-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="admin-tab"
          :class="{ active: activeTab === tab.id }"
          role="tab"
          :aria-selected="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <AdminUsersTab v-if="activeTab === 'users'" />
      <AdminProjectsTab v-else-if="activeTab === 'projects'" />
      <AdminStatusesTab v-else-if="activeTab === 'statuses'" />
    </template>
  </div>
</template>

<script setup>
const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const tabs = [
  { id: "users", label: "Users" },
  { id: "projects", label: "Projects" },
  { id: "statuses", label: "Statuses" },
];
const tabIds = tabs.map((t) => t.id);
const activeTab = ref(
  tabIds.includes(route.query.tab) ? route.query.tab : "users",
);

// Keep the selected tab in the URL so a refresh or returning to the page
// via browser navigation restores it
watch(activeTab, (tab) => {
  router.replace({ path: route.path, query: { ...route.query, tab } });
});

// Follow URL changes to ?tab= (browser back/forward, shared links)
watch(
  () => route.query.tab,
  (tab) => {
    if (tabIds.includes(tab) && tab !== activeTab.value) {
      activeTab.value = tab;
    }
  },
);
</script>

<style scoped>
.admin-tabs {
  display: flex;
  gap: var(--space-2xs);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--space-lg);
}

.admin-tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: var(--space-xs) var(--space-md);
  color: var(--color-text-muted);
  font-weight: var(--weight-medium);
  margin-bottom: -1px;
}

.admin-tab:hover {
  color: var(--color-primary);
}

.admin-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.access-denied {
  text-align: center;
  padding: 3em;
  color: var(--color-text-muted);
}

.access-denied i {
  font-size: var(--text-icon);
  margin-bottom: var(--space-sm);
}
</style>
