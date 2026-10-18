const logger = console;

/**
 * Per-project cleanup rule. A missing day threshold means the aspect is not
 * cleaned up; a rule is only enforced when `enabled` is true (the default
 * is disabled: no explicit enable means nothing is ever deleted).
 */
export interface CleanupRule {
  projectId: string;
  deleteDoneTasksOlderThanDays?: number;
  deleteAttachmentsOlderThanDays?: number;
  deleteVoiceMessagesOlderThanDays?: number;
  enabled: boolean;
}

/**
 * Settings category holding the cleanup rules document
 * (`{"rules": [...]}`) in the settings key-value store.
 */
export const CLEANUP_SETTINGS_CATEGORY = "cleanup";

/** Audio file extensions considered voice messages (server mirror of the web AUDIO_EXTENSIONS list; .mp4 is deliberately not audio). */
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

export function IsAudioAttachmentFileName(fileName: string): boolean {
  const ext = (fileName || "").split(".").pop()?.toLowerCase() || "";
  return AUDIO_EXTENSIONS.includes(ext);
}

/**
 * Tolerant parser for the stored rules document: accepts `{"rules": [...]}`
 * or a bare array, drops entries that are not usable objects, coerces day
 * values to integers >= 1 (anything else means the aspect is off) and treats
 * `enabled` as true only when strictly true. Never throws: an unusable
 * document yields an empty rule list plus one log line.
 */
export function ParseCleanupRules(raw: unknown): CleanupRule[] {
  let list: unknown[] | null = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { rules?: unknown }).rules)
  ) {
    list = (raw as { rules: unknown[] }).rules;
  } else {
    if (raw !== null && raw !== undefined) {
      logger.warn("[Cleanup] Ignoring malformed cleanup rules document");
    }
    return [];
  }
  const rules: CleanupRule[] = [];
  for (const entry of list) {
    const parsed = parseRule(entry);
    if (parsed) {
      rules.push(parsed);
    }
  }
  return rules;
}

function parseRule(entry: unknown): CleanupRule | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const raw = entry as Record<string, unknown>;
  const projectId =
    typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  if (!projectId) {
    return null;
  }
  return {
    projectId,
    deleteDoneTasksOlderThanDays: parseDays(
      raw.deleteDoneTasksOlderThanDays,
    ),
    deleteAttachmentsOlderThanDays: parseDays(
      raw.deleteAttachmentsOlderThanDays,
    ),
    deleteVoiceMessagesOlderThanDays: parseDays(
      raw.deleteVoiceMessagesOlderThanDays,
    ),
    enabled: raw.enabled === true,
  };
}

function parseDays(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

/**
 * Guardrail: a cleanup rule deleting tasks can only ever match a Done task
 * whose last update is older than the cutoff (dateUpdated doubles as the
 * completion timestamp, the same semantics as the doneSince list filter).
 */
export function IsDoneTaskEligible(
  task: { status?: string; dateUpdated?: string },
  cutoffIso: string,
): boolean {
  return task.status === "Done" && !!task.dateUpdated && task.dateUpdated < cutoffIso;
}

/**
 * Attachment eligibility: created before the cutoff, optionally restricted
 * to audio files (voice messages).
 */
export function IsAttachmentEligible(
  attachment: { fileName?: string; dateCreated?: string },
  cutoffIso: string,
  audioOnly = false,
): boolean {
  if (!attachment.dateCreated || attachment.dateCreated >= cutoffIso) {
    return false;
  }
  if (audioOnly && !IsAudioAttachmentFileName(attachment.fileName || "")) {
    return false;
  }
  return true;
}

/** ISO cutoff for "older than N days" from a reference instant. */
export function CleanupCutoffIso(days: number, nowIso: string): string {
  return new Date(
    new Date(nowIso).getTime() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * Validates rules coming from an admin request against the set of existing
 * project ids. Returns the canonical rule list, or an error message for the
 * first problem found.
 */
export function ValidateCleanupRules(
  input: unknown,
  projectIds: ReadonlySet<string>,
): { rules: CleanupRule[] | null; error: string | null } {
  if (!Array.isArray(input)) {
    return { rules: null, error: "rules must be an array" };
  }
  const seen = new Set<string>();
  const rules: CleanupRule[] = [];
  for (const entry of input) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { rules: null, error: "Each rule must be an object" };
    }
    const raw = entry as Record<string, unknown>;
    const projectId =
      typeof raw.projectId === "string" ? raw.projectId.trim() : "";
    if (!projectId) {
      return { rules: null, error: "Each rule requires a projectId" };
    }
    if (!projectIds.has(projectId)) {
      return { rules: null, error: `Unknown project: ${projectId}` };
    }
    if (seen.has(projectId)) {
      return {
        rules: null,
        error: `Duplicate rule for project: ${projectId}`,
      };
    }
    seen.add(projectId);
    const tasks = checkDays(raw.deleteDoneTasksOlderThanDays, "Done tasks");
    if (typeof tasks === "string") return { rules: null, error: tasks };
    const attachments = checkDays(
      raw.deleteAttachmentsOlderThanDays,
      "attachments",
    );
    if (typeof attachments === "string") return { rules: null, error: attachments };
    const voice = checkDays(
      raw.deleteVoiceMessagesOlderThanDays,
      "voice messages",
    );
    if (typeof voice === "string") return { rules: null, error: voice };
    rules.push({
      projectId,
      deleteDoneTasksOlderThanDays: tasks,
      deleteAttachmentsOlderThanDays: attachments,
      deleteVoiceMessagesOlderThanDays: voice,
      enabled: raw.enabled === true,
    });
  }
  return { rules, error: null };
}

function checkDays(value: unknown, label: string): number | undefined | string {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return `Days for ${label} must be an integer >= 1`;
  }
  return value;
}
