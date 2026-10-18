import api from "./api";

const AUDIO_EXTENSIONS = [
  "webm",
  "m4a",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "opus",
  "flac",
  "aac",
];

/**
 * True when a file name has an audio extension (voice message recordings
 * and other audio attachments); `.mp4` is deliberately not audio.
 */
export function isAudioFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Fetches an attachment through the authenticated axios instance (Bearer
 * header) and returns a blob object URL. The JWT is never placed in the
 * attachment URL itself — object URLs are local to the page.
 */
export async function fetchAttachmentObjectUrl(
  url: string,
): Promise<string> {
  const res = await api.get(url, { responseType: "blob" });
  return URL.createObjectURL(res.data);
}

/**
 * Downloads an attachment by fetching it as a blob and clicking a temporary
 * `<a download>` element (with rel=noopener) pointing at the object URL.
 */
export async function downloadAttachment(
  url: string,
  fileName: string,
): Promise<void> {
  const objectUrl = await fetchAttachmentObjectUrl(url);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
