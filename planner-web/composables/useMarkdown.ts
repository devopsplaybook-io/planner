import { marked } from "marked";

// Configure marked for safe, sane defaults
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Render markdown text to HTML. Returns empty string for falsy input.
 */
export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  return marked.parse(text) as string;
}
