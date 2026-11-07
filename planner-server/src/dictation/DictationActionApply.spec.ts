import { UserSession } from "../model/UserSession";
import { DictationJobRecord } from "./DictationData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectItemVisible, isProjectVisible, projectMutationError } from "../projects/ProjectVisibility";
import {
  TasksDataAdd,
  TasksDataDelete,
  TasksDataGet,
} from "../tasks/TasksData";
import { NotesDataAdd } from "../notes/NotesData";
import { resolveTaskStatus } from "../tasks/TasksRoutes";
import {
  ApplyDictationActions,
  NormalizeActionSelections,
  ParseStoredActions,
  UndoDictationActions,
} from "./DictationActionApply";
import {
  DictationActionDataInsert,
  DictationActionDataListByRequest,
  DictationActionDataMarkUndone,
} from "./DictationActionData";

jest.mock("./DictationActionData", () => ({
  DictationActionDataInsert: jest.fn(async () => undefined),
  DictationActionDataListByRequest: jest.fn(async () => []),
  DictationActionDataListForJob: jest.fn(async () => []),
  DictationActionDataMarkUndone: jest.fn(async () => undefined),
}));

jest.mock("./DictationTelemetry", () => ({
  DictationTelemetryRecordActionApplied: jest.fn(),
  DictationTelemetryRecordActionUndo: jest.fn(),
}));

jest.mock("./DictationResolution", () => ({
  LoadDictationResolutionContext: jest.fn(async () => ({})),
  BuildActionPreviews: jest.fn((actions) =>
    actions.map((action, index) => ({
      index,
      type: action.type,
      action,
      status: "resolved",
      target: {
        kind: "task",
        id: "task-1",
        label: "Task",
        projectId: "proj-1",
        projectName: "Project",
      },
      candidates: [],
      diff: [],
      resolvedProjectId: action.project || "proj-1",
      resolvedStatus: action.status,
      resolvedTargetId: "task-1",
    })),
  ),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectVisibility", () => ({
  isProjectVisible: jest.fn(() => true),
  isProjectItemVisible: jest.fn(async () => true),
  projectMutationError: jest.fn(async () => null),
}));

jest.mock("../tasks/TasksData", () => ({
  TasksDataAdd: jest.fn(async () => undefined),
  TasksDataGet: jest.fn(),
  TasksDataUpdate: jest.fn(async () => undefined),
  TasksDataDelete: jest.fn(async () => undefined),
  TasksDataTouch: jest.fn(async () => undefined),
  MutateTaskLabels: jest.fn(async () => undefined),
  addAssignee: jest.fn(async () => undefined),
  removeAssignee: jest.fn(async () => undefined),
  addComment: jest.fn(async () => undefined),
  deleteComment: jest.fn(async () => undefined),
  getComment: jest.fn(),
  replaceLabels: jest.fn(async () => undefined),
}));

jest.mock("../notes/NotesData", () => ({
  NotesDataAdd: jest.fn(async () => undefined),
  NotesDataGet: jest.fn(),
  NotesDataUpdate: jest.fn(async () => undefined),
  NotesDataDelete: jest.fn(async () => undefined),
  addNoteComment: jest.fn(async () => undefined),
  deleteNoteComment: jest.fn(async () => undefined),
  getNoteComment: jest.fn(),
}));

jest.mock("../tasktemplates/TaskTemplatesData", () => ({
  TaskTemplatesGet: jest.fn(),
}));

jest.mock("../tasktemplates/TaskTemplatesInstance", () => ({
  createInstanceFromTemplate: jest.fn(),
}));

jest.mock("../tasks/TaskUpdates", () => ({
  recordTaskUpdate: jest.fn(async () => undefined),
}));

jest.mock("../tasks/TasksRoutes", () => ({
  resolveTaskStatus: jest.fn((_project, status) => status || "To Do"),
  validateLabelList: jest.fn((labels: string[]) => labels),
}));

const mockTasksAdd = TasksDataAdd as jest.Mock;
const mockTasksGet = TasksDataGet as jest.Mock;
const mockTasksDelete = TasksDataDelete as jest.Mock;
const mockNotesAdd = NotesDataAdd as jest.Mock;
const mockInsert = DictationActionDataInsert as jest.Mock;
const mockListByRequest = DictationActionDataListByRequest as jest.Mock;
const mockMarkUndone = DictationActionDataMarkUndone as jest.Mock;
const mockResolveTaskStatus = resolveTaskStatus as jest.Mock;

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user",
} as UserSession;

