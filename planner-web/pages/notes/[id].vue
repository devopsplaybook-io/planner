<script setup>
/**
 * This page is now a redirect to the notes list with the note detail dialog open.
 * The note detail is displayed in the app-level NoteDetailDialog via ?noteId= query param.
 * This ensures deep links and bookmarks to /notes/:id still work.
 */
const route = useRoute();
const router = useRouter();

onMounted(() => {
  router.replace({
    path: "/notes",
    query: { noteId: route.params.id },
  });
});
</script>
