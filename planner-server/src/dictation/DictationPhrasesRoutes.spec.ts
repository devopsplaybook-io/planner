import Fastify, { FastifyInstance } from "fastify";
import { Config } from "../Config";
import { AuthGetUserSession } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectVisible } from "../projects/ProjectVisibility";
import { TaskTemplatesGet } from "../tasktemplates/TaskTemplatesData";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";
import {
  DictationPhrasesAdd,
  DictationPhrasesCountForUser,
  DictationPhrasesDelete,
  DictationPhrasesListForUser,
  DictationPhrasesUpdate,
} from "./DictationPhrasesData";
import { DictationPhrasesRoutes } from "./DictationPhrasesRoutes";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectVisibility", () => ({
  isProjectVisible: jest.fn(() => true),
}));

jest.mock("../tasktemplates/TaskTemplatesData", () => ({
  TaskTemplatesGet: jest.fn(),
}));

jest.mock("../tasks/TasksRoutes", () => ({
  validateLabelList: jest.fn((labels: unknown) =>
    Array.isArray(labels) ? labels.map((label) => String(label).trim()) : [],
  ),
}));

jest.mock("../utils/DbUtils", () => ({
  DbUtilsIsUniqueViolation: jest.fn(() => false),
}));

jest.mock("./DictationPhrasesData", () => ({
  DictationPhrasesListForUser: jest.fn(async () => []),
  DictationPhrasesCountForUser: jest.fn(async () => 0),
  DictationPhrasesAdd: jest.fn(),
  DictationPhrasesUpdate: jest.fn(),
  DictationPhrasesDelete: jest.fn(async () => 1),
}));

describe("DictationPhrasesRoutes", () => {
  let app: FastifyInstance;
  let config: Config;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const storedPhrase = {
    id: "phrase-1",
    userId: "user-1",
    phrase: "new bug report",
    normalizedPhrase: "new bug report",
    projectId: "proj-1",
    templateId: null,
    labels: ["bug"],
    dateCreated: "2026-01-01T00:00:00.000Z",
  };

  beforeAll(async () => {
    config = new Config();
    config.DICTATION_PHRASES_MAX = 2;
    app = Fastify();
    await new DictationPhrasesRoutes(config).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (ProjectsDataGet as jest.Mock).mockResolvedValue({ id: "proj-1" });
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    (TaskTemplatesGet as jest.Mock).mockResolvedValue({
      id: "tpl-1",
      projectId: "proj-1",
    });
    (DbUtilsIsUniqueViolation as jest.Mock).mockReturnValue(false);
    (DictationPhrasesCountForUser as jest.Mock).mockResolvedValue(0);
    (DictationPhrasesListForUser as jest.Mock).mockResolvedValue([]);
    (DictationPhrasesDelete as jest.Mock).mockResolvedValue(1);
    (DictationPhrasesUpdate as jest.Mock).mockResolvedValue(storedPhrase);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 on every endpoint without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/",
          payload: { phrase: "new bug", projectId: "proj-1" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/phrase-1",
          payload: { phrase: "new bug", projectId: "proj-1" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "DELETE", url: "/phrase-1" })).statusCode,
    ).toBe(401);
    expect(DictationPhrasesAdd).not.toHaveBeenCalled();
    expect(DictationPhrasesDelete).not.toHaveBeenCalled();
  });

  it("should list the phrases of the caller without exposing the owner", async () => {
    (DictationPhrasesListForUser as jest.Mock).mockResolvedValue([
      storedPhrase,
    ]);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      phrases: [
        {
          id: "phrase-1",
          phrase: "new bug report",
          projectId: "proj-1",
          templateId: null,
          labels: ["bug"],
          dateCreated: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(DictationPhrasesListForUser).toHaveBeenCalledWith("user-1");
  });

  it("should add a project phrase with normalized input", async () => {
    (DictationPhrasesAdd as jest.Mock).mockResolvedValue(storedPhrase);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        phrase: "  New   Bug Report ",
        projectId: "proj-1",
        labels: ["bug"],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(DictationPhrasesAdd).toHaveBeenCalledWith(
      "user-1",
      { phrase: "New Bug Report", normalizedPhrase: "new bug report" },
      "proj-1",
      null,
      ["bug"],
    );
    expect(res.json().phrase.userId).toBeUndefined();
  });

  it("should add a template phrase", async () => {
    (DictationPhrasesAdd as jest.Mock).mockResolvedValue({
      ...storedPhrase,
      projectId: null,
      templateId: "tpl-1",
      labels: [],
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "new bug report", templateId: "tpl-1" },
    });
    expect(res.statusCode).toBe(201);
    expect(TaskTemplatesGet).toHaveBeenCalledWith("tpl-1");
  });

  it("should reject a phrase without exactly one target", async () => {
    const none = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "new bug report" },
    });
    expect(none.statusCode).toBe(400);
    const both = await app.inject({
      method: "POST",
      url: "/",
      payload: {
        phrase: "new bug report",
        projectId: "proj-1",
        templateId: "tpl-1",
      },
    });
    expect(both.statusCode).toBe(400);
    expect(DictationPhrasesAdd).not.toHaveBeenCalled();
  });

  it("should reject an invalid phrase", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "   ", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(400);
    expect(DictationPhrasesAdd).not.toHaveBeenCalled();
  });

  it("should answer 404 for an invisible project", async () => {
    (isProjectVisible as jest.Mock).mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "new bug report", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(404);
    expect(DictationPhrasesAdd).not.toHaveBeenCalled();
  });

  it("should answer 404 for an unknown template", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "new bug report", templateId: "missing" },
    });
    expect(res.statusCode).toBe(404);
    expect(DictationPhrasesAdd).not.toHaveBeenCalled();
  });

  it("should answer 400 once the phrase cap is reached", async () => {
    (DictationPhrasesCountForUser as jest.Mock).mockResolvedValue(2);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "new bug report", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Phrases limit reached" });
    expect(DictationPhrasesAdd).not.toHaveBeenCalled();
  });

  it("should answer 409 on a duplicate normalized phrase", async () => {
    (DictationPhrasesAdd as jest.Mock).mockRejectedValue(
      new Error("UNIQUE constraint failed"),
    );
    (DbUtilsIsUniqueViolation as jest.Mock).mockReturnValue(true);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { phrase: "new bug report", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("should update a phrase of the caller", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/phrase-1",
      payload: {
        phrase: "new bug report",
        projectId: "proj-1",
        labels: ["bug"],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(DictationPhrasesUpdate).toHaveBeenCalledWith(
      "user-1",
      "phrase-1",
      { phrase: "new bug report", normalizedPhrase: "new bug report" },
      "proj-1",
      null,
      ["bug"],
    );
  });

  it("should answer 404 when updating an unknown phrase", async () => {
    (DictationPhrasesUpdate as jest.Mock).mockResolvedValue(null);
    const res = await app.inject({
      method: "PUT",
      url: "/missing",
      payload: { phrase: "new bug report", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("should delete a phrase of the caller", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/phrase-1",
    });
    expect(res.statusCode).toBe(204);
    expect(DictationPhrasesDelete).toHaveBeenCalledWith("user-1", "phrase-1");
  });

  it("should answer 404 when deleting an unknown phrase", async () => {
    (DictationPhrasesDelete as jest.Mock).mockResolvedValue(0);
    const res = await app.inject({
      method: "DELETE",
      url: "/missing",
    });
    expect(res.statusCode).toBe(404);
  });
});
