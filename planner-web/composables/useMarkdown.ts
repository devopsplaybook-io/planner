import { marked } from "marked";
import DOMPurify from "dompurify";

// Configure marked for safe, sane defaults
marked.setOptions({
  breaks: true,
  gfm: true,
});

// User-generated markdown is rendered through v-html, so the sanitizer
// allow-list is the security boundary: no scripts, event handlers or
// javascript:/data: URLs survive. `input` + type/checked/disabled keep
// GFM task-list checkboxes rendering.
const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "s",
  "a",
  "img",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
];

const ALLOWED_ATTR = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "start",
  "align",
  "type",
  "checked",
  "disabled",
  "target",
  "rel",
];

// http/https/mailto plus site-relative URLs
const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;

// Every rendered markdown link opens in a new tab (T2): the hook runs
// inside the sanitize pass, so target/rel also end up on kept anchors.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/**
 * Render markdown text to sanitized HTML. Returns empty string for falsy input.
 */
export function renderMarkdown(text: string | null | undefined): string {
  if (!text) return "";
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
  });
}
