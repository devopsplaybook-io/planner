import { buildListNotesQuery } from "./NotesData";

describe("buildListNotesQuery", () => {
  it("should build an unfiltered query when no filters are set", () => {
    const { sql, params } = buildListNotesQuery({}, "sqlite");
    expect(sql).toBe("SELECT * FROM notes ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should filter by project", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1" },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1"]);
  });

  it("should restrict to visible projects when visibleTo is set", () => {
    const { sql, params } = buildListNotesQuery(
      { visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["user-1"]);
  });

  it("should combine projectId and visibility in order", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "user-1"]);
  });

  it("should quote identifiers for postgres while keeping ? placeholders", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", visibleTo: { userId: "user-1" } },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM notes WHERE "projectId" = ? ' +
        'AND ("projectId" IN (SELECT "id" FROM "projects" WHERE "visibility" = \'public\') ' +
        'OR "projectId" IN (SELECT "projectId" FROM "project_users" WHERE "userId" = ?)) ' +
        'ORDER BY "dateCreated" DESC',
    );
    expect(params).toEqual(["proj-1", "user-1"]);
  });
});

describe("buildListNotesQuery projectIds (subtree)", () => {
  it("should filter by a single project id", () => {
    const { sql, params } = buildListNotesQuery(
      { projectIds: ["proj-1"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId IN (?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1"]);
  });

  it("should build one placeholder per id with params in order", () => {
    const { sql, params } = buildListNotesQuery(
      { projectIds: ["proj-1", "proj-2", "proj-3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId IN (?, ?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "proj-2", "proj-3"]);
  });

  it("should ignore an empty projectIds array", () => {
    const { sql, params } = buildListNotesQuery({ projectIds: [] }, "sqlite");
    expect(sql).toBe("SELECT * FROM notes ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should AND projectId and projectIds when both are set", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", projectIds: ["proj-2", "proj-3"] },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? AND projectId IN (?, ?) ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "proj-2", "proj-3"]);
  });

  it("should combine projectIds with visibility in order", () => {
    const { sql, params } = buildListNotesQuery(
      { projectIds: ["proj-1"], visibleTo: { userId: "user-1" } },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId IN (?) " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "user-1"]);
  });

  it("should quote identifiers for postgres in the IN clause", () => {
    const { sql } = buildListNotesQuery(
      { projectIds: ["proj-1", "proj-2"] },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM notes WHERE "projectId" IN (?, ?) ORDER BY "dateCreated" DESC',
    );
  });
});

describe("buildListNotesQuery search (q)", () => {
  it("should match title or description case-insensitively (sqlite)", () => {
    const { sql, params } = buildListNotesQuery({ q: "meeting" }, "sqlite");
    expect(sql).toBe(
      "SELECT * FROM notes WHERE (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["%meeting%", "%meeting%"]);
  });

  it("should use ILIKE for postgres", () => {
    const { sql, params } = buildListNotesQuery({ q: "meeting" }, "postgres");
    expect(sql).toBe(
      'SELECT * FROM notes WHERE ("title" ILIKE ? ESCAPE \'\\\' OR "description" ILIKE ? ESCAPE \'\\\') ORDER BY "dateCreated" DESC',
    );
    expect(params).toEqual(["%meeting%", "%meeting%"]);
  });

  it("should trim the search term", () => {
    const { params } = buildListNotesQuery({ q: "  meeting  " }, "sqlite");
    expect(params).toEqual(["%meeting%", "%meeting%"]);
  });

  it("should escape LIKE wildcards and the escape character in q", () => {
    const { params } = buildListNotesQuery({ q: "50%_off\\" }, "sqlite");
    expect(params).toEqual(["%50\\%\\_off\\\\%", "%50\\%\\_off\\\\%"]);
  });

  it("should combine q with projectId and visibility in order", () => {
    const { sql, params } = buildListNotesQuery(
      {
        projectId: "proj-1",
        visibleTo: { userId: "user-1" },
        q: "meeting",
      },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? " +
        "AND (projectId IN (SELECT id FROM projects WHERE visibility = 'public') " +
        "OR projectId IN (SELECT projectId FROM project_users WHERE userId = ?)) " +
        "AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY dateCreated DESC",
    );
    expect(params).toEqual(["proj-1", "user-1", "%meeting%", "%meeting%"]);
  });

  it("should ignore an empty or whitespace-only q", () => {
    expect(buildListNotesQuery({ q: "" }, "sqlite").sql).toBe(
      "SELECT * FROM notes ORDER BY dateCreated DESC",
    );
    expect(buildListNotesQuery({ q: "   " }, "sqlite").sql).toBe(
      "SELECT * FROM notes ORDER BY dateCreated DESC",
    );
    expect(buildListNotesQuery({ q: "" }, "sqlite").params).toEqual([]);
  });
});

describe("buildListNotesQuery pagination", () => {
  it("should append LIMIT and OFFSET with params in order (sqlite)", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", limit: 20, offset: 40 },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes WHERE projectId = ? ORDER BY dateCreated DESC LIMIT ? OFFSET ?",
    );
    expect(params).toEqual(["proj-1", 20, 40]);
  });

  it("should append only LIMIT when the offset is zero (sqlite)", () => {
    const { sql, params } = buildListNotesQuery(
      { limit: 1000, offset: 0 },
      "sqlite",
    );
    expect(sql).toBe(
      "SELECT * FROM notes ORDER BY dateCreated DESC LIMIT ?",
    );
    expect(params).toEqual([1000]);
  });

  it("should quote identifiers and keep placeholders (postgres)", () => {
    const { sql, params } = buildListNotesQuery(
      { projectId: "proj-1", limit: 20, offset: 40 },
      "postgres",
    );
    expect(sql).toBe(
      'SELECT * FROM notes WHERE "projectId" = ? ORDER BY "dateCreated" DESC LIMIT ? OFFSET ?',
    );
    expect(params).toEqual(["proj-1", 20, 40]);
  });

  it("should stay unbounded without a limit (backward compatibility)", () => {
    const { sql, params } = buildListNotesQuery({}, "sqlite");
    expect(sql).toBe("SELECT * FROM notes ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });

  it("should ignore a non-positive limit", () => {
    const { sql, params } = buildListNotesQuery(
      { limit: 0, offset: 10 },
      "sqlite",
    );
    expect(sql).toBe("SELECT * FROM notes ORDER BY dateCreated DESC");
    expect(params).toEqual([]);
  });
});
