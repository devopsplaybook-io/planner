import { acceptHMRUpdate, defineStore } from "pinia";
import api from "../utils/api";
import { fileExtensionForMimeType } from "../utils/dictationMime";

export type DictationStage =
  | "queued"
  | "chunking"
  | "transcribing"
  | "polishing"
  | "actions"
  | "summarizing";
export type DictationStatus = "processing" | "done" | "error";
export type DictationEngineState = "idle" | "downloading" | "ready" | "error";

export type DictationActionType =
  | "create_task"
  | "create_note"
  | "update_task"
  | "append_to_task"
  | "append_to_note"
  | "add_comment"
  | "add_checklist_items"
  | "instantiate_template"
  | "create_multiple";

export interface DictationTaskChanges {
  title?: string;
  description?: string;
  status?: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string | null;
  project?: string;
  addLabels?: string[];
  removeLabels?: string[];
  addAssignees?: string[];
  removeAssignees?: string[];
}

// Schema v2 (a v1 server only sends create_task/create_note); every optional
// field is validated again server-side before anything is written.
export interface DictationActionProposal {
  type: DictationActionType;
  title?: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
  project?: string;
  status?: string;
  labels?: string[];
  assignees?: string[];
  target?: string;
  targetType?: "task" | "note";
  changes?: DictationTaskChanges;
  text?: string;
  items?: string[];
  template?: string;
  // create_multiple input envelope (flattened server-side)
  actions?: DictationActionProposal[];
}

export type DictationResolutionStatus =
  | "resolved"
  | "ambiguous"
  | "unresolved";

export interface DictationEntityCandidate {
  kind: "project" | "task" | "note" | "template" | "user";
  id: string;
  label: string;
  projectId?: string;
  projectName?: string;
}

export interface DictationTargetInfo {
  kind: "task" | "note" | "project" | "template";
  id: string;
  label: string;
  projectId: string | null;
  projectName: string | null;
}

export interface DictationFieldDiff {
  field: string;
  before: string | null;
  after: string | null;
}

export interface DictationActionPreview {
  index: number;
  type: DictationActionType;
  action: DictationActionProposal;
  status: DictationResolutionStatus;
  target: DictationTargetInfo | null;
  candidates: DictationEntityCandidate[];
  diff: DictationFieldDiff[];
  error?: string;
  resolvedProjectId?: string;
  resolvedStatus?: string;
  resolvedTargetId?: string;
  resolvedAssigneeIds?: string[];
  resolvedAddAssigneeIds?: string[];
  resolvedRemoveAssigneeIds?: string[];
}

export interface DictationActionSelection {
  index: number;
  projectId?: string;
  status?: string;
  targetId?: string;
  title?: string;
  description?: string;
}

export interface DictationActionApplyResult {
  index: number;
  type: string;
  status: "applied" | "failed" | "skipped";
  targetId?: string;
  error?: string;
}

export interface DictationApplyOutcome {
  requestId: string;
  alreadyApplied: boolean;
  results: DictationActionApplyResult[];
}

export interface DictationActionUndoResult {
  index: number;
  type: string;
  status: "undone" | "failed" | "skipped";
  error?: string;
}

export interface DictationUndoOutcome {
  requestId: string;
  results: DictationActionUndoResult[];
}

export interface DictationAppliedBatchAction {
  index: number;
  type: string;
  status: "applied" | "failed";
  targetId: string | null;
  targetType: string | null;
  undoneAt: string | null;
  error: string | null;
}

export interface DictationAppliedBatch {
  requestId: string;
  dateCreated: string;
  actions: DictationAppliedBatchAction[];
}

export interface DictationAskItem {
  kind: "task" | "note";
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  dueDate?: string | null;
  status?: string;
}

export interface DictationAskAnswer {
  intent: string;
  answer: string;
  items: DictationAskItem[];
  truncated: boolean;
  generatedBy: "deterministic" | "llm";
}

export interface DictationSegment {
  text: string;
  fromMs: number;
  toMs: number;
  confidence: number | null;
}

