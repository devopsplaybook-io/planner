import api from "./api";

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
