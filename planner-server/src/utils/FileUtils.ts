import * as fs from "fs-extra";

/**
 * Builds an RFC 6266 Content-Disposition value with an ASCII fallback and
 * the exact UTF-8 name in the RFC 5987 `filename*` parameter, so non-ASCII
 * names survive the header. The fallback replaces every byte outside
 * printable ASCII (including CR/LF, preventing header injection) and the
 * characters `"` and `\` with `_`.
 */
export function buildContentDisposition(
  disposition: "inline" | "attachment",
  fileName: string,
): string {
  const fallback = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function removeFilesQuietly(paths: string[]): Promise<void> {
  for (const filePath of paths) {
    if (!filePath) {
      continue;
    }
    try {
      await fs.remove(filePath);
    } catch {
      // Database rows are already gone; orphaned files are harmless
    }
  }
}
