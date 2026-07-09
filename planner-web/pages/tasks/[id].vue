<script setup>
/**
 * This page is now a redirect to the task list with the task detail dialog open.
 * The task detail is displayed in the app-level TaskDetailDialog via ?taskId= query param.
 * This ensures deep links and bookmarks to /tasks/:id still work.
 */
const route = useRoute();
const router = useRouter();

onMounted(() => {
  router.replace({
    path: "/tasks",
    query: { taskId: route.params.id },
  });
});
</script>
