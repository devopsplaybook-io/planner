import Fastify from "fastify";
import { FastifyInstance } from "fastify";
import { LabelsRoutes } from "./LabelsRoutes";
import { LabelsDataList } from "./LabelsData";
import { AuthGetUserSession } from "../users/Auth";

jest.mock("./LabelsData", () => ({
  LabelsDataList: jest.fn(async () => []),
}));

jest.mock("../users/Auth", () => ({
  AuthGetUserSession: jest.fn(),
}));

describe("LabelsRoutes", () => {
  let app: FastifyInstance;

  const userSession = {
    isAuthenticated: true,
    userId: "user-1",
    userName: "User",
    role: "user" as const,
  };

  const adminSession = {
    isAuthenticated: true,
    userId: "admin-1",
    userName: "Admin",
    role: "admin" as const,
  };

  beforeAll(async () => {
    app = Fastify();
    await new LabelsRoutes().getRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthGetUserSession as jest.Mock).mockResolvedValue(userSession);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should answer 401 for unauthenticated requests", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue({
      isAuthenticated: false,
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(401);
    expect(LabelsDataList).not.toHaveBeenCalled();
  });

  it("should list the distinct labels with usage counts", async () => {
    (LabelsDataList as jest.Mock).mockResolvedValue([
      { name: "urgent", count: 12 },
      { name: "ui", count: 4 },
      { name: "idea", count: 1 },
    ]);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { name: "urgent", count: 12 },
      { name: "ui", count: 4 },
      { name: "idea", count: 1 },
    ]);
  });

  it("should scope the labels to visible projects for non-admins", async () => {
    await app.inject({ method: "GET", url: "/" });
    expect(LabelsDataList).toHaveBeenCalledWith({
      q: undefined,
      visibleTo: { userId: "user-1" },
    });
  });

  it("should not scope the labels for admins", async () => {
    (AuthGetUserSession as jest.Mock).mockResolvedValue(adminSession);
    await app.inject({ method: "GET", url: "/" });
    expect(LabelsDataList).toHaveBeenCalledWith({
      q: undefined,
      visibleTo: undefined,
    });
  });

  it("should forward the q filter for the autocomplete typeahead", async () => {
    await app.inject({ method: "GET", url: "/?q=urg" });
    expect(LabelsDataList).toHaveBeenCalledWith({
      q: "urg",
      visibleTo: { userId: "user-1" },
    });
  });

  it("should ignore a whitespace-only q", async () => {
    await app.inject({ method: "GET", url: "/?q=%20%20" });
    expect(LabelsDataList).toHaveBeenCalledWith({
      q: undefined,
      visibleTo: { userId: "user-1" },
    });
  });
});
