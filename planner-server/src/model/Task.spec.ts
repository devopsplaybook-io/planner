import { Task, TaskComment } from "../model/Task";

describe("Task model", () => {
  describe("constructor", () => {
    it("should set default values", () => {
      const task = new Task();
      expect(task.id).toBeDefined();
      expect(task.description).toBe("");
      expect(task.status).toBe("To Do");
      expect(task.priority).toBe("medium");
      expect(task.checklist).toEqual([]);
      expect(task.assignees).toEqual([]);
      expect(task.comments).toEqual([]);
      expect(task.attachments).toEqual([]);
      expect(task.labels).toEqual([]);
      expect(task.dateCreated).toBeDefined();
      expect(task.dateUpdated).toBeDefined();
    });
  });

  describe("fromJson", () => {
    it("should create a Task from valid JSON", () => {
      const task = Task.fromJson({
        id: "task-1",
        projectId: "proj-1",
        title: "Test task",
        description: "A task",
        status: "In Progress",
        priority: "high",
        dueDate: "2026-01-15",
      });
      expect(task.id).toBe("task-1");
      expect(task.projectId).toBe("proj-1");
      expect(task.title).toBe("Test task");
      expect(task.description).toBe("A task");
      expect(task.status).toBe("In Progress");
      expect(task.priority).toBe("high");
      expect(task.dueDate).toBe("2026-01-15");
    });

    it("should default description and status/priority when missing", () => {
      const task = Task.fromJson({
        projectId: "p1",
        title: "Minimal",
      });
      expect(task.description).toBe("");
      expect(task.status).toBe("To Do");
      expect(task.priority).toBe("medium");
    });

    it("should parse checklist from JSON string", () => {
      const checklistStr = JSON.stringify([
        { text: "Step 1", done: false },
        { text: "Step 2", done: true },
      ]);
      const task = Task.fromJson({
        projectId: "p1",
        title: "With checklist",
        checklist: checklistStr,
      });
      expect(task.checklist).toHaveLength(2);
      expect(task.checklist[0].text).toBe("Step 1");
      expect(task.checklist[0].done).toBe(false);
      expect(task.checklist[1].text).toBe("Step 2");
      expect(task.checklist[1].done).toBe(true);
    });

    it("should return null for null input", () => {
      expect(Task.fromJson(null)).toBeNull();
    });

    it("should parse assignees, comments, attachments, labels as arrays", () => {
      const comment: TaskComment = {
        id: "c1",
        userId: "u1",
        text: "nice",
        dateCreated: "2026-01-01",
      };
      const task = Task.fromJson({
        projectId: "p1",
        title: "Complex",
        assignees: [{ userId: "u1", userName: "Alice" }],
        comments: [comment],
        attachments: [
          {
            id: "a1",
            fileName: "f.txt",
            filePath: "/f",
            dateCreated: "2026-01-01",
          },
        ],
        labels: ["bug", "urgent"],
      });
      expect(task.assignees).toHaveLength(1);
      expect(task.assignees[0].userId).toBe("u1");
      expect(task.comments).toHaveLength(1);
      expect(task.comments[0].text).toBe("nice");
      expect(task.attachments).toHaveLength(1);
      expect(task.attachments[0].fileName).toBe("f.txt");
      expect(task.labels).toEqual(["bug", "urgent"]);
    });
  });

  describe("toJson", () => {
    it("should serialize checklist as JSON string", () => {
      const task = new Task();
      task.projectId = "p1";
      task.title = "Test";
      task.checklist = [{ text: "item", done: false }];
      const json = task.toJson();
      expect(json.checklist).toBe(
        JSON.stringify([{ text: "item", done: false }]),
      );
    });

    it("should include core fields and null for missing dueDate", () => {
      const task = new Task();
      task.projectId = "p1";
      task.title = "Core";
      const json = task.toJson();
      expect(json.id).toBe(task.id);
      expect(json.projectId).toBe("p1");
      expect(json.title).toBe("Core");
      expect(json.description).toBe(task.description);
      expect(json.status).toBe(task.status);
      expect(json.priority).toBe(task.priority);
      expect(json.dueDate).toBeNull();
      expect(json.dateCreated).toBe(task.dateCreated);
      expect(json.dateUpdated).toBe(task.dateUpdated);
    });

    it("should include dueDate when set", () => {
      const task = new Task();
      task.projectId = "p1";
      task.title = "With due date";
      task.dueDate = "2026-06-01";
      const json = task.toJson();
      expect(json.dueDate).toBe("2026-06-01");
    });
  });

  describe("toTransportJson", () => {
    it("should return arrays directly (not stringified)", () => {
      const task = new Task();
      task.projectId = "p1";
      task.title = "Transport";
      task.checklist = [{ text: "x", done: true }];
      task.assignees = [{ userId: "u1" }];
      task.comments = [];
      task.attachments = [];
      task.labels = ["urgent"];
      task.dueDate = "2026-07-01";

      const json = task.toTransportJson();
      expect(json.checklist).toEqual(task.checklist);
      expect(json.assignees).toEqual(task.assignees);
      expect(json.comments).toEqual(task.comments);
      expect(json.attachments).toEqual(task.attachments);
      expect(json.labels).toEqual(task.labels);
      expect(json.dueDate).toBe("2026-07-01");
    });
  });
});
