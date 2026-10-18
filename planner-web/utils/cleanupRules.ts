/**
 * Pure helpers bridging the cleanup rule editor form state and the API
 * payload: an empty number input means the aspect is off, thresholds are
 * validated client-side the same way the server validates them, and the
 * confirmation dialog text spells out what each saved rule will do.
 */

export interface CleanupRuleForm {
  projectId: string;
  enabled: boolean;
  deleteDoneTasksOlderThanDays: number | "";
  deleteAttachmentsOlderThanDays: number | "";
  deleteVoiceMessagesOlderThanDays: number | "";
}

export interface CleanupRulePayload {
  projectId: string;
  deleteDoneTasksOlderThanDays?: number;
  deleteAttachmentsOlderThanDays?: number;
  deleteVoiceMessagesOlderThanDays?: number;
  enabled: boolean;
}

export interface CleanupRuleDto {
  projectId: string;
  deleteDoneTasksOlderThanDays?: number;
  deleteAttachmentsOlderThanDays?: number;
  deleteVoiceMessagesOlderThanDays?: number;
  enabled?: boolean;
}

export function emptyRuleForm(projectId: string): CleanupRuleForm {
  return {
    projectId,
    enabled: false,
    deleteDoneTasksOlderThanDays: "",
    deleteAttachmentsOlderThanDays: "",
    deleteVoiceMessagesOlderThanDays: "",
  };
}

/**
 * Hydrates the editor forms from the saved rules, keeping the project order
 * of the saved document.
 */
export function hydrateRuleForms(
  savedRules: CleanupRuleDto[] | null | undefined,
): CleanupRuleForm[] {
  if (!Array.isArray(savedRules)) {
    return [];
  }
  return savedRules
    .filter((rule) => rule && typeof rule.projectId === "string")
    .map((rule) => ({
      projectId: rule.projectId,
      enabled: rule.enabled === true,
      deleteDoneTasksOlderThanDays: normalizeDays(
        rule.deleteDoneTasksOlderThanDays,
      ),
      deleteAttachmentsOlderThanDays: normalizeDays(
        rule.deleteAttachmentsOlderThanDays,
      ),
      deleteVoiceMessagesOlderThanDays: normalizeDays(
        rule.deleteVoiceMessagesOlderThanDays,
      ),
    }));
}

function normalizeDays(value: unknown): number | "" {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : "";
}

/**
 * Builds the API payload from the form state: empty or sub-1 inputs mean the
 * aspect is off; a rule with no threshold is still saved (it deletes nothing
 * until a threshold is set or the rule is enabled).
 */
export function buildRulesPayload(
  forms: CleanupRuleForm[],
): { rules: CleanupRulePayload[] } {
  return {
    rules: forms.map((form) => ({
      projectId: form.projectId,
      deleteDoneTasksOlderThanDays: toDays(form.deleteDoneTasksOlderThanDays),
      deleteAttachmentsOlderThanDays: toDays(
        form.deleteAttachmentsOlderThanDays,
      ),
      deleteVoiceMessagesOlderThanDays: toDays(
        form.deleteVoiceMessagesOlderThanDays,
      ),
      enabled: form.enabled === true,
    })),
  };
}

function toDays(value: number | ""): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

/**
 * Human-readable lines for the save confirmation dialog: one per rule,
 * spelling out what will run every day (enabled rules) or what stays off.
 */
export function buildConfirmationLines(
  forms: CleanupRuleForm[],
  projectLabel: (projectId: string) => string,
): string[] {
  return forms.map((form) => {
    const label = projectLabel(form.projectId) || form.projectId;
    if (!form.enabled) {
      return `${label}: rule saved but disabled — nothing will be deleted.`;
    }
    const aspects: string[] = [];
    if (toDays(form.deleteDoneTasksOlderThanDays) !== undefined) {
      aspects.push(`Done tasks older than ${form.deleteDoneTasksOlderThanDays} days`);
    }
    if (toDays(form.deleteAttachmentsOlderThanDays) !== undefined) {
      aspects.push(
        `attachments older than ${form.deleteAttachmentsOlderThanDays} days`,
      );
    }
    if (toDays(form.deleteVoiceMessagesOlderThanDays) !== undefined) {
      aspects.push(
        `voice messages older than ${form.deleteVoiceMessagesOlderThanDays} days`,
      );
    }
    if (aspects.length === 0) {
      return `${label}: enabled with no threshold yet — nothing will be deleted until a threshold is set.`;
    }
    return `${label}: every day, delete ${aspects.join(", ")}.`;
  });
}
