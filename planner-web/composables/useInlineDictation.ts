import { computed, getCurrentScope, onScopeDispose, ref, unref } from "vue";
import type { Ref } from "vue";
import { useDictation, isVoiceRecordingSupported } from "./useDictation";
import type { RecordingResult } from "./useDictation";
import { applyVoiceFormatting } from "../utils/inlineDictationFormatting";
import {
  insertAtSelection,
  isTextFieldVisible,
  readSelection,
  replaceRange,
} from "../utils/inlineDictationInsert";
import type { InsertedRange } from "../utils/inlineDictationInsert";
import { useDictationStore } from "../stores/dictation";
import type {
  DictationAvailability,
  DictationJobView,
  DictationResult,
} from "../stores/dictation";
import { useRecommendationStore } from "../stores/recommendation";

export type InlineDictationPhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "done";

export type InlineRecordingMode = "dictation" | "voice-message";

export interface InlineDictationOptions {
  target:
    | Ref<HTMLInputElement | HTMLTextAreaElement | null>
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
    | (() => HTMLInputElement | HTMLTextAreaElement | null | undefined);
  /** Runs while the job is submitted, for voice-message attachments. */
  onKeepAudio?: (recording: RecordingResult) => void | Promise<void>;
  /** Called after text is inserted so hosts can resize or scroll. */
  onInserted?: () => void;
  /** Project scope used to bias the speech engine with its vocabulary. */
  projectId?: () => string | null;
}

// Same fallback cadence as the dictation dialog when long polling fails.
const POLL_FALLBACK_MS = 1500;

const CONTROL_SELECTOR = "[data-inline-dictation]";

type TextField = HTMLInputElement | HTMLTextAreaElement;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampRange(field: TextField, range: InsertedRange | null): InsertedRange {
  const length = field.value?.length ?? 0;
  if (!range) {
    return { start: length, end: length };
  }
  const start = Math.max(0, Math.min(range.start, length));
  return { start, end: Math.max(start, Math.min(range.end, length)) };
}

/**
 * Controller behind the inline microphone: records with the existing
 * recorder, submits through the durable dictation API with the `inline`
 * source, inserts the raw transcript as soon as it arrives and patches the
 * same range with the polished text only while the user has not touched it.
 */
