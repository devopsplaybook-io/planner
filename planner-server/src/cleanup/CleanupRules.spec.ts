import {
  CleanupCutoffIso,
  IsAttachmentEligible,
  IsAudioAttachmentFileName,
  IsDoneTaskEligible,
  ParseCleanupRules,
  ValidateCleanupRules,
} from "./CleanupRules";

describe("ParseCleanupRules", () => {
  it("should return an empty list for null, undefined or scalar documents", () => {
    expect(ParseCleanupRules(null)).toEqual([]);
    expect(ParseCleanupRules(undefined)).toEqual([]);
    expect(ParseCleanupRules("garbage")).toEqual([]);
    expect(ParseCleanupRules(42)).toEqual([]);
  });

  it("should accept the canonical document shape", () => {
    const rules = ParseCleanupRules({
      rules: [{ projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: true }],
    });
    expect(rules).toEqual([
      {
        projectId: "p1",
        deleteDoneTasksOlderThanDays: 30,
        deleteAttachmentsOlderThanDays: undefined,
        deleteVoiceMessagesOlderThanDays: undefined,
        enabled: true,
      },
    ]);
  });

  it("should accept a legacy bare array document", () => {
    const rules = ParseCleanupRules([{ projectId: "p1", enabled: true }]);
    expect(rules).toHaveLength(1);
    expect(rules[0].projectId).toBe("p1");
  });

  it("should drop entries that are not usable objects", () => {
    const rules = ParseCleanupRules({
      rules: [null, "x", 42, [], { enabled: true }, { projectId: " " }, { projectId: "p1" }],
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].projectId).toBe("p1");
  });

  it("should default rules to disabled unless enabled is strictly true", () => {
    const rules = ParseCleanupRules({
      rules: [
        { projectId: "p1" },
        { projectId: "p2", enabled: false },
        { projectId: "p3", enabled: "yes" },
        { projectId: "p4", enabled: 1 },
        { projectId: "p5", enabled: true },
      ],
    });
    expect(rules.map((r) => r.enabled)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("should coerce day values to integers >= 1 and disable the aspect otherwise", () => {
    const rules = ParseCleanupRules({
      rules: [
        {
          projectId: "p1",
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: 0,
          deleteVoiceMessagesOlderThanDays: -5,
        },
        {
          projectId: "p2",
          deleteDoneTasksOlderThanDays: 2.5,
          deleteAttachmentsOlderThanDays: "30",
          deleteVoiceMessagesOlderThanDays: 7,
        },
      ],
    });
    expect(rules[0]).toMatchObject({
      deleteDoneTasksOlderThanDays: 30,
      deleteAttachmentsOlderThanDays: undefined,
      deleteVoiceMessagesOlderThanDays: undefined,
    });
    expect(rules[1]).toMatchObject({
      deleteDoneTasksOlderThanDays: undefined,
      deleteAttachmentsOlderThanDays: undefined,
      deleteVoiceMessagesOlderThanDays: 7,
    });
  });
});

describe("IsDoneTaskEligible", () => {
  const cutoff = "2026-10-01T00:00:00.000Z";

  it("should match only Done tasks older than the cutoff", () => {
    expect(
      IsDoneTaskEligible(
        { status: "Done", dateUpdated: "2026-09-01T00:00:00.000Z" },
        cutoff,
      ),
    ).toBe(true);
  });

  it("should never match a non-Done task", () => {
    expect(
      IsDoneTaskEligible(
        { status: "To Do", dateUpdated: "2020-01-01T00:00:00.000Z" },
        cutoff,
      ),
    ).toBe(false);
    expect(
      IsDoneTaskEligible(
        { status: "In Progress", dateUpdated: "2020-01-01T00:00:00.000Z" },
        cutoff,
      ),
    ).toBe(false);
  });

  it("should never match a Done task updated at or after the cutoff", () => {
    expect(
      IsDoneTaskEligible({ status: "Done", dateUpdated: cutoff }, cutoff),
    ).toBe(false);
    expect(
      IsDoneTaskEligible(
        { status: "Done", dateUpdated: "2026-10-02T00:00:00.000Z" },
        cutoff,
      ),
    ).toBe(false);
  });

  it("should not match a Done task without a dateUpdated", () => {
    expect(IsDoneTaskEligible({ status: "Done" }, cutoff)).toBe(false);
  });
});

describe("CleanupCutoffIso", () => {
  it("should subtract the days from the reference instant", () => {
    expect(CleanupCutoffIso(30, "2026-10-17T12:00:00.000Z")).toBe(
      "2026-09-17T12:00:00.000Z",
    );
    expect(CleanupCutoffIso(1, "2026-10-17T00:00:00.000Z")).toBe(
      "2026-10-16T00:00:00.000Z",
    );
  });
});

describe("IsAudioAttachmentFileName", () => {
  it("should recognize the audio extensions", () => {
    for (const name of [
      "voice.webm",
      "memo.m4a",
      "song.MP3",
      "tone.wav",
      "clip.ogg",
      "clip.oga",
      "clip.opus",
      "clip.flac",
      "clip.aac",
    ]) {
      expect(IsAudioAttachmentFileName(name)).toBe(true);
    }
  });

  it("should not treat .mp4 as audio", () => {
    expect(IsAudioAttachmentFileName("video.mp4")).toBe(false);
  });

  it("should not treat documents or extensionless names as audio", () => {
    expect(IsAudioAttachmentFileName("report.pdf")).toBe(false);
    expect(IsAudioAttachmentFileName("noext")).toBe(false);
    expect(IsAudioAttachmentFileName("")).toBe(false);
  });
});

describe("IsAttachmentEligible", () => {
  const cutoff = "2026-10-01T00:00:00.000Z";

  it("should match attachments created before the cutoff", () => {
    expect(
      IsAttachmentEligible(
        { fileName: "a.txt", dateCreated: "2026-09-01T00:00:00.000Z" },
        cutoff,
      ),
    ).toBe(true);
  });

  it("should not match attachments created at or after the cutoff", () => {
    expect(
      IsAttachmentEligible(
        { fileName: "a.txt", dateCreated: cutoff },
        cutoff,
      ),
    ).toBe(false);
  });

  it("should filter to audio files when audioOnly is set", () => {
    expect(
      IsAttachmentEligible(
        { fileName: "voice.webm", dateCreated: "2026-09-01T00:00:00.000Z" },
        cutoff,
        true,
      ),
    ).toBe(true);
    expect(
      IsAttachmentEligible(
        { fileName: "a.txt", dateCreated: "2026-09-01T00:00:00.000Z" },
        cutoff,
        true,
      ),
    ).toBe(false);
  });

  it("should not match attachments without a dateCreated", () => {
    expect(IsAttachmentEligible({ fileName: "a.txt" }, cutoff)).toBe(false);
  });
});

describe("ValidateCleanupRules", () => {
  const projectIds = new Set(["p1", "p2"]);

  it("should reject a non-array body", () => {
    expect(ValidateCleanupRules({}, projectIds).error).toBe(
      "rules must be an array",
    );
  });

  it("should reject unknown projects", () => {
    const { error } = ValidateCleanupRules(
      [{ projectId: "nope", enabled: true }],
      projectIds,
    );
    expect(error).toBe("Unknown project: nope");
  });

  it("should reject non-integer or too-small day thresholds", () => {
    expect(
      ValidateCleanupRules(
        [{ projectId: "p1", deleteDoneTasksOlderThanDays: 0 }],
        projectIds,
      ).error,
    ).toBe("Days for Done tasks must be an integer >= 1");
    expect(
      ValidateCleanupRules(
        [{ projectId: "p1", deleteAttachmentsOlderThanDays: 1.5 }],
        projectIds,
      ).error,
    ).toBe("Days for attachments must be an integer >= 1");
    expect(
      ValidateCleanupRules(
        [{ projectId: "p1", deleteVoiceMessagesOlderThanDays: "7" }],
        projectIds,
      ).error,
    ).toBe("Days for voice messages must be an integer >= 1");
  });

  it("should reject duplicate rules for the same project", () => {
    const { error } = ValidateCleanupRules(
      [
        { projectId: "p1", enabled: true },
        { projectId: "p1", enabled: false },
      ],
      projectIds,
    );
    expect(error).toBe("Duplicate rule for project: p1");
  });

  it("should accept valid rules and default enabled to false", () => {
    const { rules, error } = ValidateCleanupRules(
      [
        { projectId: "p2", deleteDoneTasksOlderThanDays: 30, enabled: true },
        { projectId: "p1" },
      ],
      projectIds,
    );
    expect(error).toBeNull();
    expect(rules).toEqual([
      {
        projectId: "p2",
        deleteDoneTasksOlderThanDays: 30,
        deleteAttachmentsOlderThanDays: undefined,
        deleteVoiceMessagesOlderThanDays: undefined,
        enabled: true,
      },
      {
        projectId: "p1",
        deleteDoneTasksOlderThanDays: undefined,
        deleteAttachmentsOlderThanDays: undefined,
        deleteVoiceMessagesOlderThanDays: undefined,
        enabled: false,
      },
    ]);
  });
});
