import axios from "axios";
import { Config } from "../Config";

const logger = console;

let config: Config;

export async function TaskImproveInit(configIn: Config): Promise<void> {
  config = configIn;
}

export interface ImprovedText {
  title: string;
  description: string;
}

/**
 * Builds the user prompt for the rewording request. Pure so it can be
 * unit-tested without a configuration.
 */
export function BuildImprovePrompt(title: string, description: string): string {
  return [
    "Task title:",
    title || "(empty)",
    "",
    "Task description:",
    description || "(empty)",
  ].join("\n");
}

const SYSTEM_PROMPT =
  "You are a writing assistant for a Kanban task tracker. " +
  "Reword the given task title and description: keep the original meaning, " +
  "make them clearer, more specific and more concise. " +
  "Never invent information that is not in the original text.\n\n" +
  'Answer with strict JSON only: {"title": "...", "description": "..."}. ' +
  "No markdown, no code fences, no commentary.";

/**
 * Parses the LLM response into the improved text. Returns null when the
 * response cannot be interpreted (the caller then answers an error rather
 * than silently keeping the old text).
 */
export function ParseImprovedText(content: string): ImprovedText | null {
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
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const description =
      typeof parsed.description === "string" ? parsed.description.trim() : "";
    if (!title && !description) {
      return null;
    }
    return { title, description };
  } catch {
    return null;
  }
}

/**
 * Rewords a task title and description with the configured LLM. The model
 * is used without reasoning (fast mode). Returns null on a malformed
 * response; network/API errors throw.
 */
export async function TaskImproveText(
  title: string,
  description: string,
): Promise<ImprovedText | null> {
  const content = await callLLMWithRetry(BuildImprovePrompt(title, description));
  const parsed = ParseImprovedText(content);
  if (!parsed) {
    logger.warn("[TaskImprove] LLM returned a malformed response");
    return null;
  }
  return parsed;
}

// ── LLM API call with retry ──────────────────────────────────────────────────

async function callLLMWithRetry(
  prompt: string,
  maxRetries = 3,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.post(
        config.LLM_API_URL,
        {
          model: config.LLM_MODEL,
          temperature: 0.3,
          max_tokens: 1000,
          messages: [
            {
              role: "system",
              content: SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.LLM_API_KEY}`,
          },
          timeout: 60000,
        },
      );
      return response.data?.choices?.[0]?.message?.content || "";
    } catch (error) {
      lastError = error as Error;
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status && status < 500 && status !== 429) {
        throw error;
      }
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(
          `[TaskImprove] LLM API attempt ${attempt + 1} failed (status=${status}), retrying in ${delay}ms: ${lastError.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error("LLM API call failed after retries");
}
