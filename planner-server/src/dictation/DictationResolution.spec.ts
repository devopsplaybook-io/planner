import { Project } from "../model/Project";
import { Task } from "../model/Task";
import { Note } from "../model/Note";
import { TaskTemplate } from "../model/TaskTemplate";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { ProjectsDataList } from "../projects/ProjectsData";
import { TasksDataList } from "../tasks/TasksData";
import { NotesDataList } from "../notes/NotesData";
import { TaskTemplatesList } from "../tasktemplates/TaskTemplatesData";
import { UsersDataList } from "../users/UsersData";
import {
  BuildActionPreviews,
  DictationResolutionContext,
  LoadDictationResolutionContext,
  NormalizeEntityText,
} from "./DictationResolution";

jest.mock("./DictationTelemetry", () => ({
  DictationTelemetryRecordActionResolution: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataList: jest.fn(async () => []),
}));

jest.mock("../tasks/TasksData", () => ({
  TasksDataList: jest.fn(async () => []),
}));

jest.mock("../notes/NotesData", () => ({
  NotesDataList: jest.fn(async () => []),
}));

jest.mock("../tasktemplates/TaskTemplatesData", () => ({
  TaskTemplatesList: jest.fn(async () => []),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataList: jest.fn(async () => []),
  UsersDataGet: jest.fn(async () => null),
}));

const mockProjects = ProjectsDataList as jest.Mock;
const mockTasks = TasksDataList as jest.Mock;
const mockNotes = NotesDataList as jest.Mock;
const mockTemplates = TaskTemplatesList as jest.Mock;
const mockUsers = UsersDataList as jest.Mock;

function project(overrides: Partial<Project>): Project {
  const entry = new Project();
  entry.name = "Project";
  return Object.assign(entry, overrides);
}

function task(overrides: Partial<Task>): Task {
  const entry = new Task();
  entry.title = "Task";
  entry.projectId = "proj-1";
  return Object.assign(entry, overrides);
}

function note(overrides: Partial<Note>): Note {
  const entry = new Note();
  entry.title = "Note";
  entry.projectId = "proj-1";
  return Object.assign(entry, overrides);
}

function template(overrides: Partial<TaskTemplate>): TaskTemplate {
  const entry = new TaskTemplate();
  entry.title = "Template";
  entry.projectId = "proj-1";
  return Object.assign(entry, overrides);
}

function user(id: string, name: string): User {
  const entry = new User();
  entry.id = id;
  entry.name = name;
  return entry;
}

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User One",
  role: "user",
} as UserSession;

function context(
  overrides: Partial<DictationResolutionContext> = {},
): DictationResolutionContext {
  return {
    userSession,
    projects: [project({ id: "proj-1", name: "Work", isDefault: true })],
    tasks: [],
    notes: [],
    templates: [],
    users: [user("user-1", "User One")],
    ...overrides,
  };
}

describe("NormalizeEntityText", () => {
  it("should fold case, accents and punctuation for matching", () => {
    expect(NormalizeEntityText("  Café  Bug-Fix ")).toBe("cafe bug fix");
    expect(NormalizeEntityText("Über_Project")).toBe("uber project");
  });
});

describe("LoadDictationResolutionContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProjects.mockResolvedValue([]);
    mockTasks.mockResolvedValue([]);
    mockNotes.mockResolvedValue([]);
    mockTemplates.mockResolvedValue([]);
    mockUsers.mockResolvedValue([]);
  });

  it("should load only the caller's visible lists for a regular user", async () => {
    await LoadDictationResolutionContext(userSession);
    expect(mockProjects).toHaveBeenCalledWith("user-1");
    expect(mockTasks).toHaveBeenCalledWith({
      visibleTo: { userId: "user-1" },
      limit: 1000,
    });
    expect(mockNotes).toHaveBeenCalledWith({
      visibleTo: { userId: "user-1" },
      limit: 1000,
    });
    expect(mockTemplates).toHaveBeenCalledWith({
      visibleTo: { userId: "user-1" },
    });
  });

  it("should load unrestricted lists for an admin", async () => {
    await LoadDictationResolutionContext({
      ...userSession,
      role: "admin",
    } as UserSession);
    expect(mockProjects).toHaveBeenCalledWith(undefined);
    expect(mockTasks).toHaveBeenCalledWith({
      visibleTo: undefined,
      limit: 1000,
    });
    expect(mockTemplates).toHaveBeenCalledWith({ visibleTo: undefined });
  });
});

