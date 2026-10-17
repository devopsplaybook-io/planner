import {
  CleanupInit,
  CleanupPreviewRules,
  CleanupRunOnce,
  CleanupTick,
} from "./CleanupScheduler";
import { SettingsDataGet } from "../settings/SettingsData";
import { ProjectsDataList } from "../projects/ProjectsData";
import { TasksDataDelete } from "../tasks/TasksData";
import {
  CleanupDataDeleteTaskAttachment,
  CleanupDataListDoneTasksOlderThan,
  CleanupDataListTaskAttachmentsOlderThan,
} from "./CleanupData";
import * as fs from "fs-extra";

jest.mock("fs-extra");

jest.mock("../settings/SettingsData", () => ({
  SettingsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataList: jest.fn(),
}));

jest.mock("../tasks/TasksData", () => ({
  TasksDataDelete: jest.fn(),
  deleteTaskAttachment: jest.fn(),
}));

jest.mock("./CleanupData", () => ({
  CleanupDataListDoneTasksOlderThan: jest.fn(),
  CleanupDataListTaskAttachmentsOlderThan: jest.fn(),
  CleanupDataDeleteTaskAttachment: jest.fn(),
}));

const NOW = new Date("2026-10-17T12:00:00.000Z");

function mockStoredRules(rules: unknown): void {
  (SettingsDataGet as jest.Mock).mockResolvedValue(
    rules === null ? null : JSON.stringify({ rules }),
  );
}

function mockProjects(...ids: string[]): void {
  (ProjectsDataList as jest.Mock).mockResolvedValue(
    ids.map((id) => ({ id, name: id })),
  );
}

function makeTask(
  id: string,
  status: string,
  dateUpdated: string,
): Record<string, unknown> {
  return { id, projectId: "p1", title: `task-${id}`, status, dateUpdated };
}

function makeAttachment(
  id: string,
  fileName: string,
  dateCreated: string,
): Record<string, unknown> {
  return {
    id,
    taskId: "t1",
    fileName,
    filePath: `/data/attachments/tasks/${id}-${fileName}`,
    dateCreated,
  };
}

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  jest.clearAllMocks();
  (fs.pathExists as jest.Mock).mockResolvedValue(true);
  (fs.remove as jest.Mock).mockResolvedValue(undefined);
  mockProjects("p1");
});