export interface DictationResult {
  rawTranscript: string;
  // Progressive delivery: null until polish completes
  polishedText: string | null;
  polished: boolean;
  actions: DictationActionProposal[];
  actionsAvailable: boolean;
  // Embedded engine only: null for external engines or older servers
  segments: DictationSegment[] | null;
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
  jobKind?: "short" | "meeting";
  status: DictationStatus;
  stage: DictationStage | null;
  engine: string;
  language: string | null;
  targetLanguage: string | null;
  revision: number;
  result: DictationResult | null;
  availability: DictationAvailability | null;
  timings: DictationTimings | null;
  engineState: DictationEngineState | null;
  error: string | null;
  // Long-form jobs (absent on older servers)
  transcriptSegments?: { fromMs: number; toMs: number; text: string }[] | null;
  summary?: string | null;
  decisions?: string[];
  segmentsDone?: number;
  segmentsTotal?: number;
  archivedAt?: string | null;
  audioRetained?: boolean;
  convertedAt?: string | null;
  convertedType?: string | null;
  convertedTargetId?: string | null;
  dateCreated: string;
  dateUpdated: string;
}

const LANGUAGE_STORAGE_KEY = "dictation-language";
const TARGET_LANGUAGE_STORAGE_KEY = "dictation-target-language";
const LONG_POLL_TIMEOUT_MS = 30 * 1000;

function loadStoredLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) || "auto";
  } catch {
    return "auto";
  }
}

