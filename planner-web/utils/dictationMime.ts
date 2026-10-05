/**
 * Pure mimeType/extension helpers for the dictation recorder.
 */

/**
 * Picks the best mimeType the current browser can record with:
 * Opus/WebM first (Chrome, Firefox), MP4/AAC fallback (Safari, iOS),
 * or an empty string when recording is unsupported.
 */
export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

/**
 * File extension matching a recording mimeType (used for the multipart
 * filename sent to the server).
 */
export function fileExtensionForMimeType(mimeType: string): string {
  const type = (mimeType || "").toLowerCase();
  if (type.includes("mp4")) {
    return ".m4a";
  }
  if (type.includes("ogg")) {
    return ".ogg";
  }
  return ".webm";
}
