import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { TaskTemplatesBackfillFromRecurrence } from "./TaskTemplatesBackfill";

jest.mock("../utils/DbUtils", () => ({
  DbUtilsQuerySQL: jest.fn(),
  DbUtilsExecSQL: jest.fn(),
  DbUtilsTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
  DbUtilsGetType: jest.fn(() => "sqlite"),
}));

const mockedQuery = DbUtilsQuerySQL as jest.Mock;
const mockedExec = DbUtilsExecSQL as jest.Mock;
const mockedTransaction = DbUtilsTransaction as jest.Mock;

const SELECT_RECURRING = "SELECT * FROM tasks WHERE recurrence IS NOT NULL";
const ALTER_DROP = "ALTER TABLE tasks DROP COLUMN recurrence";
const METADATA_FLAG_SQL_PREFIX = "INSERT INTO metadata";

function recurringRow(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    projectId: "p1",
    title: "Weekly chore",
    description: "desc",
    status: "To Do",
    priority: "high",
    checklist: JSON.stringify([{ text: "step", done: false }]),
    dueDate: "2026-10-19",
    recurrence: JSON.stringify({ frequency: "daily", interval: 1 }),
    ...fields,
  };
}

function insertCalls(sqlPrefix: string): unknown[][] {
  return mockedExec.mock.calls
    .filter((call) => String(call[0]).startsWith(sqlPrefix))
    .map((call) => call[1] as unknown[]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedQuery.mockReset();
  mockedExec.mockReset();
  mockedTransaction.mockReset().mockImplementation(async (fn) => fn());
  mockedQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT value FROM metadata")) return [];
    if (sql.startsWith('SELECT "name" FROM task_labels')) return [];
    if (sql.startsWith("SELECT name FROM task_labels")) return [];
    if (sql.startsWith('SELECT "userId" FROM task_assignees')) return [];
    if (sql.startsWith("SELECT userId FROM task_assignees")) return [];
    if (sql.startsWith("SELECT COUNT(*)")) return [{ count: 0 }];
    return [];
  });
});