export function useInlineDictation(options: InlineDictationOptions) {
  const recommendationStore = useRecommendationStore();
  const dictationStore = useDictationStore();

  const phase = ref<InlineDictationPhase>("idle");
  const recordingMode = ref<InlineRecordingMode>("dictation");
  const error = ref<string | null>(null);
  const conflictJobId = ref<string | null>(null);
  const jobId = ref<string | null>(null);
  const revision = ref(0);
  const result = ref<DictationResult | null>(null);
  const availability = ref<DictationAvailability | null>(null);
  const polishedText = ref<string | null>(null);
  const canApplyPolished = ref(false);
  const pendingInsert = ref<string | null>(null);

  const online =
    typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const isOnline = ref(online);
  const recordingSupported = isVoiceRecordingSupported();

  const isAvailable = computed(
    () =>
      recommendationStore.isDictationEnabled &&
      recommendationStore.isDictationSttConfigured &&
      recordingSupported &&
      isOnline.value,
  );
  const languages = computed(() => recommendationStore.dictationLanguages);
  const language = computed({
    get: () => dictationStore.language,
    set: (value: string) => dictationStore.setLanguage(value),
  });
  const hasJob = computed(() => !!(jobId.value || conflictJobId.value));

  // Where the caret was when recording started: the transcript replaces an
  // active selection or lands at the captured caret.
  let caret: InsertedRange | null = null;
  let insertedRange: InsertedRange | null = null;
  let insertedText = "";
  let snapshot = "";
  let abandoned = false;
  let rawHandled = false;
  let polishedHandled = false;
  let submitting = false;
  let watchedField: TextField | null = null;
  let pollToken = 0;
  let disposed = false;

  const recorder = useDictation({
    maxDurationSeconds: computed(
      () => recommendationStore.dictationMaxDurationSeconds,
    ),
    onAutoStop: (recording) => submitRecording(recording),
  });

  function resolveTarget(): TextField | null {
    const target = options.target;
    if (!target) {
      return null;
    }
    if (typeof target === "function") {
      return (target as () => TextField | null | undefined)() ?? null;
    }
    return unref(target as Ref<TextField | null> | TextField) ?? null;
  }

  function isControlElement(element: EventTarget | null): boolean {
    return (
      typeof (element as Element | null)?.closest === "function" &&
      !!(element as Element).closest(CONTROL_SELECTOR)
    );
  }

  const onTargetFocusOut: EventListener = (event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    // Focus moving to the mic/stop buttons is not an abandonment. A null
    // relatedTarget (Safari buttons do not take focus) is ignored: the
    // visibility check at insertion time still protects the caret.
    if (next && (next === watchedField || isControlElement(next))) {
      return;
    }
    if (next) {
      abandoned = true;
    }
  };

  const onTargetFocus: EventListener = () => {
    abandoned = false;
  };

  function attachTargetListeners(field: TextField): void {
    detachTargetListeners();
    watchedField = field;
    field.addEventListener("focusout", onTargetFocusOut);
    field.addEventListener("focus", onTargetFocus);
  }

  function detachTargetListeners(): void {
    if (!watchedField) {
      return;
    }
    watchedField.removeEventListener("focusout", onTargetFocusOut);
    watchedField.removeEventListener("focus", onTargetFocus);
    watchedField = null;
  }

  function onOnline(): void {
    isOnline.value = true;
  }

  function onOffline(): void {
    isOnline.value = false;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  function resetJobState(): void {
    jobId.value = null;
    conflictJobId.value = null;
    revision.value = 0;
    result.value = null;
    availability.value = null;
    polishedText.value = null;
    canApplyPolished.value = false;
    pendingInsert.value = null;
    insertedRange = null;
    insertedText = "";
    snapshot = "";
    rawHandled = false;
    polishedHandled = false;
    error.value = null;
  }

  function insertOrDefer(text: string): void {
    const formatted = applyVoiceFormatting(text);
    if (!formatted) {
      return;
    }
    const field = resolveTarget();
    if (!field || abandoned || !isTextFieldVisible(field)) {
      // The user left the field (or it closed): never steal the caret
      pendingInsert.value = formatted;
      return;
    }
    const target = clampRange(field, caret);
    try {
      field.focus({ preventScroll: true });
      field.setSelectionRange(target.start, target.end);
    } catch {
      // Plain value insertion still works without selection support
    }
    insertedRange = insertAtSelection(field, formatted);
    insertedText = formatted;
    snapshot = field.value;
    pendingInsert.value = null;
    options.onInserted?.();
  }

  function handlePolished(text: string): void {
    const formatted = applyVoiceFormatting(text);
    if (!formatted) {
      return;
    }
    polishedText.value = formatted;
    const field = resolveTarget();
    const untouched =
      !!field &&
      !!insertedRange &&
      field.value === snapshot &&
      field.value.slice(insertedRange.start, insertedRange.end) ===
        insertedText;
    if (field && insertedRange && untouched) {
      insertedRange = replaceRange(
        field,
        insertedRange.start,
        insertedRange.end,
        formatted,
      );
      insertedText = formatted;
      snapshot = field.value;
      canApplyPolished.value = false;
      options.onInserted?.();
      return;
    }
    if (!insertedRange && pendingInsert.value !== null) {
      // Nothing was inserted yet: offer the improved text instead
      pendingInsert.value = formatted;
      return;
    }
    canApplyPolished.value = true;
  }

  function applyJob(job: DictationJobView): void {
    revision.value = job.revision ?? revision.value;
    result.value = job.result ?? null;
    availability.value = job.availability ?? null;
    if (job.status === "error") {
      error.value = job.error || "The dictation failed.";
      phase.value = "idle";
      return;
    }
    if (!rawHandled && job.result?.rawTranscript) {
      rawHandled = true;
      phase.value = "done";
      insertOrDefer(job.result.rawTranscript);
    }
    if (
      !polishedHandled &&
      job.availability?.polishedText &&
      job.result?.polishedText
    ) {
      polishedHandled = true;
      handlePolished(job.result.polishedText);
    }
  }

  async function pollLoop(token: number): Promise<void> {
    while (token === pollToken && !disposed) {
      const id = jobId.value;
      if (!id) {
        return;
      }
      const first = await dictationStore.fetchJob(id, {
        wait: true,
        since: revision.value,
      });
      if (token !== pollToken) {
        return;
      }
      if (first.notFound) {
        error.value = "The dictation job expired. Please record again.";
        phase.value = "idle";
        return;
      }
      let job = first.job;
      if (!job) {
        // Long polling unavailable (proxy timeout, network hiccup): fall
        // back to a short poll before retrying the push channel.
        await sleep(POLL_FALLBACK_MS);
        if (token !== pollToken) {
          return;
        }
        const second = await dictationStore.fetchJob(id, {
          since: revision.value,
        });
        if (token !== pollToken) {
          return;
        }
        if (second.notFound) {
          error.value = "The dictation job expired. Please record again.";
          phase.value = "idle";
          return;
        }
        job = second.job;
        if (!job) {
          await sleep(POLL_FALLBACK_MS);
          continue;
        }
      }
      applyJob(job);
      if (job.status !== "processing") {
        return;
      }
    }
  }

  function stopPolling(): void {
    pollToken += 1;
  }

  function startPolling(): void {
    stopPolling();
    const token = pollToken;
    void pollLoop(token);
  }

  async function submitRecording(
    recording: RecordingResult | null,
  ): Promise<void> {
    if (!recording || submitting) {
      return;
    }
    submitting = true;
    detachTargetListeners();
    phase.value = "transcribing";
    try {
      if (recordingMode.value === "voice-message" && options.onKeepAudio) {
        // The audio attachment upload runs in parallel with transcription;
        // its failure is surfaced by the host and never drops the transcript
        Promise.resolve(options.onKeepAudio(recording)).catch(
          () => undefined,
        );
      }
      const uploaded = await dictationStore.uploadJob(
        recording.blob,
        recording.mimeType,
        language.value,
        "inline",
        options.projectId?.() ?? null,
        dictationStore.targetLanguage,
      );
      if (uploaded.jobId) {
        jobId.value = uploaded.jobId;
        revision.value = 0;
        startPolling();
      } else if (uploaded.conflictJobId) {
        conflictJobId.value = uploaded.conflictJobId;
        error.value = "A dictation is already running.";
        phase.value = "idle";
      } else {
        error.value =
          uploaded.error || "The dictation could not be uploaded.";
        phase.value = "idle";
      }
    } finally {
      submitting = false;
    }
  }

  async function start(
    startOptions: { keepAudio?: boolean } = {},
  ): Promise<boolean> {
    if (phase.value === "recording" || phase.value === "transcribing") {
      return false;
    }
    if (!isAvailable.value) {
      error.value = isOnline.value
        ? "Dictation is not available."
        : "You are offline: dictation needs a connection.";
      return false;
    }
    const field = resolveTarget();
    if (!field) {
      error.value = "The text field is not available.";
      return false;
    }
    resetJobState();
    recordingMode.value = startOptions.keepAudio
      ? "voice-message"
      : "dictation";
    caret = readSelection(field);
    abandoned = false;
    attachTargetListeners(field);
    const started = await recorder.start();
    if (!started) {
      error.value =
        recorder.error.value || "The microphone could not be started.";
      detachTargetListeners();
      return false;
    }
    phase.value = "recording";
    return true;
  }

  async function stop(): Promise<void> {
    if (!recorder.isRecording.value) {
      return;
    }
    const recording = await recorder.stop();
    await submitRecording(recording);
  }

  async function cancel(): Promise<void> {
    if (recorder.isRecording.value) {
      await recorder.cancel();
      phase.value = "idle";
      error.value = null;
      detachTargetListeners();
      return;
    }
    stopPolling();
    if (phase.value === "transcribing") {
      phase.value = "idle";
    }
    pendingInsert.value = null;
    canApplyPolished.value = false;
  }

  function insertPending(): void {
    const text = pendingInsert.value;
    if (text === null) {
      return;
    }
    const field = resolveTarget();
    if (!field || !isTextFieldVisible(field)) {
      return;
    }
    insertedRange = insertAtSelection(field, text);
    insertedText = text;
    snapshot = field.value;
    pendingInsert.value = null;
    options.onInserted?.();
  }

  function applyPolished(): void {
    const text = polishedText.value;
    if (!text) {
      return;
    }
    const field = resolveTarget();
    if (!field) {
      return;
    }
    if (!insertedRange && pendingInsert.value !== null) {
      pendingInsert.value = text;
      canApplyPolished.value = false;
      return;
    }
    const intact =
      !!insertedRange &&
      field.value === snapshot &&
      field.value.slice(insertedRange.start, insertedRange.end) ===
        insertedText;
    if (insertedRange && intact) {
      insertedRange = replaceRange(
        field,
        insertedRange.start,
        insertedRange.end,
        text,
      );
    } else {
      // The user changed the text: insert at the current caret instead of
      // overwriting anything
      insertedRange = insertAtSelection(field, text);
    }
    insertedText = text;
    snapshot = field.value;
    canApplyPolished.value = false;
    options.onInserted?.();
  }

  async function promote(): Promise<void> {
    const id = jobId.value ?? conflictJobId.value;
    if (!id) {
      return;
    }
    stopPolling();
    dictationStore.openDialog();
    await dictationStore.openJob(id);
    phase.value = "idle";
  }

  function reset(): void {
    stopPolling();
    void recorder.cancel();
    detachTargetListeners();
    resetJobState();
    phase.value = "idle";
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    reset();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose);
  }

  return {
    phase,
    recordingMode,
    isRecording: recorder.isRecording,
    elapsedSeconds: recorder.elapsedSeconds,
    level: recorder.level,
    error,
    conflictJobId,
    jobId,
    hasJob,
    revision,
    result,
    availability,
    polishedText,
    canApplyPolished,
    pendingInsert,
    languages,
    language,
    isAvailable,
    isOnline,
    start,
    stop,
    cancel,
    insertPending,
    applyPolished,
    promote,
    reset,
    dispose,
  };
}