function loadStoredTargetLanguage(): string {
  try {
    return localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function persistTargetLanguage(language: string): void {
  try {
    if (language) {
      localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, language);
    } else {
      localStorage.removeItem(TARGET_LANGUAGE_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: keep the preference for this session only
  }
}

export const useDictationStore = defineStore("dictation", {
  state: () => ({
    dialogOpen: false,
    // Tab selected when the consolidated dictation menu opens
    dialogTab: "dictate" as "dictate" | "capture" | "import" | "inbox",
    jobId: null as string | null,
    source: null as string | null,
    status: null as DictationStatus | null,
    stage: null as DictationStage | null,
    result: null as DictationResult | null,
    availability: null as DictationAvailability | null,
    timings: null as DictationTimings | null,
    engineState: null as DictationEngineState | null,
    engine: null as string | null,
    revision: 0,
    error: null as string | null,
    dateUpdated: null as string | null,
    language: loadStoredLanguage(),
    // Output language for the polish stage ("" = keep the spoken language)
    targetLanguage: loadStoredTargetLanguage(),
    // Keep imported/quick-capture audio on the server after transcription
    keepAudio: false,
    // Translation target of the job currently open in the dialog
    jobTargetLanguage: null as string | null,
    recentJobs: [] as DictationJobView[],
    // Structured actions (schema v2 servers only)
    previews: [] as DictationActionPreview[],
    previewLoading: false,
    previewError: "",
    applyResults: [] as DictationActionApplyResult[],
    lastRequestId: null as string | null,
    appliedBatches: [] as DictationAppliedBatch[],
    batchesLoading: false,
    // Read-only questions
    askAnswer: null as DictationAskAnswer | null,
    askLoading: false,
    askError: "",
  }),

  getters: {
    isProcessing: (state) =>
      !!state.jobId && state.status === "processing" && !state.error,
    hasRawTranscript: (state) => !!state.availability?.rawTranscript,
    hasPolishedText: (state) => !!state.availability?.polishedText,
    hasActions: (state) => !!state.availability?.actions,
    hasStructuredActions: (state) => state.previews.length > 0,
    latestBatch: (state) =>
      state.appliedBatches.length > 0
        ? state.appliedBatches[state.appliedBatches.length - 1]
        : null,
  },

  actions: {
    openDialog(tab: "dictate" | "capture" | "import" | "inbox" = "dictate") {
      this.dialogTab = tab;
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
    /**
     * Persists the optional translation target. The local value is applied
     * optimistically and rolled back when the server refuses it.
     */
    async setTargetLanguage(
      language: string | null,
    ): Promise<{ error?: string }> {
      const value = language || null;
      const previous = this.targetLanguage;
      this.targetLanguage = value || "";
      persistTargetLanguage(this.targetLanguage);
      try {
        const res = await api.put("/dictation/preferences", {
          targetLanguage: value,
        });
        const stored = res.data?.targetLanguage || "";
        this.targetLanguage = stored;
        persistTargetLanguage(stored);
        return {};
      } catch (err) {
        this.targetLanguage = previous;
        persistTargetLanguage(previous);
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error || "The preference could not be saved.",
        };
      }
    },
    /** Loads the stored preferences; failures keep the local fallbacks. */
    async fetchPreferences(): Promise<void> {
      try {
        const res = await api.get("/dictation/preferences");
        const value = res.data?.targetLanguage || "";
        this.targetLanguage = value;
        persistTargetLanguage(value);
        if (typeof res.data?.keepAudio === "boolean") {
          this.keepAudio = res.data.keepAudio;
        }
      } catch {
        // Keep the localStorage fallback when the request fails
      }
    },
    /** Stores the audio retention preference (server-side, all devices). */
    async setKeepAudio(keepAudio: boolean): Promise<{ error?: string }> {
      const previous = this.keepAudio;
      this.keepAudio = keepAudio;
      try {
        await api.put("/dictation/preferences", { keepAudio });
        return {};
      } catch (err) {
        this.keepAudio = previous;
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error || "The preference could not be saved.",
        };
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
      this.engine = null;
      this.revision = 0;
      this.error = null;
      this.dateUpdated = null;
      this.jobTargetLanguage = null;
      this.previews = [];
      this.previewLoading = false;
      this.previewError = "";
      this.applyResults = [];
      this.lastRequestId = null;
      this.appliedBatches = [];
      this.batchesLoading = false;
      this.askAnswer = null;
      this.askLoading = false;
      this.askError = "";
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
      this.engine = job.engine ?? null;
      this.jobTargetLanguage = job.targetLanguage ?? null;
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
    /**
     * Uploads a recording without touching the store state, so inline
     * dictation edits can submit into their own job without hijacking the
     * full dialog's view.
     */
    async uploadJob(
      blob: Blob,
      mimeType: string,
      language?: string,
      source: "dictation" | "inline" | "quick_capture" = "dictation",
      projectId?: string | null,
      targetLanguage?: string | null,
      options: { clientId?: string } = {},
    ): Promise<{
      jobId?: string;
      conflictJobId?: string;
      error?: string;
      offline?: boolean;
      status?: number;
    }> {
      const form = new FormData();
      form.append(
        "file",
        new File([blob], `dictation${fileExtensionForMimeType(mimeType)}`, {
          type: mimeType,
        }),
      );
      form.append("language", language || this.language);
      if (source === "inline" || source === "quick_capture") {
        form.append("source", source);
      }
      if (projectId) {
        form.append("projectId", projectId);
      }
      if (options.clientId) {
        // Idempotent retry: a queued upload never creates two jobs
        form.append("clientId", options.clientId);
      }
      // Always sent: an empty value explicitly disables the stored preference
      const target =
        targetLanguage === undefined
          ? (this.targetLanguage ?? "")
          : (targetLanguage ?? "");
      form.append("targetLanguage", target);
      try {
        const res = await api.post("/dictation", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return { jobId: res.data.jobId };
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        const conflictJobId = (
          err as { response?: { data?: { jobId?: string } } }
        )?.response?.data?.jobId;
        if (status === 409 && conflictJobId) {
          return { conflictJobId };
        }
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error || "The dictation could not be uploaded.",
          // No HTTP response means the network failed: the queue keeps it
          offline: !(err as { response?: unknown })?.response,
          status,
        };
      }
    },
    /**
     * Reads one job without touching the store state. `notFound` reports an
     * expired job; other failures are transient so the caller can retry.
     */
    async fetchJob(
      jobId: string,
      options: { wait?: boolean; since?: number } = {},
    ): Promise<{ job?: DictationJobView; notFound?: boolean }> {
      try {
        const res = await api.get(`/dictation/${jobId}`, {
          params: options.wait
            ? { wait: 1, since: options.since ?? 0 }
            : undefined,
          timeout: options.wait ? LONG_POLL_TIMEOUT_MS : undefined,
        });
        return { job: res.data as DictationJobView };
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        return status === 404 ? { notFound: true } : {};
      }
    },
    async submitAudio(
      blob: Blob,
      mimeType: string,
      language?: string,
    ): Promise<void> {
      this.resetJob();
      const uploaded = await this.uploadJob(blob, mimeType, language);
      if (uploaded.jobId) {
        this.jobId = uploaded.jobId;
        this.status = "processing";
        return;
      }
      if (uploaded.conflictJobId) {
        // A job is already running: keep polling it instead of failing
        this.resumeFrom(uploaded.conflictJobId);
        return;
      }
      this.error = uploaded.error || "The dictation could not be uploaded.";
      this.status = "error";
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
      const { job, notFound } = await this.fetchJob(this.jobId, {
        wait,
        since: this.revision,
      });
      if (job) {
        this.applyJob(job);
        return true;
      }
      if (notFound) {
        // The job expired server-side: stop polling
        this.error = "The dictation job expired. Please record again.";
        this.status = "error";
      }
      // Other errors are transient: keep polling
      return false;
    },
    /** Resolves the stored proposals against the caller-visible data. */
    async previewActions(
      jobId: string,
    ): Promise<{ error?: string }> {
      this.previewLoading = true;
      this.previewError = "";
      try {
        const res = await api.post(`/dictation/${jobId}/actions/preview`);
        this.previews = res.data?.actions || [];
        return {};
      } catch (err) {
        this.previews = [];
        this.previewError =
          (err as { response?: { data?: { error?: string } } })?.response
            ?.data?.error || "The actions could not be previewed.";
        return { error: this.previewError };
      } finally {
        this.previewLoading = false;
      }
    },
    /**
     * Applies the selected proposals server-side. The requestId makes a
     * retried confirm idempotent: the server never applies an action twice.
     */
    async applyActions(
      jobId: string,
      requestId: string,
      selections: DictationActionSelection[],
    ): Promise<{ outcome?: DictationApplyOutcome; error?: string }> {
      this.applyResults = [];
      this.previewError = "";
      try {
        const res = await api.post(`/dictation/${jobId}/actions/apply`, {
          requestId,
          selections,
        });
        const outcome = res.data as DictationApplyOutcome;
        this.applyResults = outcome?.results || [];
        this.lastRequestId = outcome?.requestId || requestId;
        await this.fetchAppliedActions(jobId);
        return { outcome };
      } catch (err) {
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error || "The selected actions could not be applied.",
        };
      }
    },
    /** Best-effort reversal of one applied batch. */
    async undoActions(
      jobId: string,
      requestId: string,
    ): Promise<{ outcome?: DictationUndoOutcome; error?: string }> {
      try {
        const res = await api.post(`/dictation/${jobId}/actions/undo`, {
          requestId,
        });
        await this.fetchAppliedActions(jobId);
        return { outcome: res.data as DictationUndoOutcome };
      } catch (err) {
        return {
          error:
            (err as { response?: { data?: { error?: string } } })?.response
              ?.data?.error || "The actions could not be undone.",
        };
      }
    },
    /** Applied batches of a job (drives the Undo button after a reload). */
    async fetchAppliedActions(jobId: string): Promise<void> {
      this.batchesLoading = true;
      try {
        const res = await api.get(`/dictation/${jobId}/actions`);
        this.appliedBatches = res.data?.batches || [];
      } catch {
        // The batch list is an enhancement: keep the previous one
      } finally {
        this.batchesLoading = false;
      }
    },
    /** Read-only question answered from the caller's visible data. */
    async ask(
      question: string,
      projectId?: string | null,
    ): Promise<{ answer?: DictationAskAnswer; error?: string }> {
      this.askLoading = true;
      this.askError = "";
      try {
        const res = await api.post("/dictation/ask", {
          question,
          ...(projectId ? { projectId } : {}),
        });
        this.askAnswer = res.data as DictationAskAnswer;
        return { answer: this.askAnswer };
      } catch (err) {
        this.askError =
          (err as { response?: { data?: { error?: string } } })?.response
            ?.data?.error || "The question could not be answered.";
        return { error: this.askError };
      } finally {
        this.askLoading = false;
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