describe("BuildActionPreviews", () => {
  it("should resolve a project name case- and accent-insensitively", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_task", title: "Ship it", project: "café ops", status: "Done" }],
      context({
        projects: [
          project({
            id: "proj-1",
            name: "Café Ops",
            statuses: ["To Do", "Done"],
          }),
        ],
      }),
    );
    expect(preview.status).toBe("resolved");
    expect(preview.target).toEqual({
      kind: "project",
      id: "proj-1",
      label: "Café Ops",
      projectId: "proj-1",
      projectName: "Café Ops",
    });
    expect(preview.resolvedProjectId).toBe("proj-1");
    expect(preview.resolvedStatus).toBe("Done");
    expect(preview.diff).toEqual([]);
  });

  it("should not repeat the created values as a before/after diff", () => {
    const previews = BuildActionPreviews(
      [
        { type: "create_task", title: "Ship it", project: "Work" },
        { type: "create_note", title: "Ideas", project: "Work" },
        { type: "instantiate_template", template: "Weekly" },
      ],
      context({
        projects: [project({ id: "proj-1", name: "Work" })],
        templates: [
          template({ id: "tpl-1", title: "Weekly", projectId: "proj-1" }),
        ],
      }),
    );
    expect(previews.map((preview) => preview.status)).toEqual([
      "resolved",
      "resolved",
      "resolved",
    ]);
    expect(previews.map((preview) => preview.diff)).toEqual([[], [], []]);
  });

  it("should use the default project when the action has no project", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_note", title: "Ideas" }],
      context({
        projects: [
          project({ id: "archived", name: "Archived", archived: true }),
          project({ id: "proj-2", name: "Default", isDefault: true }),
        ],
      }),
    );
    expect(preview.status).toBe("resolved");
    expect(preview.resolvedProjectId).toBe("proj-2");
  });

  it("should return candidates when several projects share the name", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_task", title: "A", project: "Website" }],
      context({
        projects: [
          project({ id: "proj-1", name: "Website" }),
          project({ id: "proj-2", name: "Website" }),
        ],
      }),
    );
    expect(preview.status).toBe("ambiguous");
    expect(preview.candidates.map((entry) => entry.id).sort()).toEqual([
      "proj-1",
      "proj-2",
    ]);
    expect(preview.resolvedProjectId).toBeUndefined();
  });

  it("should never resolve a project that is not in the caller's visible list", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_task", title: "Secret", project: "Secret Project" }],
      context({
        projects: [project({ id: "proj-1", name: "Work" })],
      }),
    );
    expect(preview.status).toBe("unresolved");
    expect(preview.candidates).toEqual([]);
    expect(preview.error).toContain('No visible match for "Secret Project"');
    expect(preview.resolvedProjectId).toBeUndefined();
  });

  it("should reject an archived project", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_task", title: "Old", project: "Legacy" }],
      context({
        projects: [project({ id: "proj-1", name: "Legacy", archived: true })],
      }),
    );
    expect(preview.status).toBe("unresolved");
    expect(preview.error).toBe("Project is archived");
  });

  it("should deny a write when the caller only has view access", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_task", title: "Nope", project: "Restricted" }],
      context({
        projects: [
          project({
            id: "proj-1",
            name: "Restricted",
            visibility: "private",
            userAccess: [{ userId: "user-1", permission: "view" }],
          }),
        ],
      }),
    );
    expect(preview.status).toBe("unresolved");
    expect(preview.error).toContain("update permission");
  });

  it("should reject an unknown status", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "create_task", title: "A", project: "Work", status: "Nope" }],
      context(),
    );
    expect(preview.status).toBe("unresolved");
    expect(preview.error).toContain('Unknown status "Nope"');
  });

  it("should fuzzy-match a task and show the before/after diff", () => {
    const [preview] = BuildActionPreviews(
      [
        {
          type: "update_task",
          target: "bug fix",
          changes: { title: "Fix the bug", status: "Done" },
        },
      ],
      context({
        tasks: [
          task({
            id: "task-1",
            title: "Bug fixes",
            status: "To Do",
            projectId: "proj-1",
          }),
        ],
      }),
    );
    expect(preview.status).toBe("resolved");
    expect(preview.target).toEqual({
      kind: "task",
      id: "task-1",
      label: "Bug fixes",
      projectId: "proj-1",
      projectName: "Work",
    });
    expect(preview.resolvedTargetId).toBe("task-1");
    expect(preview.diff).toEqual(
      expect.arrayContaining([
        { field: "title", before: "Bug fixes", after: "Fix the bug" },
        { field: "status", before: "To Do", after: "Done" },
      ]),
    );
  });

  it("should not resolve a task that is not visible to the caller", () => {
    const [preview] = BuildActionPreviews(
      [
        {
          type: "append_to_task",
          target: "Quarterly budget",
          text: "More",
        },
      ],
      context({ tasks: [task({ id: "task-1", title: "My task" })] }),
    );
    expect(preview.status).toBe("unresolved");
    expect(preview.candidates).toEqual([]);
    expect(preview.resolvedTargetId).toBeUndefined();
  });

  it("should return candidates for ambiguous task names", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "add_checklist_items", target: "Release", items: ["a"] }],
      context({
        tasks: [
          task({ id: "task-1", title: "Release", projectId: "proj-1" }),
          task({ id: "task-2", title: "Release", projectId: "proj-1" }),
        ],
      }),
    );
    expect(preview.status).toBe("ambiguous");
    expect(preview.candidates).toHaveLength(2);
  });

  it("should allow a comment on a restricted project with comment access", () => {
    const [preview] = BuildActionPreviews(
      [
        {
          type: "add_comment",
          targetType: "task",
          target: "Review",
          text: "Looks good",
        },
      ],
      context({
        projects: [
          project({
            id: "proj-1",
            name: "Restricted",
            visibility: "private",
            userAccess: [{ userId: "user-1", permission: "comment" }],
          }),
        ],
        tasks: [task({ id: "task-1", title: "Review", projectId: "proj-1" })],
      }),
    );
    expect(preview.status).toBe("resolved");
    expect(preview.diff).toEqual([
      { field: "comment", before: null, after: "Looks good" },
    ]);
  });

  it("should resolve a note by name", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "append_to_note", target: "Meeting notes", text: "More" }],
      context({
        notes: [note({ id: "note-1", title: "Meeting Notes" })],
      }),
    );
    expect(preview.status).toBe("resolved");
    expect(preview.target?.kind).toBe("note");
    expect(preview.resolvedTargetId).toBe("note-1");
  });

  it("should resolve a template and report its project", () => {
    const [preview] = BuildActionPreviews(
      [{ type: "instantiate_template", template: "weekly report" }],
      context({
        templates: [
          template({ id: "tpl-1", title: "Weekly Report", projectId: "proj-1" }),
        ],
      }),
    );
    expect(preview.status).toBe("resolved");
    expect(preview.target?.kind).toBe("template");
    expect(preview.resolvedProjectId).toBe("proj-1");
  });

  it("should mark duplicated assignee names as ambiguous", () => {
    const [preview] = BuildActionPreviews(
      [
        {
          type: "create_task",
          title: "Assign",
          project: "Work",
          assignees: ["Alex"],
        },
      ],
      context({
        users: [user("user-1", "User One"), user("u-2", "Alex"), user("u-3", "Alex")],
      }),
    );
    expect(preview.status).toBe("ambiguous");
    expect(preview.candidates.map((entry) => entry.kind)).toEqual([
      "user",
      "user",
    ]);
    expect(preview.resolvedAssigneeIds).toBeUndefined();
  });

  it("should preview every action independently", () => {
    const previews = BuildActionPreviews(
      [
        { type: "create_task", title: "One", project: "Work" },
        { type: "create_task", title: "Two", project: "Missing" },
        { type: "append_to_note", target: "Ghost", text: "x" },
      ],
      context({ notes: [note({ id: "note-1", title: "Real" })] }),
    );
    expect(previews.map((entry) => entry.status)).toEqual([
      "resolved",
      "unresolved",
      "unresolved",
    ]);
    expect(previews[0].index).toBe(0);
    expect(previews[2].index).toBe(2);
  });
});
