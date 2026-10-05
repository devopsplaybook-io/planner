export type DictationActionType = "create_task" | "create_note";

export interface DictationActionProposal {
  type: DictationActionType;
  title: string;
  description: string;
  priority?: "high" | "medium" | "low";
  dueDate?: string;
}

export const POLISH_SYSTEM_PROMPT =
  "You are a writing assistant for a dictation feature. " +
  "The user dictated a text and a speech-to-text engine transcribed it, so the transcript " +
  "may be missing punctuation, casing and paragraph breaks and may contain transcription mistakes.\n" +
  "Rewrite the transcript: restore punctuation and casing, remove filler words and obvious " +
  "transcription artifacts, and apply light markdown structure (paragraphs or lists) when it improves readability.\n" +
  "Keep the original language, meaning and wording — never invent information that is not in the transcript.\n\n" +
  'Answer with strict JSON only: {"text": "..."} containing the polished text. ' +
  "No markdown code fences, no commentary.";

export const ACTIONS_SYSTEM_PROMPT =
  "You are an assistant for a Kanban task tracker. " +
  "The user dictated a text (already transcribed and cleaned up) and wants suggestions for " +
  "what to do with it next.\n" +
  "Propose concrete follow-up actions the user might want to create from this text: " +
  "tasks to do, or notes to keep.\n\n" +
  "Answer with strict JSON only, following exactly this schema:\n" +
  '{"actions": [{"type": "create_task", "title": "...", "description": "...", "priority": "high|medium|low", "dueDate": "YYYY-MM-DD"}]}\n' +
  '- "type" is either "create_task" or "create_note".\n' +
  '- "title" is a short summary; "description" is the detailed text.\n' +
  '- "priority" and "dueDate" are optional and only set when the text clearly implies them; ' +
  '"dueDate" must be an ISO date (YYYY-MM-DD).\n' +
  "- Propose at most 5 actions; return an empty array when the text contains nothing actionable.\n" +
  "No markdown code fences, no commentary.";

/**
 * Builds the user prompt for the polish request. Pure so it can be
 * unit-tested without a configuration.
 */
export function BuildPolishPrompt(
  transcript: string,
  language: string | null,
): string {
  const hint = language
    ? `The dictated text is in language code "${language}".\n`
    : "";
  return `${hint}Transcript:\n${transcript}`;
}

/**
 * Builds the user prompt for the action-proposal request. Pure so it can be
 * unit-tested without a configuration.
 */
export function BuildActionsPrompt(
  text: string,
  language: string | null,
): string {
  const hint = language
    ? `The dictated text is in language code "${language}".\n`
    : "";
  return `${hint}Text:\n${text}`;
}

/**
 * Parses the polished text out of the LLM response. Returns null when the
 * response cannot be interpreted (the caller then falls back to the raw
 * transcript).
 */
export function ParsePolishedText(content: string): string | null {
  if (!content) {
    return null;
  }
  let text = content.trim();
  // Tolerate JSON wrapped in markdown code fences or embedded in prose
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.substring(start, end + 1));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const polished = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!polished) {
      return null;
    }
    return polished;
  } catch {
    return null;
  }
}

const ACTION_TYPES: DictationActionType[] = ["create_task", "create_note"];
const PRIORITIES = ["high", "medium", "low"];
const MAX_ACTIONS = 5;

/**
 * Parses and validates the action proposals out of the LLM response: entries
 * with an invalid type or an empty title are dropped, unknown optional fields
 * are sanitized, and the list is clamped to MAX_ACTIONS. Returns null when
 * the response itself cannot be interpreted.
 */
export function ParseActionProposals(
  content: string,
): DictationActionProposal[] | null {
  if (!content) {
    return null;
  }
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.substring(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const rawActions = (parsed as { actions?: unknown }).actions;
  if (!Array.isArray(rawActions)) {
    return null;
  }
  const proposals: DictationActionProposal[] = [];
  for (const raw of rawActions) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const type = entry.type as DictationActionType;
    if (!ACTION_TYPES.includes(type)) {
      continue;
    }
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) {
      continue;
    }
    const proposal: DictationActionProposal = {
      type,
      title,
      description:
        typeof entry.description === "string" ? entry.description.trim() : "",
    };
    if (PRIORITIES.includes(entry.priority as string)) {
      proposal.priority = entry.priority as "high" | "medium" | "low";
    }
    if (
      typeof entry.dueDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) &&
      !Number.isNaN(new Date(entry.dueDate).getTime())
    ) {
      proposal.dueDate = entry.dueDate;
    }
    proposals.push(proposal);
    if (proposals.length >= MAX_ACTIONS) {
      break;
    }
  }
  return proposals;
}
