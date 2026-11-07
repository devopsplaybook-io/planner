<template>
  <div />
</template>

<script setup>
const dictationStore = useDictationStore();
const offlineQueue = useOfflineDictationQueue();
const { pushToast } = useToasts();
const route = useRoute();
const router = useRouter();

/**
 * The inbox now lives in the dictation menu as a tab. This page only keeps the
 * existing deep links working (push notifications, the PWA audio share target)
 * by opening the menu on the right tab, then returning to the app.
 */
onMounted(async () => {
  // A shared audio file lands here from the service worker (already queued in
  // IndexedDB) or from the server fallback (no share support in this browser).
  const shared = route.query.shared;
  if (shared === "1") {
    pushToast({
      kind: "success",
      title: "Shared audio queued",
      message: "It will appear in the inbox as soon as it is uploaded.",
    });
    await offlineQueue.flush();
  } else if (shared === "unsupported") {
    pushToast({
      kind: "info",
      title: "Sharing audio to Planner is not supported here",
      message: "Use the Import tab to upload a recording instead.",
    });
  }

  // A notification deep link opens the finished job in the review view.
  const jobId = typeof route.query.jobId === "string" ? route.query.jobId : "";
  if (jobId) {
    dictationStore.openDialog("dictate");
    await dictationStore.openJob(jobId);
  } else {
    dictationStore.openDialog("inbox");
  }

  await router.replace({ path: "/" });
});
</script>
