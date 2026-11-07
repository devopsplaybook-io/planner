import { ref } from "vue";

// Global long-form import state: the dialog is mounted once in app.vue and
// opened from the navigation or the inbox page.
const meetingImportOpen = ref(false);

export function useMeetingImport() {
  function openMeetingImport(): void {
    meetingImportOpen.value = true;
  }
  function closeMeetingImport(): void {
    meetingImportOpen.value = false;
  }
  return { meetingImportOpen, openMeetingImport, closeMeetingImport };
}