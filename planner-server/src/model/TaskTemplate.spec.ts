import { TaskTemplate } from "./TaskTemplate";

describe("TaskTemplate", () => {
  describe("fromJson", () => {
    it("should build a template with defaults from a minimal row", () => {
      const template = TaskTemplate.fromJson({
        projectId: "p1",
        title: "Weekly report",
      });
      expect(template.id).toBeTruthy();
      expect(template.projectId).toBe("p1");
      expect(template.title).toBe("Weekly report");
      expect(template.description).toBe("");
      expect(template.priority).toBe("medium");
      expect(template.scheduleCron).toBeUndefined();
      expect(template.skipIfPreviousNotDone).toBe(false);
      expect(template.addDateToTitle).toBe(false);
      expect(template.checklist).toEqual([]);
      expect(template.assignees).toEqual([]);
      expect(template.comments).toEqual([]);
      expect(template.attachments).toEqual([]);
      expect(template.labels).toEqual([]);
      expect(template.dateCreated).toBeTruthy();
      expect(template.dateUpdated).toBeTruthy();
    });

    it("should parse the flags from sqlite integers (0/1)", () => {
      const template = TaskTemplate.fromJson({
        projectId: "p1",
        title: "T",
        skipIfPreviousNotDone: 1,
        addDateToTitle: 0,
      });
      expect(template.skipIfPreviousNotDone).toBe(true);
      expect(template.addDateToTitle).toBe(false);
    });

    it("should parse the flags from postgres booleans", () => {
      const template = TaskTemplate.fromJson({
        projectId: "p1",
        title: "T",
        skipIfPreviousNotDone: true,
        addDateToTitle: true,
      });
      expect(template.skipIfPreviousNotDone).toBe(true);
      expect(template.addDateToTitle).toBe(true);
    });

    it("should keep the scheduleCron when set", () => {
      const template = TaskTemplate.fromJson({
        projectId: "p1",
        title: "T",
        scheduleCron: "0 9 * * 1",
      });
      expect(template.scheduleCron).toBe("0 9 * * 1");
    });

    it("should parse the checklist from a JSON string", () => {
      const template = TaskTemplate.fromJson({
        projectId: "p1",
        title: "T",
        checklist: JSON.stringify([{ text: "step", done: true }]),
      });
      expect(template.checklist).toEqual([{ text: "step", done: true }]);
    });

    it("should fall back to an empty checklist when the JSON is malformed", () => {
      const template = TaskTemplate.fromJson({
        projectId: "p1",
        title: "T",
        checklist: "not json",
      });
      expect(template.checklist).toEqual([]);
    });

    it("should return null for a null row", () => {
      expect(TaskTemplate.fromJson(null)).toBeNull();
    });
  });

  describe("toTransportJson", () => {
    it("should expose the automation section and arrays directly", () => {
      const template = new TaskTemplate();
      template.projectId = "p1";
      template.title = "T";
      template.scheduleCron = "0 9 * * 1";
      template.skipIfPreviousNotDone = true;
      template.checklist = [{ text: "step", done: false }];
      template.assignees = [{ userId: "u1" }];
      template.comments = [];
      template.attachments = [];
      template.labels = ["urgent"];

      const json = template.toTransportJson();
      expect(json.automation).toEqual({
        scheduleCron: "0 9 * * 1",
        skipIfPreviousNotDone: true,
        addDateToTitle: false,
      });
      expect(json.checklist).toEqual(template.checklist);
      expect(json.assignees).toEqual(template.assignees);
      expect(json.labels).toEqual(template.labels);
    });

    it("should expose a null scheduleCron for unscheduled templates", () => {
      const template = new TaskTemplate();
      template.projectId = "p1";
      template.title = "T";
      expect(template.toTransportJson().automation).toEqual({
        scheduleCron: null,
        skipIfPreviousNotDone: false,
        addDateToTitle: false,
      });
    });
  });
});
