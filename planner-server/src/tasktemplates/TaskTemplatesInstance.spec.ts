import {
  buildDatedTitle,
  buildTaskFromTemplate,
  buildTemplateAttachmentCopyPath,
  describeTemplateCron,
} from "./TaskTemplatesInstance";
import { TaskTemplate } from "../model/TaskTemplate";
import { Project } from "../model/Project";

function makeTemplate(): TaskTemplate {
  const template = new TaskTemplate();
  template.projectId = "p1";
  template.title = "Weekly report";
  template.description = "The description";
  template.priority = "high";
  template.checklist = [{ text: "step", done: true }];
  template.labels = ["ops"];
  template.assignees = [{ userId: "u1" }, { userId: "u2", userName: "Two" }];
  template.comments = [
    {
      id: "c1",
      userId: "u1",
      text: "template comment",
      dateCreated: "2026-10-01T00:00:00.000Z",
    },
  ];
  return template;
}

function makeProject(): Project {
  const project = new Project();
  project.name = "P";
  project.visibility = "public";
  project.userAccess = [];
  project.statuses = ["Backlog", "To Do", "Done"];
  return project;
}

describe("buildTaskFromTemplate", () => {
  it("should copy the content and start in the project's first status", () => {
    const task = buildTaskFromTemplate(makeTemplate(), makeProject(), {
      addDateSuffix: false,
    });
    expect(task.id).toBeTruthy();
    expect(task.id).not.toBe(makeTemplate().id);
    expect(task.projectId).toBe("p1");
    expect(task.title).toBe("Weekly report");
    expect(task.description).toBe("The description");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("Backlog");
    expect(task.dueDate).toBeUndefined();
    expect(task.labels).toEqual(["ops"]);
    expect(task.assignees).toEqual([{ userId: "u1" }, { userId: "u2" }]);
    expect(task.checklist).toEqual([{ text: "step", done: true }]);
  });

  it("should not copy the comments or attachments", () => {
    const template = makeTemplate();
    template.attachments = [
      {
        id: "a1",
        fileName: "f.pdf",
        filePath: "/data/attachments/task-templates/a1.pdf",
        dateCreated: "2026-10-01T00:00:00.000Z",
      },
    ];
    const task = buildTaskFromTemplate(template, makeProject(), {
      addDateSuffix: false,
    });
    expect(task.comments).toEqual([]);
    expect(task.attachments).toEqual([]);
  });

  it("should suffix the title with the creation date when enabled", () => {
    const task = buildTaskFromTemplate(makeTemplate(), makeProject(), {
      addDateSuffix: true,
    });
    expect(task.title).toMatch(/^Weekly report \d{4}\.\d{2}\.\d{2}$/);
  });

  it("should fall back to To Do for a project without statuses", () => {
    const project = makeProject();
    project.statuses = [];
    const task = buildTaskFromTemplate(makeTemplate(), project, {
      addDateSuffix: false,
    });
    expect(task.status).toBe("To Do");
  });

  it("should start in the template's instanceStatus when it is a project status", () => {
    const template = makeTemplate();
    template.instanceStatus = "To Do";
    const task = buildTaskFromTemplate(template, makeProject(), {
      addDateSuffix: false,
    });
    expect(task.status).toBe("To Do");
  });

  it("should fall back to the project's first status when instanceStatus is unset", () => {
    const task = buildTaskFromTemplate(makeTemplate(), makeProject(), {
      addDateSuffix: false,
    });
    expect(task.status).toBe("Backlog");
  });

  it("should fall back to the project's first status when instanceStatus is no longer a project status", () => {
    const template = makeTemplate();
    template.instanceStatus = "Removed Status";
    const task = buildTaskFromTemplate(template, makeProject(), {
      addDateSuffix: false,
    });
    expect(task.status).toBe("Backlog");
  });

  it("should not share the checklist and label arrays with the template", () => {
    const template = makeTemplate();
    const task = buildTaskFromTemplate(template, makeProject(), {
      addDateSuffix: false,
    });
    task.checklist[0].done = false;
    task.labels.push("extra");
    expect(template.checklist[0].done).toBe(true);
    expect(template.labels).toEqual(["ops"]);
  });
});

