import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";
import { fileExtensionForMimeType } from "../utils/dictationMime";

export type DictationStage = "transcribing" | "polishing" | "actions";
export type DictationStatus = "processing" | "done" | "error";

export interface DictationActionProposal {
  type: "create_task" | "create_note";
  title: string;
  description: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
}

export interface DictationResult {
  rawTranscript: string;
  polishedText: string;
  polished: boolean;
  actions: DictationActionProposal[];
  actionsAvailable: boolean;
}

const LANGUAGE_STORAGE_KEY = "dictation-language";

function loadStoredLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) || "auto";
  } catch {
    return "auto";
  }
}

export const useDictationStore = defineStore("dictation", {
  state: () => ({
    dialogOpen: false,
    jobId: null as string | null,
    status: null as DictationStatus | null,
    stage: null as DictationStage | null,
    result: null as DictationResult | null,
    error: null as string | null,
    language: loadStoredLanguage(),
  }),

  getters: {
    isProcessing: (state) =>
      !!state.jobId && state.status === "processing" && !state.error,
  },

  actions: {
    openDialog() {
      this.dialogOpen = true;
    },
    closeDialog() {
      this.dialogOpen = false;
    },
    setLanguage(language: string) {
      this.language = language;
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        // Storage unavailable: keep the language for this session only
      }
    },
    reset() {
      this.jobId = null;
      this.status = null;
      this.stage = null;
      this.result = null;
      this.error = null;
    },
    /**
     * Adopts a job already running server-side (e.g. after a 409 from a
     * duplicate upload or when the dialog is reopened mid-processing).
     */
    resumeFrom(jobId: string) {
      this.jobId = jobId;
      this.status = "processing";
      this.stage = null;
      this.result = null;
      this.error = null;
    },
    async submitAudio(blob: Blob, mimeType: string): Promise<void> {
      this.reset();
      const form = new FormData();
      form.append(
        "file",
        new File([blob], `dictation${fileExtensionForMimeType(mimeType)}`, {
          type: mimeType,
        }),
      );
      form.append("language", this.language);
      try {
        const res = await api.post("/dictation", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        this.jobId = res.data.jobId;
        this.status = "processing";
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        const conflictJobId = (
          err as { response?: { data?: { jobId?: string } } }
        )?.response?.data?.jobId;
        if (status === 409 && conflictJobId) {
          // A job is already running: keep polling it instead of failing
          this.resumeFrom(conflictJobId);
          return;
        }
        this.error =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error || "The dictation could not be uploaded.";
        this.status = "error";
      }
    },
    async poll(): Promise<void> {
      if (!this.jobId) {
        return;
      }
      try {
        const res = await api.get(`/dictation/${this.jobId}`);
        this.status = res.data.status;
        this.stage = res.data.stage;
        this.result = res.data.result;
        this.error = res.data.error;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 404) {
          // The job expired server-side: stop polling
          this.error = "The dictation job expired. Please record again.";
          this.status = "error";
        }
        // Other errors are transient: keep polling
      }
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDictationStore, import.meta.hot));
}
