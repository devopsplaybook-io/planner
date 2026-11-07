import axios from "axios";
import { Config } from "../Config";
import { Project } from "../model/Project";
import { Task } from "../model/Task";
import { Note } from "../model/Note";
import { UserSession } from "../model/UserSession";
import { ProjectsDataList } from "../projects/ProjectsData";
import { TasksDataList } from "../tasks/TasksData";
import { NotesDataList } from "../notes/NotesData";
import { DictationDataListRecent } from "./DictationData";
import { DictationTelemetryRecordAsk } from "./DictationTelemetry";
import {
  DictationAskDetectIntent,
  DictationAskQuestion,
  DICTATION_ASK_QUESTION_MAX_LENGTH,
} from "./DictationAsk";

jest.mock("axios");
jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataList: jest.fn(),
}));
jest.mock("../tasks/TasksData", () => ({
  TasksDataList: jest.fn(),
}));
jest.mock("../notes/NotesData", () => ({
  NotesDataList: jest.fn(),
}));
jest.mock("./DictationData", () => ({
  DictationDataListRecent: jest.fn(),
}));
jest.mock("./DictationTelemetry", () => ({
  DictationTelemetryRecordAsk: jest.fn(),
}));

const mockProjects = ProjectsDataList as jest.Mock;
const mockTasks = TasksDataList as jest.Mock;
const mockNotes = NotesDataList as jest.Mock;
const mockRecentDictations = DictationDataListRecent as jest.Mock;
const mockTelemetry = DictationTelemetryRecordAsk as jest.Mock;
const mockAxios = axios as jest.Mocked<typeof axios>;

const userSession = {
  isAuthenticated: true,
  userId: "user-1",
  userName: "User",
  role: "user",
} as UserSession;

const projects = [
  { id: "proj-1", name: "Website", statuses: ["To Do", "Done"] },
  { id: "proj-2", name: "Website Redesign", statuses: ["To Do", "Done"] },
] as Project[];

const tasks = [
  {
    id: "task-1",
    title: "Fix login",
    projectId: "proj-1",
    status: "To Do",
    dueDate: undefined,
  },
  {
    id: "task-2",
    title: "Ship docs",
    projectId: "proj-1",
    status: "Done",
    dueDate: undefined,
  },
] as Task[];

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function makeConfig(): Config {
  const config = new Config();
  config.LLM_API_KEY = "";
  config.DICTATION_ASK_TIMEOUT_MS = 2000;
  return config;
}

describe("DictationAskDetectIntent", () => {
  it("should detect the deterministic intents", () => {
    expect(DictationAskDetectIntent("What is due today?")).toBe("due_today");
    expect(DictationAskDetectIntent("Qu'est-ce qui est dû aujourd'hui ?")).toBe(
      "due_today",
    );
    expect(DictationAskDetectIntent("What is due this week?")).toBe(
      "due_this_week",
    );
    expect(DictationAskDetectIntent("Summarize project Website")).toBe(
      "project_summary",
    );
    expect(DictationAskDetectIntent("Show my recent dictations")).toBe(
      "recent_dictations",
    );
    expect(DictationAskDetectIntent("What is the weather?")).toBe("unknown");
  });
});