describe("CleanupRunOnce", () => {
  it("should delete nothing when no rules are stored", async () => {
    (SettingsDataGet as jest.Mock).mockResolvedValue(null);
    const summary = await CleanupRunOnce(NOW);
    expect(summary).toEqual({
      projects: 0,
      tasksDeleted: 0,
      attachmentsDeleted: 0,
      voiceMessagesDeleted: 0,
      failures: 0,
    });
    expect(ProjectsDataList).not.toHaveBeenCalled();
    expect(TasksDataDelete).not.toHaveBeenCalled();
  });

  it("should ignore a malformed rules document", async () => {
    (SettingsDataGet as jest.Mock).mockResolvedValue("{not json");
    const summary = await CleanupRunOnce(NOW);
    expect(summary.projects).toBe(0);
    expect(TasksDataDelete).not.toHaveBeenCalled();
  });

  it("should skip disabled rules", async () => {
    mockStoredRules([
      { projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: false },
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(summary.projects).toBe(0);
    expect(CleanupDataListDoneTasksOlderThan).not.toHaveBeenCalled();
  });

  it("should skip rules for projects that no longer exist", async () => {
    mockProjects("p1");
    mockStoredRules([
      { projectId: "p-gone", deleteDoneTasksOlderThanDays: 30, enabled: true },
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(summary.projects).toBe(0);
    expect(CleanupDataListDoneTasksOlderThan).not.toHaveBeenCalled();
  });

  it("should delete exactly the old Done tasks through TasksDataDelete", async () => {
    mockStoredRules([
      { projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: true },
    ]);
    (CleanupDataListDoneTasksOlderThan as jest.Mock).mockResolvedValue([
      makeTask("t-old", "Done", daysAgoIso(40)),
      makeTask("t-recent", "Done", daysAgoIso(5)),
      makeTask("t-open", "To Do", daysAgoIso(400)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(CleanupDataListDoneTasksOlderThan).toHaveBeenCalledWith(
      "p1",
      daysAgoIso(30),
    );
    expect(TasksDataDelete).toHaveBeenCalledTimes(1);
    expect(TasksDataDelete).toHaveBeenCalledWith("t-old");
    expect(summary.tasksDeleted).toBe(1);
  });

  it("should remove the attachment file then delete the row", async () => {
    mockStoredRules([
      { projectId: "p1", deleteAttachmentsOlderThanDays: 90, enabled: true },
    ]);
    const order: string[] = [];
    (fs.remove as jest.Mock).mockImplementation(async () => {
      order.push("file");
    });
    (CleanupDataDeleteTaskAttachment as jest.Mock).mockImplementation(
      async () => {
        order.push("row");
      },
    );
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      makeAttachment("a-old", "report.pdf", daysAgoIso(100)),
      makeAttachment("a-recent", "notes.pdf", daysAgoIso(10)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(fs.remove).toHaveBeenCalledWith(
      "/data/attachments/tasks/a-old-report.pdf",
    );
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledTimes(1);
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledWith("a-old");
    expect(order).toEqual(["file", "row"]);
    expect(summary.attachmentsDeleted).toBe(1);
    expect(summary.voiceMessagesDeleted).toBe(0);
  });

  it("should keep the row and continue when the file removal fails", async () => {
    mockStoredRules([
      { projectId: "p1", deleteAttachmentsOlderThanDays: 90, enabled: true },
    ]);
    (fs.remove as jest.Mock).mockRejectedValueOnce(new Error("EACCES"));
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      makeAttachment("a-stuck", "locked.pdf", daysAgoIso(100)),
      makeAttachment("a-fine", "ok.pdf", daysAgoIso(100)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledTimes(1);
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledWith("a-fine");
    expect(summary.failures).toBe(1);
    expect(summary.attachmentsDeleted).toBe(1);
  });

  it("should self-heal when the file is already missing", async () => {
    mockStoredRules([
      { projectId: "p1", deleteAttachmentsOlderThanDays: 90, enabled: true },
    ]);
    (fs.pathExists as jest.Mock).mockResolvedValue(false);
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      makeAttachment("a-orphan", "gone.pdf", daysAgoIso(100)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(fs.remove).not.toHaveBeenCalled();
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledWith("a-orphan");
    expect(summary.attachmentsDeleted).toBe(1);
    expect(summary.failures).toBe(0);
  });

  it("should touch only audio files for a voice-message-only rule", async () => {
    mockStoredRules([
      {
        projectId: "p1",
        deleteVoiceMessagesOlderThanDays: 30,
        enabled: true,
      },
    ]);
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      makeAttachment("a-voice", "voice.webm", daysAgoIso(60)),
      makeAttachment("a-doc", "doc.pdf", daysAgoIso(60)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledTimes(1);
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledWith("a-voice");
    expect(summary.voiceMessagesDeleted).toBe(1);
    expect(summary.attachmentsDeleted).toBe(0);
  });

  it("should remove an audio attachment covered by both thresholds once", async () => {
    mockStoredRules([
      {
        projectId: "p1",
        deleteAttachmentsOlderThanDays: 90,
        deleteVoiceMessagesOlderThanDays: 30,
        enabled: true,
      },
    ]);
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      makeAttachment("a-voice", "voice.m4a", daysAgoIso(100)),
      makeAttachment("a-doc", "doc.pdf", daysAgoIso(100)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(CleanupDataDeleteTaskAttachment).toHaveBeenCalledTimes(2);
    expect(summary.voiceMessagesDeleted).toBe(1);
    expect(summary.attachmentsDeleted).toBe(1);
  });

  it("should log a one-line count-only summary", async () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    mockStoredRules([
      { projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: true },
    ]);
    (CleanupDataListDoneTasksOlderThan as jest.Mock).mockResolvedValue([
      makeTask("t-old", "Done", daysAgoIso(40)),
    ]);
    await CleanupRunOnce(NOW);
    const line = infoSpy.mock.calls
      .map((args) => String(args[0]))
      .find((msg) => msg.includes("[Cleanup] Run summary"));
    expect(line).toBe(
      "[Cleanup] Run summary: projects=1 tasksDeleted=1 attachmentsDeleted=0 voiceMessagesDeleted=0 failures=0",
    );
    infoSpy.mockRestore();
  });

  it("should be safe to call twice in a row", async () => {
    mockStoredRules([
      { projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: true },
    ]);
    (CleanupDataListDoneTasksOlderThan as jest.Mock).mockResolvedValue([
      makeTask("t-old", "Done", daysAgoIso(40)),
    ]);
    const first = await CleanupRunOnce(NOW);
    const second = await CleanupRunOnce(NOW);
    expect(first).toEqual(second);
    expect(TasksDataDelete).toHaveBeenCalledTimes(2);
  });

  it("should count per-item failures without aborting the run", async () => {
    mockStoredRules([
      { projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: true },
    ]);
    (TasksDataDelete as jest.Mock).mockRejectedValueOnce(
      new Error("delete failed"),
    );
    (CleanupDataListDoneTasksOlderThan as jest.Mock).mockResolvedValue([
      makeTask("t-1", "Done", daysAgoIso(40)),
      makeTask("t-2", "Done", daysAgoIso(50)),
    ]);
    const summary = await CleanupRunOnce(NOW);
    expect(TasksDataDelete).toHaveBeenCalledTimes(2);
    expect(summary.tasksDeleted).toBe(1);
    expect(summary.failures).toBe(1);
  });
});

describe("CleanupPreviewRules", () => {
  it("should list what would be deleted without deleting anything", async () => {
    mockProjects("p1");
    (CleanupDataListDoneTasksOlderThan as jest.Mock).mockResolvedValue([
      makeTask("t-old", "Done", daysAgoIso(40)),
    ]);
    (CleanupDataListTaskAttachmentsOlderThan as jest.Mock).mockResolvedValue([
      makeAttachment("a-voice", "voice.webm", daysAgoIso(100)),
      makeAttachment("a-doc", "doc.pdf", daysAgoIso(100)),
    ]);
    const previews = await CleanupPreviewRules(
      [
        {
          projectId: "p1",
          deleteDoneTasksOlderThanDays: 30,
          deleteAttachmentsOlderThanDays: 90,
          deleteVoiceMessagesOlderThanDays: 30,
          enabled: true,
        },
      ],
      NOW,
    );
    expect(previews).toEqual([
      {
        projectId: "p1",
        taskCount: 1,
        attachmentCount: 1,
        voiceMessageCount: 1,
        taskSamples: [{ id: "t-old", title: "task-t-old", ageDays: 40 }],
        attachmentSamples: [
          {
            id: "a-voice",
            fileName: "voice.webm",
            taskId: "t1",
            isVoiceMessage: true,
            ageDays: 100,
          },
          {
            id: "a-doc",
            fileName: "doc.pdf",
            taskId: "t1",
            isVoiceMessage: false,
            ageDays: 100,
          },
        ],
      },
    ]);
    expect(TasksDataDelete).not.toHaveBeenCalled();
    expect(CleanupDataDeleteTaskAttachment).not.toHaveBeenCalled();
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("should skip disabled rules and unknown projects", async () => {
    mockProjects("p1");
    const previews = await CleanupPreviewRules(
      [
        { projectId: "p1", deleteDoneTasksOlderThanDays: 30, enabled: false },
        { projectId: "p-x", deleteDoneTasksOlderThanDays: 30, enabled: true },
      ],
      NOW,
    );
    expect(previews).toEqual([]);
    expect(CleanupDataListDoneTasksOlderThan).not.toHaveBeenCalled();
  });
});

describe("CleanupTick", () => {
  it("should skip a run while another is in flight", async () => {
    let resolveGet: (value: string | null) => void = () => {};
    (SettingsDataGet as jest.Mock).mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveGet = resolve;
        }),
    );
    const first = CleanupTick();
    const second = CleanupTick();
    expect(SettingsDataGet).toHaveBeenCalledTimes(1);
    resolveGet(null);
    await first;
    await second;
    expect(SettingsDataGet).toHaveBeenCalledTimes(1);
  });

  it("should swallow run failures", async () => {
    (SettingsDataGet as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(CleanupTick()).resolves.toBeUndefined();
  });
});

describe("CleanupInit", () => {
  it("should start the timer once and never twice", () => {
    jest.useFakeTimers();
    try {
      CleanupInit();
      const timersAfterFirst = jest.getTimerCount();
      CleanupInit();
      expect(jest.getTimerCount()).toBe(timersAfterFirst);
      expect(timersAfterFirst).toBe(2); // first run delay + daily interval
    } finally {
      jest.useRealTimers();
    }
  });
});
