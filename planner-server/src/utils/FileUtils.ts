import * as fs from "fs-extra";

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
