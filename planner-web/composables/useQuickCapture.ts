import { ref } from "vue";

// Global quick-capture state: the dialog is mounted once in app.vue and
// opened from the navigation, a keyboard shortcut or the inbox page.
const quickCaptureOpen = ref(false);

export function useQuickCapture() {
  function openQuickCapture(): void {
    quickCaptureOpen.value = true;
  }
  function closeQuickCapture(): void {
    quickCaptureOpen.value = false;
  }
  return { quickCaptureOpen, openQuickCapture, closeQuickCapture };
}