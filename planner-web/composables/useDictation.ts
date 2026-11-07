import { ref, unref } from "vue";
import type { Ref } from "vue";
import { pickRecordingMimeType } from "../utils/dictationMime";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
}

interface UseDictationOptions {
  /**
   * Maximum recording length. Accepts a ref/computed so the value can follow
   * the server config; read on every timer tick. Unlimited when omitted.
   */
  maxDurationSeconds?: number | Ref<number>;
  /**
   * Called when the recording is automatically stopped at the max duration,
   * with the captured audio so the caller can still submit it.
   */
  onAutoStop?: (recording: RecordingResult | null) => void | Promise<void>;
}

/**
 * True when the current browser can record audio (MediaRecorder with a
 * microphone). Exported so components can hide recording affordances
 * without instantiating the composable.
 */
export function isVoiceRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * MediaRecorder lifecycle for the dictation dialog: microphone permission,
 * mimeType selection, elapsed timer, a light RMS level for the pulse
 * indicator and auto-stop at the maximum duration. Recording state and
 * timers live here (not in the component) so the logic is testable without
 * mounting the dialog.
 */
export function useDictation(options: UseDictationOptions = {}) {
  function maxDuration(): number {
    return Math.max(1, unref(options.maxDurationSeconds) ?? Infinity);
  }

  const isRecording = ref(false);
  const elapsedSeconds = ref(0);
  const level = ref(0);
  const error = ref<string | null>(null);

  let mediaStream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let levelFrame: number | null = null;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let mimeType = "";
  let chunks: Blob[] = [];
  let stopPromise: Promise<RecordingResult> | null = null;
  let stopInFlight: Promise<RecordingResult | null> | null = null;

  function isSupported(): boolean {
    return isVoiceRecordingSupported();
  }

  function releaseStream(): void {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  function stopMetering(): void {
    if (levelFrame !== null) {
      cancelAnimationFrame(levelFrame);
      levelFrame = null;
    }
    analyser = null;
    audioContext?.close().catch(() => undefined);
    audioContext = null;
    level.value = 0;
  }

  function stopTimer(): void {
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function cleanup(): void {
    stopTimer();
    stopMetering();
    releaseStream();
    isRecording.value = false;
  }

  function startLevelMeter(): void {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) {
        return;
      }
      audioContext = new Ctx();
      const source = audioContext.createMediaStreamSource(mediaStream!);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const sample = () => {
        if (!analyser) {
          return;
        }
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (const value of buffer) {
          sum += value * value;
        }
        level.value = Math.min(1, Math.sqrt(sum / buffer.length) / 128);
        levelFrame = requestAnimationFrame(sample);
      };
      sample();
    } catch {
      // Level metering is decorative: recording works without it
    }
  }

  /**
   * Requests microphone access and starts recording. Resolves to false (and
   * sets a user-facing error) when recording cannot start.
   */
  async function start(): Promise<boolean> {
    error.value = null;
    if (isRecording.value) {
      return true;
    }
    if (!isSupported()) {
      error.value = "Voice recording is not supported by this browser.";
      return false;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name;
      error.value =
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was denied. Allow it in the browser settings and try again."
          : "No microphone is available.";
      return false;
    }
    mimeType = pickRecordingMimeType();
    if (!mimeType) {
      error.value = "Audio recording is not supported by this browser.";
      releaseStream();
      return false;
    }
    chunks = [];
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    stopPromise = new Promise<RecordingResult>((resolve) => {
      mediaRecorder!.onstop = () => {
        resolve({ blob: new Blob(chunks, { type: mimeType.split(";")[0] }), mimeType });
        stopPromise = null;
      };
    });
    mediaRecorder.start(250);
    isRecording.value = true;
    elapsedSeconds.value = 0;
    startLevelMeter();
    timerInterval = setInterval(() => {
      elapsedSeconds.value += 1;
      if (elapsedSeconds.value >= maxDuration()) {
        // Auto-stop must hand the captured audio over: the caller submits it
        // exactly like a manual stop instead of losing the recording.
        void (async () => {
          const recording = await stop();
          await options.onAutoStop?.(recording);
        })().catch(() => undefined);
      }
    }, 1000);
    return true;
  }

  /**
   * Stops recording and resolves with the captured audio, or null when
   * nothing was recording. The recorder is stopped before the microphone is
   * released so the tail of the audio is not truncated; concurrent calls
   * share the same in-flight stop.
   */
  async function stop(): Promise<RecordingResult | null> {
    if (stopInFlight) {
      return stopInFlight;
    }
    if (!isRecording.value || !mediaRecorder) {
      return null;
    }
    const recorder = mediaRecorder;
    const pending = stopPromise;
    stopTimer();
    stopInFlight = (async () => {
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        const result = pending ? await pending : null;
        recorder.ondataavailable = null;
        recorder.onstop = null;
        mediaRecorder = null;
        return result;
      } finally {
        cleanup();
        stopInFlight = null;
      }
    })();
    return stopInFlight;
  }

  /**
   * Stops recording and discards the captured audio. A pending stop is
   * settled first so it never hangs; the caller gets no recording.
   */
  async function cancel(): Promise<void> {
    const recorder = mediaRecorder;
    const pending = stopPromise;
    stopTimer();
    // A stop already in flight has stopped the recorder itself
    if (!stopInFlight && recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (pending) {
      await pending.catch(() => undefined);
    }
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
    }
    mediaRecorder = null;
    chunks = [];
    stopPromise = null;
    cleanup();
  }

  return {
    isRecording,
    elapsedSeconds,
    level,
    error,
    start,
    stop,
    cancel,
  };
}
