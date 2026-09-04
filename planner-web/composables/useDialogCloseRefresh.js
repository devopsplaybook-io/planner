import { useRoute } from "#imports";

/**
 * Refreshes page data when an app-level detail dialog closes.
 *
 * Detail dialogs are driven by URL query params (see app.vue): closing one
 * removes the param. That is the signal that the user is done editing and
 * the page data may be stale (another user may have changed things while
 * the dialog was open, and the dialog itself may have mutated the task).
 */
export function useDialogCloseRefresh(param, refresh) {
  const route = useRoute();
  watch(
    () => route.query[param],
    (newValue, oldValue) => {
      if (oldValue && !newValue) {
        refresh();
      }
    },
  );
}