describe("TaskTemplatesBackfillFromRecurrence", () => {
  describe("nothing to convert", () => {
    it("should drop the column and record the flag on a first run", async () => {
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata")) return [];
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      expect(mockedExec).toHaveBeenCalledWith(ALTER_DROP, []);
      expect(insertCalls(METADATA_FLAG_SQL_PREFIX)).toHaveLength(1);
    });

    it("should do nothing when the backfill already ran", async () => {
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata"))
          return [{ value: "done" }];
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      expect(mockedExec).not.toHaveBeenCalledWith(ALTER_DROP, []);
      expect(insertCalls(METADATA_FLAG_SQL_PREFIX)).toHaveLength(0);
    });

    it("should not touch the dropped recurrence column on a later startup", async () => {
      // After the backfill completes the column is gone: re-running the
      // SELECT would crash the startup with "no such column: recurrence"
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata"))
          return [{ value: "done" }];
        if (sql === SELECT_RECURRING) {
          throw new Error("no such column: recurrence");
        }
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      expect(mockedQuery).not.toHaveBeenCalledWith(SELECT_RECURRING);
    });
  });

  describe("converting recurring tasks", () => {
    beforeEach(() => {
      mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.startsWith("SELECT value FROM metadata")) return [];
        if (sql === SELECT_RECURRING) {
          return params ? [] : [recurringRow()];
        }
        if (sql.startsWith("SELECT name FROM task_labels"))
          return [{ name: "bug" }];
        if (sql.startsWith("SELECT userId FROM task_assignees"))
          return [{ userId: "u1" }];
        if (sql.startsWith("SELECT COUNT(*)")) return [{ count: 0 }];
        return [];
      });
    });

    it("should create a template from the task content", async () => {
      await TaskTemplatesBackfillFromRecurrence();
      const inserted = insertCalls("INSERT INTO task_templates")[0];
      expect(inserted[1]).toBe("p1");
      expect(inserted[2]).toBe("Weekly chore");
      expect(inserted[3]).toBe("desc");
      expect(inserted[4]).toBe("high");
      expect(inserted[5]).toBe(JSON.stringify([{ text: "step", done: false }]));
      // Daily rule converts to a midnight cron
      expect(inserted[6]).toBe("0 0 * * *");
      expect(inserted[7]).toBe(0);
      expect(inserted[8]).toBe(0);
    });

    it("should copy the labels and assignees of the source task", async () => {
      await TaskTemplatesBackfillFromRecurrence();
      const templateId = insertCalls("INSERT INTO task_templates")[0][0];
      const label = insertCalls("INSERT INTO task_template_labels")[0];
      expect(label[1]).toBe(templateId);
      expect(label[2]).toBe("bug");
      const assignee = insertCalls(
        "INSERT INTO task_template_assignees",
      )[0];
      expect(assignee[0]).toBe(templateId);
      expect(assignee[1]).toBe("u1");
    });

    it("should seed a run for an open source task", async () => {
      await TaskTemplatesBackfillFromRecurrence();
      const templateId = insertCalls("INSERT INTO task_templates")[0][0];
      const run = insertCalls("INSERT INTO task_template_runs")[0];
      expect(run[1]).toBe(templateId);
      expect(run[2]).toBe("t1");
    });

    it("should not seed a run when the source task is Done", async () => {
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata")) return [];
        if (sql === SELECT_RECURRING)
          return [recurringRow({ status: "Done" })];
        if (sql.startsWith("SELECT name FROM task_labels")) return [];
        if (sql.startsWith("SELECT userId FROM task_assignees")) return [];
        if (sql.startsWith("SELECT COUNT(*)")) return [{ count: 0 }];
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      expect(insertCalls("INSERT INTO task_template_runs")).toHaveLength(0);
    });

    it("should null the recurrence of the converted task in the same transaction", async () => {
      await TaskTemplatesBackfillFromRecurrence();
      expect(mockedTransaction).toHaveBeenCalledTimes(1);
      expect(insertCalls("UPDATE tasks SET recurrence = NULL")[0]).toEqual([
        "t1",
      ]);
    });

    it("should strip the cancelled suffix from the title", async () => {
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata")) return [];
        if (sql === SELECT_RECURRING)
          return [recurringRow({ title: "Water the plants [cancelled]" })];
        if (sql.startsWith("SELECT name FROM task_labels")) return [];
        if (sql.startsWith("SELECT userId FROM task_assignees")) return [];
        if (sql.startsWith("SELECT COUNT(*)")) return [{ count: 0 }];
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      expect(insertCalls("INSERT INTO task_templates")[0][2]).toBe(
        "Water the plants",
      );
    });

    it("should convert rules without a cron equivalent without automation", async () => {
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata")) return [];
        if (sql === SELECT_RECURRING)
          return [
            recurringRow({
              recurrence: JSON.stringify({ frequency: "daily", interval: 2 }),
            }),
            recurringRow({ id: "t2", recurrence: "garbage" }),
          ];
        if (sql.startsWith("SELECT name FROM task_labels")) return [];
        if (sql.startsWith("SELECT userId FROM task_assignees")) return [];
        if (sql.startsWith("SELECT COUNT(*)")) return [{ count: 0 }];
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      const crons = insertCalls("INSERT INTO task_templates").map(
        (call) => call[6],
      );
      expect(crons).toEqual([null, null]);
    });

    it("should drop the column and record the flag when all rows converted", async () => {
      await TaskTemplatesBackfillFromRecurrence();
      expect(mockedExec).toHaveBeenCalledWith(ALTER_DROP, []);
      expect(insertCalls(METADATA_FLAG_SQL_PREFIX)).toHaveLength(1);
    });

    it("should keep converting after one row fails", async () => {
      let calls = 0;
      mockedTransaction.mockImplementation(async (fn) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("db down");
        }
        await fn();
      });
      mockedQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT value FROM metadata")) return [];
        if (sql === SELECT_RECURRING)
          return [
            recurringRow({ id: "t-fail" }),
            recurringRow({ id: "t-ok" }),
          ];
        if (sql.startsWith("SELECT name FROM task_labels")) return [];
        if (sql.startsWith("SELECT userId FROM task_assignees")) return [];
        if (sql.startsWith("SELECT COUNT(*)")) return [{ count: 0 }];
        return [];
      });
      await TaskTemplatesBackfillFromRecurrence();
      const insertedIds = insertCalls("INSERT INTO task_templates").map(
        (call) => call[0],
      );
      expect(insertedIds).toHaveLength(1);
      // The failed task keeps its recurrence; the successful one is nulled
      const nulledIds = insertCalls("UPDATE tasks SET recurrence = NULL").map(
        (call) => call[0],
      );
      expect(nulledIds).toEqual(["t-ok"]);
    });
  });
});
