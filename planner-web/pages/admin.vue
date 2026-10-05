<script setup>
/**
 * This page is now a redirect to the Settings page, which hosts the admin
 * tabs (Profile, Users, Projects, Statuses) since profile and settings were
 * merged. The query is preserved so deep links like /admin?tab=projects
 * &projectId=... keep working. This ensures deep links and bookmarks to
 * /admin still work.
 */
const route = useRoute();
const router = useRouter();

onMounted(() => {
  router.replace({ path: "/settings", query: route.query });
});
</script>
