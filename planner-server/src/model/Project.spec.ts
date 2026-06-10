import { Project, DEFAULT_STATUSES } from "../model/Project";

describe("Project model", () => {
  describe("DEFAULT_STATUSES", () => {
    it("should contain the expected default statuses", () => {
      expect(DEFAULT_STATUSES).toEqual(["To Do", "In Progress", "Done"]);
    });
  });

  describe("constructor", () => {
    it("should set id, defaults, and statuses", () => {
      const project = new Project();
      expect(project.id).toBeDefined();
      expect(project.description).toBe("");
      expect(project.isDefault).toBe(false);
      expect(project.statuses).toEqual(DEFAULT_STATUSES);
      expect(project.dateCreated).toBeDefined();
    });
  });

  describe("fromJson", () => {
    it("should create a Project from valid JSON", () => {
      const project = Project.fromJson({
        id: "proj-1",
        name: "My Project",
        description: "A test project",
        isDefault: true,
        statuses: ["Backlog", "Active", "Review", "Done"],
      });
      expect(project.id).toBe("proj-1");
      expect(project.name).toBe("My Project");
      expect(project.description).toBe("A test project");
      expect(project.isDefault).toBe(true);
      expect(project.statuses).toEqual(["Backlog", "Active", "Review", "Done"]);
    });

    it("should parse statuses from JSON string", () => {
      const project = Project.fromJson({
        name: "Parsed",
        statuses: '["New","Old"]',
      });
      expect(project.statuses).toEqual(["New", "Old"]);
    });

    it("should fall back to DEFAULT_STATUSES on invalid statuses JSON", () => {
      const project = Project.fromJson({
        name: "Broken",
        statuses: "{not-json}",
      });
      expect(project.statuses).toEqual(DEFAULT_STATUSES);
    });

    it("should return null for null input", () => {
      expect(Project.fromJson(null)).toBeNull();
    });

    it("should treat isDefault as true when it is 1", () => {
      const p1 = Project.fromJson({ name: "n", isDefault: 1 });
      expect(p1.isDefault).toBe(true);

      const p2 = Project.fromJson({ name: "n", isDefault: false });
      expect(p2.isDefault).toBe(false);
    });
  });

  describe("toJson", () => {
    it("should serialize statuses as a JSON string", () => {
      const project = new Project();
      project.name = "Test";
      project.statuses = ["A", "B"];
      const json = project.toJson();
      expect(json.statuses).toBe(JSON.stringify(["A", "B"]));
    });

    it("should include all fields", () => {
      const project = new Project();
      project.name = "Full";
      project.description = "desc";
      project.isDefault = true;

      const json = project.toJson();
      expect(json.id).toBe(project.id);
      expect(json.name).toBe("Full");
      expect(json.description).toBe("desc");
      expect(json.isDefault).toBe(true);
      expect(json.dateCreated).toBe(project.dateCreated);
    });
  });

  describe("toTransportJson", () => {
    it("should keep statuses as an array", () => {
      const project = new Project();
      project.statuses = ["A", "B", "C"];
      const json = project.toTransportJson();
      expect(json.statuses).toEqual(["A", "B", "C"]);
    });
  });
});
