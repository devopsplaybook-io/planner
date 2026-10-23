import {
  TaskTemplatesSchedulerInit,
  TaskTemplatesSchedulerRefresh,
  TaskTemplatesSchedulerJobs,
  TaskTemplatesSchedulerWaitIdle,
  createScheduledInstance,
} from "./TaskTemplatesScheduler";
import {
  TaskTemplatesGet,
  TaskTemplatesList,
  TaskTemplateRunsGetLast,
} from "./TaskTemplatesData";
import { ProjectsDataGet } from "../projects/ProjectsData";
import { createInstanceFromTemplate } from "./TaskTemplatesInstance";
import { TaskTemplate } from "../model/TaskTemplate";
import { Project } from "../model/Project";

jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ destroy: jest.fn() })),
  validate: jest.fn(() => true),
}));

jest.mock("./TaskTemplatesData", () => ({
  TaskTemplatesGet: jest.fn(),
  TaskTemplatesList: jest.fn(async () => []),
  TaskTemplateRunsGetLast: jest.fn(),
}));

jest.mock("../projects/ProjectsData", () => ({
  ProjectsDataGet: jest.fn(),
}));

jest.mock("./TaskTemplatesInstance", () => ({
  createInstanceFromTemplate: jest.fn(),
}));

import * as cron from "node-cron";

function makeTemplate(fields: Partial<TaskTemplate> = {}): TaskTemplate {
  const template = new TaskTemplate();
  template.projectId = "p1";
  template.title = "T";
  Object.assign(template, fields);
  return template;
}

function makeProject(archived = false): Project {
  const project = new Project();
  project.name = "P";
  project.visibility = "public";
  project.userAccess = [];
  project.statuses = ["To Do", "Done"];
  project.archived = archived;
  return project;
}

async function flushScheduler(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  TaskTemplatesSchedulerJobs().clear();
});

describe("TaskTemplatesSchedulerInit", () => {
  it("should schedule only the templates with a cron automation", async () => {
    (TaskTemplatesList as jest.Mock).mockResolvedValue([
      makeTemplate({ id: "t1", scheduleCron: "0 9 * * 1" }),
      makeTemplate({ id: "t2" }),
    ]);
    await TaskTemplatesSchedulerInit();
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledWith("0 9 * * 1", expect.any(Function));
    expect(TaskTemplatesSchedulerJobs().has("t1")).toBe(true);
    expect(TaskTemplatesSchedulerJobs().has("t2")).toBe(false);
  });
});

describe("TaskTemplatesSchedulerRefresh", () => {
  it("should replace the existing job with a fresh one", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(
      makeTemplate({ id: "t1", scheduleCron: "0 9 * * 1" }),
    );
    TaskTemplatesSchedulerRefresh("t1");
    await flushScheduler();
    const firstJob = TaskTemplatesSchedulerJobs().get("t1");

    (TaskTemplatesGet as jest.Mock).mockResolvedValue(
      makeTemplate({ id: "t1", scheduleCron: "0 10 * * 1" }),
    );
    TaskTemplatesSchedulerRefresh("t1");
    await flushScheduler();

    expect(firstJob.destroy).toHaveBeenCalled();
    expect(cron.schedule).toHaveBeenLastCalledWith(
      "0 10 * * 1",
      expect.any(Function),
    );
    expect(TaskTemplatesSchedulerJobs().get("t1")).not.toBe(firstJob);
  });

  it("should only stop the job when the template is gone", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(
      makeTemplate({ id: "t1", scheduleCron: "0 9 * * 1" }),
    );
    TaskTemplatesSchedulerRefresh("t1");
    await flushScheduler();
    const job = TaskTemplatesSchedulerJobs().get("t1");

    (TaskTemplatesGet as jest.Mock).mockResolvedValue(null);
    TaskTemplatesSchedulerRefresh("t1");
    await flushScheduler();

    expect(job.destroy).toHaveBeenCalled();
    expect(TaskTemplatesSchedulerJobs().has("t1")).toBe(false);
    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });
});