function makeRecord(actions: unknown[]): DictationJobRecord {
  return {
    id: "job-1",
    userId: "user-1",
    source: "dictation",
    status: "done",
    actions,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as DictationJobRecord;
}

describe("NormalizeActionSelections", () => {
  it("should keep only allowlisted overrides and dedupe indices", () => {
    expect(
      NormalizeActionSelections([
        {
          index: 0,
          projectId: "  proj-2 ",
          status: " Done ",
          targetId: "task-2",
          title: " Title ",
          description: " Desc ",
          assigneeIds: ["user-9"],
          unknown: true,
        },
        { index: 0, title: "Duplicate index" },
        { index: -1 },
        { index: "1" },
        { index: "nope" },
        null,
        "x",
      ]),
    ).toEqual([
      {
        index: 0,
        projectId: "proj-2",
        status: "Done",
        targetId: "task-2",
        title: "Title",
        description: "Desc",
      },
      { index: 1 },
    ]);
  });

  it("should return an empty list for a non-array body", () => {
    expect(NormalizeActionSelections(undefined)).toEqual([]);
    expect(NormalizeActionSelections({ index: 0 })).toEqual([]);
  });

  it("should cap the number of selections", () => {
    const raw = Array.from({ length: 15 }, (_, index) => ({ index }));
    expect(NormalizeActionSelections(raw)).toHaveLength(10);
  });
});

describe("ParseStoredActions", () => {
  it("should parse v1 and v2 stored proposals", () => {
    expect(
      ParseStoredActions(
        makeRecord([
          { type: "create_task", title: "Buy milk" },
          { type: "update_task", target: "task-1", changes: { status: "Done" } },
        ]),
      ),
    ).toEqual([
      { type: "create_task", title: "Buy milk", description: "" },
      { type: "update_task", target: "task-1", changes: { status: "Done" } },
    ]);
  });

  it("should return an empty list when nothing is stored", () => {
    expect(ParseStoredActions(makeRecord([]))).toEqual([]);
    expect(
      ParseStoredActions(
        makeRecord(undefined as unknown as unknown[]),
      ),
    ).toEqual([]);
  });
});

describe("ApplyDictationActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ProjectsDataGet as jest.Mock).mockImplementation(async (id: string) => ({
      id,
      statuses: ["To Do", "Done"],
    }));
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    (isProjectItemVisible as jest.Mock).mockResolvedValue(true);
    (projectMutationError as jest.Mock).mockResolvedValue(null);
    mockResolveTaskStatus.mockImplementation(
      (_project, status) => status || "To Do",
    );
    mockTasksGet.mockResolvedValue({
      id: "task-1",
      projectId: "proj-1",
      description: "",
      checklist: [],
      assignees: [],
      labels: [],
    });
    mockListByRequest.mockResolvedValue([]);
  });

  it("should replay the stored outcome for an identical requestId", async () => {
    mockListByRequest.mockResolvedValue([
      {
        actionIndex: 0,
        type: "create_task",
        status: "applied",
        targetId: "task-1",
        error: null,
      },
    ]);
    const outcome = await ApplyDictationActions(
      userSession,
      makeRecord([{ type: "create_task", title: "Buy milk" }]),
      "req-1",
      [{ index: 0 }],
    );
    expect(outcome.alreadyApplied).toBe(true);
    expect(outcome.results).toEqual([
      { index: 0, type: "create_task", status: "applied", targetId: "task-1" },
    ]);
    expect(mockTasksAdd).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("should apply selected actions and report a failure without rollback", async () => {
    mockTasksAdd.mockRejectedValueOnce(new Error("boom"));
    const outcome = await ApplyDictationActions(
      userSession,
      makeRecord([
        { type: "create_task", title: "Fails" },
        { type: "create_note", title: "Succeeds" },
      ]),
      "req-2",
      [{ index: 0 }, { index: 1 }],
    );
    expect(outcome.alreadyApplied).toBe(false);
    expect(outcome.results).toEqual([
      {
        index: 0,
        type: "create_task",
        status: "failed",
        error: "boom",
      },
      {
        index: 1,
        type: "create_note",
        status: "applied",
        targetId: expect.any(String),
      },
    ]);
    expect(mockNotesAdd).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actionIndex: 0, status: "failed" }),
    );
    expect(mockInsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actionIndex: 1, status: "applied" }),
    );
  });

  it("should merge allowlisted overrides and skip unknown indices", async () => {
    const outcome = await ApplyDictationActions(
      userSession,
      makeRecord([{ type: "create_task", title: "Original" }]),
      "req-3",
      [
        { index: 7 },
        {
          index: 0,
          title: "Edited",
          description: "New description",
          projectId: "proj-2",
          status: "Done",
        },
      ],
    );
    expect(outcome.results).toHaveLength(1);
    expect(mockTasksAdd).toHaveBeenCalledTimes(1);
    const task = mockTasksAdd.mock.calls[0][0];
    expect(task.title).toBe("Edited");
    expect(task.description).toBe("New description");
    expect(task.projectId).toBe("proj-2");
    expect(task.status).toBe("Done");
  });

  it("should refuse to write into a project invisible to the caller", async () => {
    (isProjectVisible as jest.Mock).mockReturnValue(false);
    const outcome = await ApplyDictationActions(
      userSession,
      makeRecord([{ type: "create_task", title: "Hidden", project: "proj-2" }]),
      "req-hidden",
      [{ index: 0, projectId: "proj-2" }],
    );
    expect(outcome.results).toEqual([
      {
        index: 0,
        type: "create_task",
        status: "failed",
        error: "Project Not Found",
      },
    ]);
    expect(mockTasksAdd).not.toHaveBeenCalled();
  });

  it("should apply a chosen ambiguous target", async () => {
    mockListByRequest.mockResolvedValue([]);
    await ApplyDictationActions(
      userSession,
      makeRecord([
        {
          type: "append_to_task",
          target: "ambiguous",
          text: "More detail",
        },
      ]),
      "req-4",
      [{ index: 0, targetId: "task-9" }],
    );
    // The merged target is re-resolved: the preview mock yields task-1
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actionIndex: 0, status: "applied" }),
    );
  });
});