describe("DictationAskQuestion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProjects.mockResolvedValue(projects);
    mockTasks.mockResolvedValue(tasks);
    mockNotes.mockResolvedValue([
      { id: "note-1", title: "Spec", projectId: "proj-1" },
    ] as Note[]);
    mockRecentDictations.mockResolvedValue([]);
  });

  it("should answer tasks due today without writing anything", async () => {
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "What is due today?",
    );
    expect(answer.intent).toBe("due_today");
    expect(answer.generatedBy).toBe("deterministic");
    expect(answer.answer).toBe("1 open task is due today.");
    expect(answer.items).toEqual([
      {
        kind: "task",
        id: "task-1",
        title: "Fix login",
        projectId: "proj-1",
        projectName: "Website",
        dueDate: null,
        status: "To Do",
      },
    ]);
    const today = localDate(new Date());
    expect(mockTasks).toHaveBeenCalledWith({
      visibleTo: { userId: "user-1" },
      dueFrom: today,
      dueTo: today,
      limit: 200,
      orderBy: "dueDate",
    });
    expect(mockTelemetry).toHaveBeenCalledWith("due_today", "deterministic");
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  it("should answer tasks due this week up to Sunday", async () => {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "What is due this week?",
    );
    expect(answer.intent).toBe("due_this_week");
    expect(mockTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        dueFrom: localDate(now),
        dueTo: localDate(end),
      }),
    );
  });

  it("should summarize the project named in the question", async () => {
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "Summarize the Website Redesign project",
    );
    expect(answer.intent).toBe("project_summary");
    expect(mockTasks).toHaveBeenLastCalledWith({
      visibleTo: { userId: "user-1" },
      projectId: "proj-2",
      limit: 200,
    });
    expect(mockNotes).toHaveBeenLastCalledWith({
      visibleTo: { userId: "user-1" },
      projectId: "proj-2",
      limit: 200,
    });
    expect(answer.answer).toContain('Project "Website Redesign"');
  });

  it("should prefer the explicitly scoped project", async () => {
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "Give me a summary",
      "proj-1",
    );
    expect(answer.intent).toBe("project_summary");
    expect(mockTasks).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "proj-1" }),
    );
  });

  it("should explain when no project matches", async () => {
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "Summarize project Unknown",
    );
    expect(answer.items).toEqual([]);
    expect(answer.answer).toContain("could not find a visible project");
  });

  it("should answer recent dictations recorded yesterday", async () => {
    const now = new Date();
    const yesterday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      10,
      0,
      0,
    );
    const older = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 3,
      10,
      0,
      0,
    );
    mockRecentDictations.mockResolvedValue([
      {
        dateCreated: yesterday.toISOString(),
        rawTranscript: "First line of yesterday",
        polishedText: null,
      },
      {
        dateCreated: older.toISOString(),
        rawTranscript: "Too old",
        polishedText: null,
      },
    ]);
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "Show my recent dictations",
    );
    expect(answer.intent).toBe("recent_dictations");
    expect(answer.answer).toContain("1 dictation yesterday");
    expect(answer.answer).toContain("First line of yesterday");
    expect(answer.answer).not.toContain("Too old");
    expect(answer.items).toEqual([]);
  });

  it("should answer the unknown-intent guidance", async () => {
    const answer = await DictationAskQuestion(
      makeConfig(),
      userSession,
      "What is the weather?",
    );
    expect(answer.intent).toBe("unknown");
    expect(answer.items).toEqual([]);
    expect(answer.answer).toContain("tasks due today");
  });

  it("should rephrase the deterministic answer with the LLM", async () => {
    const config = makeConfig();
    config.LLM_API_KEY = "test-key";
    mockAxios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: '```json\n{"answer": "You have one task due today."}\n```',
            },
          },
        ],
      },
    });
    const answer = await DictationAskQuestion(
      config,
      userSession,
      "What is due today?",
    );
    expect(answer.generatedBy).toBe("llm");
    expect(answer.answer).toBe("You have one task due today.");
    expect(answer.items).toHaveLength(1);
    expect(mockAxios.post).toHaveBeenCalledWith(
      config.LLM_API_URL,
      expect.objectContaining({
        model: config.LLM_MODEL,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("DATA"),
          }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("What is due today?"),
          }),
        ]),
      }),
      expect.objectContaining({
        timeout: config.DICTATION_ASK_TIMEOUT_MS,
      }),
    );
    expect(mockTelemetry).toHaveBeenCalledWith("due_today", "llm");
  });

  it("should fall back to the deterministic answer when the LLM fails", async () => {
    const config = makeConfig();
    config.LLM_API_KEY = "test-key";
    mockAxios.post.mockRejectedValue(new Error("timeout"));
    const answer = await DictationAskQuestion(
      config,
      userSession,
      "What is due today?",
    );
    expect(answer.generatedBy).toBe("deterministic");
    expect(answer.answer).toBe("1 open task is due today.");
  });

  it("should fall back when the LLM returns invalid JSON", async () => {
    const config = makeConfig();
    config.LLM_API_KEY = "test-key";
    mockAxios.post.mockResolvedValue({
      data: { choices: [{ message: { content: "not json" } }] },
    });
    const answer = await DictationAskQuestion(
      config,
      userSession,
      "What is due today?",
    );
    expect(answer.generatedBy).toBe("deterministic");
  });

  it("should bound the question sent to the LLM", async () => {
    const config = makeConfig();
    config.LLM_API_KEY = "test-key";
    mockAxios.post.mockResolvedValue({
      data: { choices: [{ message: { content: '{"answer":"ok"}' } }] },
    });
    await DictationAskQuestion(
      config,
      userSession,
      `${"x".repeat(800)} what is due today?`,
    );
    const call = mockAxios.post.mock.calls[0];
    const payload = call[1] as {
      messages: { role: string; content: string }[];
    };
    const facts = JSON.parse(payload.messages[1].content) as {
      question: string;
    };
    expect(facts.question.length).toBeLessThanOrEqual(
      DICTATION_ASK_QUESTION_MAX_LENGTH,
    );
  });
});
