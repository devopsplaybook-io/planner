export default defineNuxtPlugin(() => {
  const authStore = useAuthStore();
  const notificationsStore = useNotificationsStore();

  // Sync the push subscription whenever the user is (or becomes) authenticated
  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (isAuthenticated) {
        notificationsStore.init();
      }
    },
    { immediate: true },
  );
});
