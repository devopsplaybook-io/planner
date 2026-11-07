import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { Config } from "../Config";
import { DictationVocabularyRoutes } from "./DictationVocabularyRoutes";
import { AuthGetUserSession } from "../users/Auth";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { isProjectVisible } from "../projects/ProjectVisibility";
import { DbUtilsIsUniqueViolation } from "../utils/DbUtils";
import {
  DictationVocabularyAdd,
  DictationVocabularyCountForScope,
  DictationVocabularyCountForUser,
  DictationVocabularyDelete,
  DictationVocabularyListForUser,
  DictationVocabularyReplaceScope,
} from "./DictationVocabularyData";

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("../projects/ProjectVisibility", () => ({
  isProjectVisible: jest.fn(() => true),
}));

jest.mock("../utils/DbUtils", () => ({
  DbUtilsIsUniqueViolation: jest.fn(() => false),
}));

jest.mock("./DictationVocabularyData", () => ({
  NormalizeVocabularyTerm: jest.fn((value: unknown) =>
    typeof value === "string" && value.trim()
      ? {
          term: value.trim(),
          normalizedTerm: value.trim().toLowerCase(),
        }
      : null,
  ),
  DictationVocabularyListForUser: jest.fn(async () => []),
  DictationVocabularyCountForUser: jest.fn(async () => 0),
  DictationVocabularyCountForScope: jest.fn(async () => 0),
  DictationVocabularyAdd: jest.fn(),
  DictationVocabularyDelete: jest.fn(async () => 1),
  DictationVocabularyReplaceScope: jest.fn(async () => []),
}));

describe("DictationVocabularyRoutes", () => {
  let app: FastifyInstance;
  let config: Config;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  beforeAll(async () => {
    config = new Config();
    config.DICTATION_VOCABULARY_MAX = 3;
    app = Fastify();
    await new DictationVocabularyRoutes(config).getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
    (ProjectsDataGet as jest.Mock).mockResolvedValue({ id: "proj-1" });
    (isProjectVisible as jest.Mock).mockReturnValue(true);
    (DbUtilsIsUniqueViolation as jest.Mock).mockReturnValue(false);
    (DictationVocabularyCountForUser as jest.Mock).mockResolvedValue(0);
    (DictationVocabularyCountForScope as jest.Mock).mockResolvedValue(0);
    (DictationVocabularyListForUser as jest.Mock).mockResolvedValue([]);
    (DictationVocabularyDelete as jest.Mock).mockResolvedValue(1);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 on every endpoint without a session", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/",
          payload: { term: "Planner" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/",
          payload: { terms: ["Planner"] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "DELETE", url: "/term-1" })).statusCode,
    ).toBe(401);
    expect(DictationVocabularyAdd).not.toHaveBeenCalled();
    expect(DictationVocabularyDelete).not.toHaveBeenCalled();
  });

  it("should list the vocabulary of the caller", async () => {
    (DictationVocabularyListForUser as jest.Mock).mockResolvedValue([
      { id: "term-1", term: "Planner", projectId: null },
    ]);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      terms: [{ id: "term-1", term: "Planner", projectId: null }],
    });
    expect(DictationVocabularyListForUser).toHaveBeenCalledWith("user-1");
  });

  it("should add a personal term", async () => {
    (DictationVocabularyAdd as jest.Mock).mockResolvedValue({
      id: "term-1",
      term: "Planner",
      projectId: null,
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { term: " Planner " },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      term: { id: "term-1", term: "Planner", projectId: null },
    });
    expect(DictationVocabularyAdd).toHaveBeenCalledWith(
      "user-1",
      null,
      " Planner ",
    );
  });

  it("should add a project term for a visible project", async () => {
    (DictationVocabularyAdd as jest.Mock).mockResolvedValue({
      id: "term-2",
      term: "ArgoCD",
      projectId: "proj-1",
    });
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { term: "ArgoCD", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(201);
    expect(DictationVocabularyAdd).toHaveBeenCalledWith(
      "user-1",
      "proj-1",
      "ArgoCD",
    );
  });

  it("should answer 404 for an invisible project", async () => {
    (isProjectVisible as jest.Mock).mockReturnValue(false);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { term: "ArgoCD", projectId: "proj-1" },
    });
    expect(res.statusCode).toBe(404);
    expect(DictationVocabularyAdd).not.toHaveBeenCalled();
  });

  it("should answer 400 when the term is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(DictationVocabularyAdd).not.toHaveBeenCalled();
  });

  it("should answer 400 once the vocabulary cap is reached", async () => {
    (DictationVocabularyCountForUser as jest.Mock).mockResolvedValue(3);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { term: "Planner" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Vocabulary limit reached" });
    expect(DictationVocabularyAdd).not.toHaveBeenCalled();
  });

  it("should answer 409 for a duplicate term", async () => {
    (DictationVocabularyAdd as jest.Mock).mockRejectedValue(
      new Error("UNIQUE constraint failed"),
    );
    (DbUtilsIsUniqueViolation as jest.Mock).mockReturnValue(true);
    const res = await app.inject({
      method: "POST",
      url: "/",
      payload: { term: "Planner" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("should replace a scope from a plain-text list", async () => {
    (DictationVocabularyReplaceScope as jest.Mock).mockResolvedValue([
      { id: "term-1", term: "Planner", projectId: null },
    ]);
    const res = await app.inject({
      method: "PUT",
      url: "/",
      payload: { terms: [" Planner ", "planner", "Kubernetes"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      terms: [{ id: "term-1", term: "Planner", projectId: null }],
    });
    expect(DictationVocabularyReplaceScope).toHaveBeenCalledWith(
      "user-1",
      null,
      [" Planner ", "planner", "Kubernetes"],
    );
  });

  it("should answer 400 when the terms are not an array", async () => {
    const res = await app.inject({ method: "PUT", url: "/", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(DictationVocabularyReplaceScope).not.toHaveBeenCalled();
  });

  it("should bound a replacement by the vocabulary cap", async () => {
    (DictationVocabularyCountForUser as jest.Mock).mockResolvedValue(2);
    (DictationVocabularyCountForScope as jest.Mock).mockResolvedValue(2);
    const res = await app.inject({
      method: "PUT",
      url: "/",
      payload: { terms: ["a", "b", "c", "d"] },
    });
    expect(res.statusCode).toBe(400);
    expect(DictationVocabularyReplaceScope).not.toHaveBeenCalled();
  });

  it("should allow a replacement that keeps the total under the cap", async () => {
    (DictationVocabularyCountForUser as jest.Mock).mockResolvedValue(2);
    (DictationVocabularyCountForScope as jest.Mock).mockResolvedValue(2);
    const res = await app.inject({
      method: "PUT",
      url: "/",
      payload: { terms: ["a", "b", "c"] },
    });
    expect(res.statusCode).toBe(200);
    expect(DictationVocabularyReplaceScope).toHaveBeenCalled();
  });

  it("should delete a term of the caller", async () => {
    const res = await app.inject({ method: "DELETE", url: "/term-1" });
    expect(res.statusCode).toBe(204);
    expect(DictationVocabularyDelete).toHaveBeenCalledWith(
      "user-1",
      "term-1",
    );
  });

  it("should answer 404 when deleting an unknown term", async () => {
    (DictationVocabularyDelete as jest.Mock).mockResolvedValue(0);
    const res = await app.inject({ method: "DELETE", url: "/missing" });
    expect(res.statusCode).toBe(404);
  });
});
