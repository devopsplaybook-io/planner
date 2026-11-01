export default defineNuxtRouteMiddleware(async (to) => {
  const authStore = useAuthStore();
  if (!authStore.initialized) {
    await authStore.init();
  }
  if (!authStore.isAuthenticated) {
    if (authStore.token) {
      authStore.logout();
    }
    return to.path === "/login" ? undefined : navigateTo("/login");
  }
  if (to.path === "/login") {
    return navigateTo("/");
  }
});