describe("buildTemplateAttachmentCopyPath", () => {
  it("should keep directory and extension but use the new attachment id", () => {
    expect(
      buildTemplateAttachmentCopyPath(
        "/data/attachments/task-templates/att-1.pdf",
        "att-2",
      ),
    ).toBe("/data/attachments/task-templates/att-2.pdf");
  });

  it("should handle files without an extension", () => {
    expect(
      buildTemplateAttachmentCopyPath(
        "/data/attachments/task-templates/att-1",
        "att-2",
      ),
    ).toBe("/data/attachments/task-templates/att-2");
  });
});

describe("buildDatedTitle", () => {
  it("should zero-pad month and day", () => {
    expect(buildDatedTitle("Report", new Date(2026, 0, 5))).toBe(
      "Report 2026.01.05",
    );
    expect(buildDatedTitle("Report", new Date(2026, 9, 17))).toBe(
      "Report 2026.10.17",
    );
  });

  it("should keep the title untouched before the suffix", () => {
    expect(
      buildDatedTitle("Water the plants", new Date(2026, 11, 31)),
    ).toBe("Water the plants 2026.12.31");
  });
});

describe("describeTemplateCron", () => {
  it("should map a daily rule to a midnight cron", () => {
    expect(describeTemplateCron({ frequency: "daily", interval: 1 })).toBe(
      "0 0 * * *",
    );
  });

  it("should map a weekly rule to its sorted unique weekdays", () => {
    expect(
      describeTemplateCron({
        frequency: "weekly",
        interval: 1,
        weekdays: [3, 1, 1],
      }),
    ).toBe("0 0 * * 1,3");
  });

  it("should fall back to the due date weekday for a weekly rule without weekdays", () => {
    // 2026-10-14 is a Wednesday (3)
    expect(
      describeTemplateCron({
        frequency: "weekly",
        interval: 1,
        dueDate: "2026-10-14",
      }),
    ).toBe("0 0 * * 3");
  });

  it("should fall back to Monday when a weekly rule has no weekday information", () => {
    expect(describeTemplateCron({ frequency: "weekly", interval: 1 })).toBe(
      "0 0 * * 1",
    );
  });

  it("should map a monthly rule to the pinned monthDay", () => {
    expect(
      describeTemplateCron({
        frequency: "monthly",
        interval: 1,
        monthDay: 15,
      }),
    ).toBe("0 0 15 * *");
  });

  it("should fall back to the due date day for a monthly rule without monthDay", () => {
    expect(
      describeTemplateCron({
        frequency: "monthly",
        interval: 1,
        dueDate: "2026-10-17",
      }),
    ).toBe("0 0 17 * *");
  });

  it("should fall back to the 1st when a monthly rule has no day information", () => {
    expect(describeTemplateCron({ frequency: "monthly", interval: 1 })).toBe(
      "0 0 1 * *",
    );
  });

  it("should return null for intervals greater than one", () => {
    expect(describeTemplateCron({ frequency: "daily", interval: 2 })).toBeNull();
    expect(
      describeTemplateCron({ frequency: "weekly", interval: 2, weekdays: [1] }),
    ).toBeNull();
    expect(
      describeTemplateCron({ frequency: "monthly", interval: 3, monthDay: 5 }),
    ).toBeNull();
  });

  it("should return null for unknown frequencies", () => {
    expect(describeTemplateCron({ frequency: "yearly", interval: 1 })).toBeNull();
  });

  it("should ignore malformed dates in the fallbacks", () => {
    expect(
      describeTemplateCron({
        frequency: "weekly",
        interval: 1,
        dueDate: "garbage",
      }),
    ).toBe("0 0 * * 1");
    expect(
      describeTemplateCron({
        frequency: "monthly",
        interval: 1,
        dueDate: "17/10/2026",
      }),
    ).toBe("0 0 1 * *");
  });
});
