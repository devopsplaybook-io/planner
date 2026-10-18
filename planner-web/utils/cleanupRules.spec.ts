import { describe, expect, it } from "vitest";
import {
  buildConfirmationLines,
  buildRulesPayload,
  emptyRuleForm,
  hydrateRuleForms,
} from "./cleanupRules";
import type { CleanupRuleDto, CleanupRuleForm } from "./cleanupRules";

describe("emptyRuleForm", () => {
  it("should create a disabled form with every aspect off", () => {
    expect(emptyRuleForm("p1")).toEqual({
      projectId: "p1",
      enabled: false,
      deleteDoneTasksOlderThanDays: "",
      deleteAttachmentsOlderThanDays: "",
      deleteVoiceMessagesOlderThanDays: "",
    });
  });
});

describe("hydrateRuleForms", () => {
  it("should return an empty list for absent or malformed documents", () => {
    expect(hydrateRuleForms(null)).toEqual([]);
    expect(hydrateRuleForms(undefined)).toEqual([]);
    expect(hydrateRuleForms("nope" as never)).toEqual([]);
  });

  it("should hydrate the saved rules keeping the document order", () => {
    const forms = hydrateRuleForms([
      { projectId: "p2", deleteDoneTasksOlderThanDays: 30, enabled: true },
      {
        projectId: "p1",
        deleteAttachmentsOlderThanDays: 90,
        deleteVoiceMessagesOlderThanDays: 7,
      },
    ]);
    expect(forms).toEqual([
      {
        projectId: "p2",
        enabled: true,
        deleteDoneTasksOlderThanDays: 30,
        deleteAttachmentsOlderThanDays: "",
        deleteVoiceMessagesOlderThanDays: "",
      },
      {
        projectId: "p1",
        enabled: false,
        deleteDoneTasksOlderThanDays: "",
        deleteAttachmentsOlderThanDays: 90,
        deleteVoiceMessagesOlderThanDays: 7,
      },
    ]);
  });

  it("should coerce unusable thresholds to the empty (off) value", () => {
    const forms = hydrateRuleForms([
      {
        projectId: "p1",
        deleteDoneTasksOlderThanDays: 0,
        deleteAttachmentsOlderThanDays: 2.5,
        deleteVoiceMessagesOlderThanDays: "7" as never,
      },
    ] as CleanupRuleDto[]);
    expect(forms[0]!).toMatchObject({
      deleteDoneTasksOlderThanDays: "",
      deleteAttachmentsOlderThanDays: "",
      deleteVoiceMessagesOlderThanDays: "",
    });
  });

  it("should drop entries without a project id", () => {
    const forms = hydrateRuleForms([
      { enabled: true },
      { projectId: "p1" },
    ] as CleanupRuleDto[]);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.projectId).toBe("p1");
  });
});

describe("buildRulesPayload", () => {
  it("should omit empty thresholds and keep valid ones", () => {
    const forms: CleanupRuleForm[] = [
      {
        projectId: "p1",
        enabled: true,
        deleteDoneTasksOlderThanDays: 30,
        deleteAttachmentsOlderThanDays: "",
        deleteVoiceMessagesOlderThanDays: 7,
      },
      {
        projectId: "p2",
        enabled: false,
        deleteDoneTasksOlderThanDays: 0,
        deleteAttachmentsOlderThanDays: -3,
        deleteVoiceMessagesOlderThanDays: "",
      },
    ];
    expect(buildRulesPayload(forms)).toEqual({
      rules: [
        {
          projectId: "p1",
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: undefined,
          deleteVoiceMessagesOlderThanDays: 7,
          enabled: true,
        },
        {
          projectId: "p2",
          deleteDoneTasksOlderThanDays: undefined,
          deleteAttachmentsOlderThanDays: undefined,
          deleteVoiceMessagesOlderThanDays: undefined,
          enabled: false,
        },
      ],
    });
  });
});

describe("buildConfirmationLines", () => {
  const labels: Record<string, string> = { p1: "Home", p2: "Work" };
  const projectLabel = (id: string) => labels[id] || id;

  it("should spell out the enabled aspects per project", () => {
    const lines = buildConfirmationLines(
      [
        {
          projectId: "p1",
          enabled: true,
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: 90,
          deleteVoiceMessagesOlderThanDays: "",
        },
      ],
      projectLabel,
    );
    expect(lines).toEqual([
      "Home: every day, delete Done tasks older than 30 days, attachments older than 90 days.",
    ]);
  });

  it("should say a disabled rule deletes nothing", () => {
    const lines = buildConfirmationLines(
      [
        {
          projectId: "p2",
          enabled: false,
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: "",
          deleteVoiceMessagesOlderThanDays: "",
        },
      ],
      projectLabel,
    );
    expect(lines).toEqual([
      "Work: rule saved but disabled — nothing will be deleted.",
    ]);
  });

  it("should say an enabled rule without thresholds deletes nothing yet", () => {
    const lines = buildConfirmationLines(
      [
        {
          projectId: "p1",
          enabled: true,
          deleteDoneTasksOlderThanDays: "",
          deleteAttachmentsOlderThanDays: "",
          deleteVoiceMessagesOlderThanDays: "",
        },
      ],
      projectLabel,
    );
    expect(lines).toEqual([
      "Home: enabled with no threshold yet — nothing will be deleted until a threshold is set.",
    ]);
  });

  it("should fall back to the raw project id without a label", () => {
    const lines = buildConfirmationLines(
      [
        {
          projectId: "p-unknown",
          enabled: false,
          deleteDoneTasksOlderThanDays: "",
          deleteAttachmentsOlderThanDays: "",
          deleteVoiceMessagesOlderThanDays: "",
        },
      ],
      projectLabel,
    );
    expect(lines[0]!).toContain("p-unknown: rule saved but disabled");
  });
});
