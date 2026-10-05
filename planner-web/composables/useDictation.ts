import { ref } from "vue";
import { pickRecordingMimeType } from "../utils/dictationMime";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
}

interface UseDictationOptions {
  maxDurationSeconds?: number;
  /** Called when the recording is automatically stopped at the max duration. */
  onAutoStop?: () => void;
}

/**
 * MediaRecorder lifecycle for the dictation dialog: microphone permission,
 * mimeType selection, elapsed timer, a light RMS level for the pulse
 * indicator and auto-stop at the maximum duration. Recording state and
 * timers live here (not in the component) so the logic is testable without
 * mounting the dialog.
 */
export function useDictation(options: UseDictationOptions = {}) {
  const maxDurationSeconds = options.maxDurationSeconds ?? 120;

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

  function isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
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
      if (elapsedSeconds.value >= maxDurationSeconds) {
        void stop();
        options.onAutoStop?.();
      }
    }, 1000);
    return true;
  }

  /**
   * Stops recording and resolves with the captured audio, or null when
   * nothing was recording.
   */
  async function stop(): Promise<RecordingResult | null> {
    if (!isRecording.value || !mediaRecorder) {
      return null;
    }
    const pending = stopPromise;
    cleanup();
    if (mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    const recorder = mediaRecorder;
    mediaRecorder = null;
    const result = await pending;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    return result;
  }

  /** Stops recording and discards the captured audio. */
  function cancel(): void {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
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
