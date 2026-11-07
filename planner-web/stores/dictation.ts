import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";
import { fileExtensionForMimeType } from "../utils/dictationMime";

export type DictationStage = "transcribing" | "polishing" | "actions";
export type DictationStatus = "processing" | "done" | "error";
export type DictationEngineState = "idle" | "downloading" | "ready" | "error";

export interface DictationActionProposal {
  type: "create_task" | "create_note";
  title: string;
  description: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
}

export interface DictationResult {
  rawTranscript: string;
  // Progressive delivery: null until polish completes
  polishedText: string | null;
  polished: boolean;
  actions: DictationActionProposal[];
  actionsAvailable: boolean;
}

export interface DictationAvailability {
  rawTranscript: boolean;
  polishedText: boolean;
  actions: boolean;
}

export interface DictationTimings {
  queueMs: number | null;
  sttMs: number | null;
  polishMs: number | null;
  actionsMs: number | null;
  totalMs: number | null;
  audioDurationMs: number | null;
}

export interface DictationJobView {
  jobId: string;
  source: string;
  status: DictationStatus;
  stage: DictationStage | null;
  engine: string;
  language: string | null;
  revision: number;
  result: DictationResult | null;
  availability: DictationAvailability | null;
  timings: DictationTimings | null;
  engineState: DictationEngineState | null;
  error: string | null;
  dateCreated: string;
  dateUpdated: string;
}

const LANGUAGE_STORAGE_KEY = "dictation-language";
const LONG_POLL_TIMEOUT_MS = 30 * 1000;

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
    source: null as string | null,
    status: null as DictationStatus | null,
    stage: null as DictationStage | null,
    result: null as DictationResult | null,
    availability: null as DictationAvailability | null,
    timings: null as DictationTimings | null,
    engineState: null as DictationEngineState | null,
    revision: 0,
    error: null as string | null,
    dateUpdated: null as string | null,
    language: loadStoredLanguage(),
    recentJobs: [] as DictationJobView[],
  }),

  getters: {
    isProcessing: (state) =>
      !!state.jobId && state.status === "processing" && !state.error,
    hasRawTranscript: (state) => !!state.availability?.rawTranscript,
    hasPolishedText: (state) => !!state.availability?.polishedText,
    hasActions: (state) => !!state.availability?.actions,
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
    /** Clears every field of the current job, keeping recent jobs. */
    resetJob() {
      this.jobId = null;
      this.source = null;
      this.status = null;
      this.stage = null;
      this.result = null;
      this.availability = null;
      this.timings = null;
      this.engineState = null;
      this.revision = 0;
      this.error = null;
      this.dateUpdated = null;
    },
    reset() {
      this.resetJob();
      this.recentJobs = [];
    },
    /**
     * Applies a job view (short poll, long poll, result re-open). Centralized
     * so progressive fields are handled identically everywhere.
     */
    applyJob(job: DictationJobView) {
      this.jobId = job.jobId;
      this.source = job.source ?? null;
      this.status = job.status;
      this.stage = job.stage ?? null;
      this.result = job.result ?? null;
      this.availability = job.availability ?? null;
      this.timings = job.timings ?? null;
      this.engineState = job.engineState ?? null;
      this.revision = job.revision ?? 0;
      this.error = job.error ?? null;
      this.dateUpdated = job.dateUpdated ?? null;
    },
    /**
     * Adopts a job already running server-side (e.g. after a 409 from a
     * duplicate upload or when the dialog is reopened mid-processing).
     */
    resumeFrom(jobId: string) {
      this.resetJob();
      this.jobId = jobId;
      this.status = "processing";
    },
    async submitAudio(
      blob: Blob,
      mimeType: string,
      language?: string,
    ): Promise<void> {
      this.resetJob();
      const form = new FormData();
      form.append(
        "file",
        new File([blob], `dictation${fileExtensionForMimeType(mimeType)}`, {
          type: mimeType,
        }),
      );
      form.append("language", language || this.language);
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
    /**
     * Fetches the job once, or long-polls it: with `wait` the request returns
     * as soon as a newer revision is persisted (server-bounded to 25 s).
     * Returns true when the job state was refreshed, false on a transient
     * failure so the caller can fall back to short polling.
     */
    async poll(wait = false): Promise<boolean> {
      if (!this.jobId) {
        return false;
      }
      try {
        const res = await api.get(`/dictation/${this.jobId}`, {
          params: wait ? { wait: 1, since: this.revision } : undefined,
          timeout: wait ? LONG_POLL_TIMEOUT_MS : undefined,
        });
        this.applyJob(res.data);
        return true;
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 404) {
          // The job expired server-side: stop polling
          this.error = "The dictation job expired. Please record again.";
          this.status = "error";
          return false;
        }
        // Other errors are transient: keep polling
        return false;
      }
    },
    async fetchRecentJobs(limit = 20): Promise<void> {
      try {
        const res = await api.get("/dictation/jobs", {
          params: { limit, source: "dictation" },
        });
        this.recentJobs = res.data?.jobs || [];
      } catch {
        // The recent list is an enhancement: keep the previous one
      }
    },
    /** Opens a persisted job (recent list) and loads its current state. */
    async openJob(jobId: string): Promise<void> {
      this.resumeFrom(jobId);
      await this.poll(false);
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDictationStore, import.meta.hot));
}
