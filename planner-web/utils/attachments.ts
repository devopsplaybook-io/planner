import api from "./api";

// Attachment viewer registry: file extension -> viewer kind. Adding a new
// viewer type means one entry here plus one renderer branch in the shared
// AttachmentFullscreenViewer component.
export type AttachmentViewerKind = "image" | "pdf" | "audio";

const IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
];

const PDF_EXTENSIONS = ["pdf"];

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

function fileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

/**
 * The viewer kind that should render this file (image preview, PDF viewer,
 * audio player) or null when there is no inline viewer for it (download only).
 */
export function getAttachmentViewerKind(
  fileName: string,
): AttachmentViewerKind | null {
  const ext = fileExtension(fileName);
  if (PDF_EXTENSIONS.includes(ext)) return "pdf";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return null;
}

/**
 * True when a file name has an image extension (image previews).
 */
export function isImageFile(fileName: string): boolean {
  return getAttachmentViewerKind(fileName) === "image";
}

/**
 * True when a file name has a PDF extension (inline PDF viewer).
 */
export function isPdfFile(fileName: string): boolean {
  return getAttachmentViewerKind(fileName) === "pdf";
}

/**
 * True when a file name has an audio extension (voice message recordings
 * and other audio attachments); `.mp4` is deliberately not audio.
 */
export function isAudioFile(fileName: string): boolean {
  return getAttachmentViewerKind(fileName) === "audio";
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
 * Triggers a browser download of an already-fetched object URL; the caller
 * owns the URL's lifetime.
 */
export function downloadObjectUrl(objectUrl: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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
  downloadObjectUrl(objectUrl, fileName);
  // The revoke must be delayed: revoking right after click() can abort the
  // download before the browser has resolved the blob URL, which shows up
  // as a dead download button (notably on mobile)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