describe("UndoDictationActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ProjectsDataGet as jest.Mock).mockResolvedValue({
      id: "proj-1",
      statuses: ["To Do", "Done"],
    });
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    (isProjectItemVisible as jest.Mock).mockResolvedValue(true);
    (projectMutationError as jest.Mock).mockResolvedValue(null);
  });

  it("should undo newest-first, skip failures and already-undone rows", async () => {
    mockListByRequest.mockResolvedValue([
      {
        id: "row-0",
        actionIndex: 0,
        type: "create_task",
        status: "applied",
        targetId: "task-0",
        targetType: "task",
        undoneAt: null,
        beforeJson: '{"kind":"created"}',
      },
      {
        id: "row-1",
        actionIndex: 1,
        type: "create_task",
        status: "failed",
        targetId: null,
        targetType: null,
        undoneAt: null,
        beforeJson: null,
      },
      {
        id: "row-2",
        actionIndex: 2,
        type: "create_task",
        status: "applied",
        targetId: "task-2",
        targetType: "task",
        undoneAt: null,
        beforeJson: '{"kind":"created"}',
      },
      {
        id: "row-3",
        actionIndex: 3,
        type: "create_task",
        status: "applied",
        targetId: "task-3",
        targetType: "task",
        undoneAt: "2026-01-02T00:00:00.000Z",
        beforeJson: '{"kind":"created"}',
      },
    ]);
    mockTasksGet.mockImplementation(async (id: string) => ({
      id,
      projectId: "proj-1",
      title: id,
    }));
    const outcome = await UndoDictationActions(
      userSession,
      "job-1",
      "req-2",
    );
    expect(outcome.results).toEqual([
      {
        index: 3,
        type: "create_task",
        status: "skipped",
        error: "Already undone",
      },
      { index: 2, type: "create_task", status: "undone" },
      {
        index: 1,
        type: "create_task",
        status: "skipped",
        error: "This action was not applied",
      },
      { index: 0, type: "create_task", status: "undone" },
    ]);
    expect(mockTasksDelete.mock.calls.map((call) => call[0])).toEqual([
      "task-2",
      "task-0",
    ]);
    expect(mockMarkUndone).toHaveBeenCalledTimes(2);
  });
});