describe("createScheduledInstance", () => {
  it("should create an instance and record the run", async () => {
    const template = makeTemplate({ id: "t1" });
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(template);
    (ProjectsDataGet as jest.Mock).mockResolvedValue(makeProject());
    (createInstanceFromTemplate as jest.Mock).mockResolvedValue({ id: "task-1" });

    const result = await createScheduledInstance("t1");

    expect(result).toBe("task-1");
    expect(createInstanceFromTemplate).toHaveBeenCalledWith(
      template,
      expect.objectContaining({ id: expect.any(String) }),
    );
  });

  it("should skip when the template no longer exists", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(null);
    expect(await createScheduledInstance("gone")).toBeNull();
    expect(createInstanceFromTemplate).not.toHaveBeenCalled();
  });

  it("should skip when the project is missing or archived", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(makeTemplate({ id: "t1" }));
    (ProjectsDataGet as jest.Mock).mockResolvedValue(null);
    expect(await createScheduledInstance("t1")).toBeNull();

    (ProjectsDataGet as jest.Mock).mockResolvedValue(makeProject(true));
    expect(await createScheduledInstance("t1")).toBeNull();

    expect(createInstanceFromTemplate).not.toHaveBeenCalled();
  });

  describe("skip-if-previous-not-done rule", () => {
    beforeEach(() => {
      (TaskTemplatesGet as jest.Mock).mockResolvedValue(
        makeTemplate({ id: "t1", skipIfPreviousNotDone: true }),
      );
      (ProjectsDataGet as jest.Mock).mockResolvedValue(makeProject());
    });

    it("should skip when the previous instance is still open", async () => {
      (TaskTemplateRunsGetLast as jest.Mock).mockResolvedValue({
        taskId: "task-0",
        taskStatus: "In Progress",
        dateCreated: "2026-10-01T00:00:00.000Z",
      });
      expect(await createScheduledInstance("t1")).toBeNull();
      expect(createInstanceFromTemplate).not.toHaveBeenCalled();
    });

    it("should create when the previous instance is Done", async () => {
      (TaskTemplateRunsGetLast as jest.Mock).mockResolvedValue({
        taskId: "task-0",
        taskStatus: "Done",
        dateCreated: "2026-10-01T00:00:00.000Z",
      });
      (createInstanceFromTemplate as jest.Mock).mockResolvedValue({
        id: "task-1",
      });
      expect(await createScheduledInstance("t1")).toBe("task-1");
    });

    it("should create when the previous instance was deleted (status null)", async () => {
      (TaskTemplateRunsGetLast as jest.Mock).mockResolvedValue({
        taskId: "task-0",
        taskStatus: null,
        dateCreated: "2026-10-01T00:00:00.000Z",
      });
      (createInstanceFromTemplate as jest.Mock).mockResolvedValue({
        id: "task-1",
      });
      expect(await createScheduledInstance("t1")).toBe("task-1");
    });

    it("should create when there is no previous run", async () => {
      (TaskTemplateRunsGetLast as jest.Mock).mockResolvedValue(null);
      (createInstanceFromTemplate as jest.Mock).mockResolvedValue({
        id: "task-1",
      });
      expect(await createScheduledInstance("t1")).toBe("task-1");
    });

    it("should not apply the rule when the flag is off", async () => {
      (TaskTemplatesGet as jest.Mock).mockResolvedValue(
        makeTemplate({ id: "t1", skipIfPreviousNotDone: false }),
      );
      (TaskTemplateRunsGetLast as jest.Mock).mockResolvedValue({
        taskId: "task-0",
        taskStatus: "In Progress",
        dateCreated: "2026-10-01T00:00:00.000Z",
      });
      (createInstanceFromTemplate as jest.Mock).mockResolvedValue({
        id: "task-1",
      });
      expect(await createScheduledInstance("t1")).toBe("task-1");
      expect(TaskTemplateRunsGetLast).not.toHaveBeenCalled();
    });
  });
});

describe("per-template serialization", () => {
  function deferred<T = unknown>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("should not register a stale schedule when two refreshes overlap", async () => {
    const firstGet = deferred<TaskTemplate | null>();
    const secondGet = deferred<TaskTemplate | null>();
    (TaskTemplatesGet as jest.Mock)
      .mockReturnValueOnce(firstGet.promise)
      .mockReturnValueOnce(secondGet.promise);

    TaskTemplatesSchedulerRefresh("t1");
    TaskTemplatesSchedulerRefresh("t1");
    await flushScheduler();
    // The second refresh waits for the first one to finish
    expect(TaskTemplatesGet).toHaveBeenCalledTimes(1);

    firstGet.resolve(makeTemplate({ id: "t1", scheduleCron: "0 9 * * 1" }));
    await flushScheduler();
    expect(cron.schedule).toHaveBeenLastCalledWith(
      "0 9 * * 1",
      expect.any(Function),
    );
    expect(TaskTemplatesGet).toHaveBeenCalledTimes(2);

    secondGet.resolve(makeTemplate({ id: "t1", scheduleCron: "0 10 * * 1" }));
    await TaskTemplatesSchedulerWaitIdle();
    expect(cron.schedule).toHaveBeenLastCalledWith(
      "0 10 * * 1",
      expect.any(Function),
    );
    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });

  it("should create one instance for two concurrent ticks with the skip rule", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(
      makeTemplate({ id: "t1", skipIfPreviousNotDone: true }),
    );
    (ProjectsDataGet as jest.Mock).mockResolvedValue(makeProject());
    let created = 0;
    (createInstanceFromTemplate as jest.Mock).mockImplementation(async () => {
      created++;
      return { id: `task-${created}` };
    });
    (TaskTemplateRunsGetLast as jest.Mock).mockImplementation(async () =>
      created === 0
        ? null
        : {
            taskId: "task-1",
            taskStatus: "To Do",
            dateCreated: "2026-10-01T00:00:00.000Z",
          },
    );

    const results = await Promise.all([
      createScheduledInstance("t1"),
      createScheduledInstance("t1"),
    ]);
    await TaskTemplatesSchedulerWaitIdle();

    expect(createInstanceFromTemplate).toHaveBeenCalledTimes(1);
    expect(results).toEqual(["task-1", null]);
    expect(TaskTemplateRunsGetLast).toHaveBeenCalledTimes(2);
  });

  it("should create on every tick when the skip rule is off", async () => {
    (TaskTemplatesGet as jest.Mock).mockResolvedValue(
      makeTemplate({ id: "t1", skipIfPreviousNotDone: false }),
    );
    (ProjectsDataGet as jest.Mock).mockResolvedValue(makeProject());
    let created = 0;
    (createInstanceFromTemplate as jest.Mock).mockImplementation(async () => {
      created++;
      return { id: `task-${created}` };
    });

    const results = await Promise.all([
      createScheduledInstance("t1"),
      createScheduledInstance("t1"),
    ]);
    await TaskTemplatesSchedulerWaitIdle();

    expect(createInstanceFromTemplate).toHaveBeenCalledTimes(2);
    expect(results).toEqual(["task-1", "task-2"]);
  });
});
