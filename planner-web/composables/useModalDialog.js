/**
 * Bridges a reactive open state with the native <dialog> modal API
 * (showModal/close) so dialogs render a ::backdrop, trap focus, close
 * on Escape and stack correctly above each other.
 *
 * Usage:
 *   const dialogEl = useModalDialog(() => props.open);
 *   <dialog ref="dialogEl" @close="handleClose">
 *
 * The component must handle the native @close event (fires on Escape,
 * backdrop click and programmatic close) to propagate the close to its
 * own state or parent.
 */
export function useModalDialog(isOpen) {
  const dialogEl = ref(null);

  function sync() {
    const dlg = dialogEl.value;
    if (!dlg) return;
    const open = typeof isOpen === "function" ? isOpen() : isOpen.value;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }

  // A click landing on the dialog box itself (i.e. the backdrop, outside
  // the article) closes the dialog via the native close event.
  function onBackdropClick(e) {
    if (e.target === dialogEl.value) {
      dialogEl.value.close();
    }
  }

  watch(isOpen, sync, { flush: "post" });

  onMounted(() => {
    sync();
    dialogEl.value?.addEventListener("click", onBackdropClick);
  });

  onUnmounted(() => {
    dialogEl.value?.removeEventListener("click", onBackdropClick);
  });

  return dialogEl;
}
