import { buildAttachmentCopyPath, cloneTaskFrom } from "./TasksClone";
import { Task } from "../model/Task";

describe("cloneTaskFrom", () => {
  function makeSource(): Task {
    const source = new Task();
    source.projectId = "proj-1";
    source.title = "Original title";
    source.description = "Original description";
    source.status = "In Progress";
    source.priority = "high";
    source.dueDate = "2026-10-01";
    source.labels = ["bug", "urgent"];
    source.assignees = [
      { userId: "user-1" },
      { userId: "user-2", userName: "Two" },
    ];
    source.checklist = [{ text: "step", done: true }];
    return source;
  }

  it("should copy the task fields and assign a new id", () => {
    const source = makeSource();
    const clone = cloneTaskFrom(source);

    expect(clone.id).toBeTruthy();
    expect(clone.id).not.toBe(source.id);
    expect(clone.projectId).toBe("proj-1");
    expect(clone.title).toBe("Original title");
    expect(clone.description).toBe("Original description");
    expect(clone.priority).toBe("high");
    expect(clone.dueDate).toBe("2026-10-01");
    expect(clone.labels).toEqual(["bug", "urgent"]);
    expect(clone.assignees).toEqual([{ userId: "user-1" }, { userId: "user-2" }]);
    expect(clone.checklist).toEqual([{ text: "step", done: true }]);
  });

  it("should not copy comments or attachments", () => {
    const source = makeSource();
    source.comments = [
      {
        id: "comment-1",
        userId: "user-1",
        text: "hello",
        dateCreated: "2026-09-01T00:00:00.000Z",
      },
    ];
    source.attachments = [
      {
        id: "att-1",
        fileName: "spec.pdf",
        filePath: "/data/attachments/tasks/att-1.pdf",
        dateCreated: "2026-09-01T00:00:00.000Z",
      },
    ];

    const clone = cloneTaskFrom(source);

    expect(clone.comments).toEqual([]);
    expect(clone.attachments).toEqual([]);
  });

  it("should place the clone in the first status of the project", () => {
    const clone = cloneTaskFrom(makeSource(), "Backlog");
    expect(clone.status).toBe("Backlog");
  });

  it("should keep the source status when no first status is given", () => {
    const clone = cloneTaskFrom(makeSource());
    expect(clone.status).toBe("In Progress");
  });

  it("should deep-copy the checklist and assignees", () => {
    const source = makeSource();
    const clone = cloneTaskFrom(source);

    clone.checklist[0].done = false;
    clone.assignees[0].userId = "user-9";

    expect(source.checklist[0].done).toBe(true);
    expect(source.assignees[0].userId).toBe("user-1");
  });

  it("should tolerate missing collections", () => {
    const source = new Task();
    const clone = cloneTaskFrom(source);
    expect(clone.labels).toEqual([]);
    expect(clone.assignees).toEqual([]);
    expect(clone.checklist).toEqual([]);
  });
});

describe("buildAttachmentCopyPath", () => {
  it("should keep directory and extension but use the new id", () => {
    expect(
      buildAttachmentCopyPath(
        "/data/attachments/tasks/att-1.pdf",
        "att-2",
      ),
    ).toBe("/data/attachments/tasks/att-2.pdf");
  });

  it("should handle files without an extension", () => {
    expect(
      buildAttachmentCopyPath("/data/attachments/tasks/att-1", "att-2"),
    ).toBe("/data/attachments/tasks/att-2");
  });
});
