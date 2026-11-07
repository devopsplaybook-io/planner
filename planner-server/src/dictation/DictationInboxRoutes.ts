import { FastifyInstance, RequestGenericInterface } from "fastify";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs-extra";
import { AuthGetUserSession, AuthRateLimitKey } from "../users/Auth";
import { UsersDataGet } from "../users/UsersData";
import { Task } from "../model/Task";
import { Note } from "../model/Note";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  hasProjectPermission,
  isProjectItemVisible,
  isProjectVisible,
  permissionDeniedMessage,
  projectMutationError,
} from "../projects/ProjectVisibility";
import {
  addComment,
  TasksDataAdd,
  TasksDataGet,
  TasksDataTouch,
  TasksDataUpdate,
} from "../tasks/TasksData";
import { NotesDataAdd } from "../notes/NotesData";
import {
  DictationDataDelete,
  DictationDataGetForUser,
  DictationDataListInbox,
  DictationDataMarkConverted,
  DictationDataCountUnreadSince,
  DictationDataSetArchived,
  DictationJobRecord,
  DictationJobSource,
  DictationJobStatus,
} from "./DictationData";
import { DictationProgress } from "./DictationTypes";
import {
  DictationTelemetryRecordConversion,
} from "./DictationTelemetry";
import { recordTaskUpdate } from "../tasks/TaskUpdates";

const MAX_PREVIEW_CHARS = 200;
const INBOX_DEFAULT_LIMIT = 20;
const INBOX_MAX_LIMIT = 50;
const MAX_CHECKLIST_ITEMS = 25;
const MAX_CHECKLIST_ITEM_CHARS = 200;
const CONVERT_TARGETS = ["task", "note", "comment", "checklist"] as const;
type ConvertTarget = (typeof CONVERT_TARGETS)[number];

export interface DictationInboxItem {
  id: string;
  source: DictationJobSource;
  jobKind: string;
  status: DictationJobStatus;
  stage: string | null;
  preview: string;
  language: string | null;
  audioDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  convertedType: string | null;
  convertedTargetId: string | null;
  progress: { segmentsDone: number; segmentsTotal: number; percent: number };
  error: "failed" | null;
}

/** Plain, bounded two-line preview: never raw markdown or long content. */
export function InboxPreview(record: DictationJobRecord): string {
  const text = record.polishedText || record.rawTranscript || "";
  return text
    .replace(/[#*_`>~[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PREVIEW_CHARS);
}

export function BuildInboxItem(record: DictationJobRecord): DictationInboxItem {
  return {
    id: record.id,
    source: record.source,
    jobKind: record.jobKind,
    status: record.status,
    stage: record.stage,
    preview: InboxPreview(record),
    language: record.language,
    audioDurationMs: record.audioDurationMs,
    createdAt: record.dateCreated,
    updatedAt: record.dateUpdated,
    archivedAt: record.archivedAt,
    convertedType: record.convertedType,
    convertedTargetId: record.convertedTargetId,
    progress: DictationProgress(record.segmentsDone, record.segmentsTotal),
    error: record.status === "error" ? "failed" : null,
  };
}

/** Lines of a transcript become checklist items, bounded in count and size. */
export function SplitChecklistItems(text: string): string[] {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((line) => !!line);
  const items: string[] = [];
  for (const line of lines) {
    if (items.length >= MAX_CHECKLIST_ITEMS) {
      break;
    }
    items.push(line.slice(0, MAX_CHECKLIST_ITEM_CHARS));
  }
  return items;
}

/** Title from an explicit value or the first transcript line. */
export function InboxConvertTitle(
  record: DictationJobRecord,
  explicit: unknown,
): string {
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim().slice(0, 200);
  }
  const text = record.polishedText || record.rawTranscript || "";
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return (firstLine || "Dictation").slice(0, 200);
}

function isConvertTarget(value: unknown): value is ConvertTarget {
  return CONVERT_TARGETS.includes(value as ConvertTarget);
}

function normalizeStatus(value: string | undefined): DictationJobStatus | null {
  return value === "processing" || value === "done" || value === "error"
    ? value
    : null;
}

function normalizeSource(value: string | undefined): DictationJobSource | null {
  return value === "dictation" ||
    value === "inline" ||
    value === "quick_capture" ||
    value === "import" ||
    value === "voice_comment"
    ? (value as DictationJobSource)
    : null;
}

export class DictationInboxRoutes {
  constructor(private rateLimitMax: number) {}

  private async getOwnedJob(
    userId: string,
    jobId: string,
  ): Promise<DictationJobRecord | null> {
    const record = await DictationDataGetForUser(userId, jobId);
    if (!record || Date.parse(record.expiresAt) < Date.now()) {
      return null;
    }
    return record;
  }

  public async getRoutes(fastify: FastifyInstance): Promise<void> {
    const rateLimit = {
      max: this.rateLimitMax,
      timeWindow: "1 hour",
      keyGenerator: (req: Parameters<typeof AuthRateLimitKey>[0]) =>
        AuthRateLimitKey(req),
    };

    // GET /api/dictation/inbox — paginated inbox of the caller
    fastify.get<{
      Querystring: {
        limit?: string;
        offset?: string;
        status?: string;
        source?: string;
        includeArchived?: string;
      };
    }>("/", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      const parsedLimit = parseInt(req.query.limit || "", 10);
      const limit = Number.isFinite(parsedLimit)
        ? Math.max(1, Math.min(INBOX_MAX_LIMIT, parsedLimit))
        : INBOX_DEFAULT_LIMIT;
      const parsedOffset = parseInt(req.query.offset || "", 10);
      const offset = Number.isFinite(parsedOffset)
        ? Math.max(0, parsedOffset)
        : 0;
      const status = normalizeStatus(req.query.status);
      if (req.query.status && !status) {
        return res.status(400).send({ error: "Invalid: status" });
      }
      const source = normalizeSource(req.query.source);
      if (req.query.source && !source) {
        return res.status(400).send({ error: "Invalid: source" });
      }
      const includeArchived =
        req.query.includeArchived === "1" ||
        req.query.includeArchived === "true";
      const page = await DictationDataListInbox(userSession.userId, {
        limit,
        offset,
        status: status ?? undefined,
        source: source ?? undefined,
        includeArchived,
      });
      return res.status(200).send({
        items: page.jobs.map(BuildInboxItem),
        total: page.total,
        hasMore: offset + page.jobs.length < page.total,
      });
    });

    // GET /api/dictation/inbox/badge — unread/processing counts since a time
    fastify.get<{ Querystring: { since?: string } }>(
      "/badge",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const parsed = Date.parse(req.query.since || "");
        const since = Number.isFinite(parsed)
          ? new Date(parsed).toISOString()
          : new Date(0).toISOString();
        const counts = await DictationDataCountUnreadSince(
          userSession.userId,
          since,
        );
        return res.status(200).send(counts);
      },
    );

    // PATCH /api/dictation/inbox/:jobId — archive/unarchive a job
    interface PatchInbox extends RequestGenericInterface {
      Params: { jobId: string };
      Body: { archived?: unknown };
    }
    fastify.patch<PatchInbox>("/:jobId", async (req, res) => {
      const userSession = await AuthGetUserSession(req);
      if (!userSession.isAuthenticated) {
        return res.status(401).send({ error: "Access Denied" });
      }
      if (typeof req.body?.archived !== "boolean") {
        return res.status(400).send({ error: "Missing: archived (boolean)" });
      }
      const record = await this.getOwnedJob(
        userSession.userId,
        req.params.jobId,
      );
      if (!record) {
        return res.status(404).send({ error: "Dictation Job Not Found" });
      }
      const archivedAt = req.body.archived
        ? new Date().toISOString()
        : null;
      await DictationDataSetArchived(
        record.id,
        userSession.userId,
        archivedAt,
      );
      return res.status(200).send({ archived: req.body.archived, archivedAt });
    });

    // DELETE /api/dictation/inbox/:jobId — delete a settled job and its audio
    fastify.delete<{ Params: { jobId: string } }>(
      "/:jobId",
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const record = await this.getOwnedJob(
          userSession.userId,
          req.params.jobId,
        );
        if (!record) {
          return res.status(404).send({ error: "Dictation Job Not Found" });
        }
        if (record.status === "processing") {
          return res
            .status(409)
            .send({ error: "A processing dictation job cannot be deleted" });
        }
        if (record.audioPath) {
          await fs.remove(record.audioPath).catch(() => undefined);
        }
        await DictationDataDelete(record.id, userSession.userId);
        return res.status(200).send({ deleted: true });
      },
    );

    // POST /api/dictation/inbox/:jobId/convert — triage into task/note/...
    interface ConvertBody extends RequestGenericInterface {
      Params: { jobId: string };
      Body: {
        target?: unknown;
        projectId?: unknown;
        taskId?: unknown;
        title?: unknown;
        text?: unknown;
      };
    }
    fastify.post<ConvertBody>(
      "/:jobId/convert",
      { config: { rateLimit } },
      async (req, res) => {
        const userSession = await AuthGetUserSession(req);
        if (!userSession.isAuthenticated) {
          return res.status(401).send({ error: "Access Denied" });
        }
        const target = req.body?.target;
        if (!isConvertTarget(target)) {
          return res.status(400).send({ error: "Invalid: target" });
        }
        const record = await this.getOwnedJob(
          userSession.userId,
          req.params.jobId,
        );
        if (!record) {
          return res.status(404).send({ error: "Dictation Job Not Found" });
        }
        if (record.status !== "done") {
          return res
            .status(409)
            .send({ error: "Only a completed dictation can be converted" });
        }
        if (record.convertedAt) {
          return res
            .status(409)
            .send({ error: "This dictation was already converted" });
        }
        const explicitText =
          typeof req.body?.text === "string" ? req.body.text.trim() : "";
        const text = explicitText || record.polishedText || record.rawTranscript || "";
        if (!text) {
          return res.status(400).send({ error: "Missing: text" });
        }
        const title = InboxConvertTitle(record, req.body?.title);
        const projectId =
          typeof req.body?.projectId === "string"
            ? req.body.projectId.trim()
            : "";
        const taskId =
          typeof req.body?.taskId === "string" ? req.body.taskId.trim() : "";

        try {
          const outcome = await this.convert(
            userSession,
            record,
            target,
            { text, title, projectId, taskId },
          );
          await DictationDataMarkConverted(
            record.id,
            target,
            outcome.targetId,
          );
          DictationTelemetryRecordConversion(target, "ok");
          return res.status(201).send({ type: target, targetId: outcome.targetId });
        } catch (error) {
          const failure = error as Error & { status?: number };
          if (failure.status) {
            DictationTelemetryRecordConversion(target, "error");
            return res
              .status(failure.status)
              .send({ error: failure.message });
          }
          throw error;
        }
      },
    );
  }

  private failure(status: number, message: string): Error {
    const error = new Error(message) as Error & { status?: number };
    error.status = status;
    return error;
  }

  private async convert(
    userSession: Awaited<ReturnType<typeof AuthGetUserSession>>,
    record: DictationJobRecord,
    target: ConvertTarget,
    input: {
      text: string;
      title: string;
      projectId: string;
      taskId: string;
    },
  ): Promise<{ targetId: string }> {
    if (target === "task" || target === "note") {
      if (!input.projectId) {
        throw this.failure(400, "Missing: projectId");
      }
      const project = await ProjectsDataGet(input.projectId);
      if (!project || !isProjectVisible(project, userSession)) {
        throw this.failure(404, "Project Not Found");
      }
      if (project.archived) {
        throw this.failure(400, "Project is archived");
      }
      if (!hasProjectPermission(project, userSession, "update")) {
        throw this.failure(403, permissionDeniedMessage("update"));
      }
      if (target === "task") {
        const task = new Task();
        task.projectId = project.id;
        task.title = input.title;
        task.description = input.text;
        task.status = project.statuses.includes("Todo")
          ? "Todo"
          : project.statuses[0] || task.status;
        task.assignees = [{ userId: userSession.userId }];
        await TasksDataAdd(task);
        await recordTaskUpdate(
          task.id,
          userSession.userId,
          "Created from dictation",
        );
        return { targetId: task.id };
      }
      const note = new Note();
      note.projectId = project.id;
      note.title = input.title;
      note.description = input.text;
      await NotesDataAdd(note);
      return { targetId: note.id };
    }

    if (!input.taskId) {
      throw this.failure(400, "Missing: taskId");
    }
    const task = await TasksDataGet(input.taskId);
    if (!task || !(await isProjectItemVisible(task, userSession))) {
      throw this.failure(404, "Task Not Found");
    }
    const guard = await projectMutationError(
      task.projectId,
      userSession,
      target === "comment" ? "comment" : "update",
    );
    if (guard) {
      throw this.failure(guard.status, guard.error);
    }
    if (target === "comment") {
      const user = await UsersDataGet(userSession.userId);
      await addComment(task.id, {
        id: uuidv4(),
        userId: userSession.userId,
        userName: user?.name,
        text: input.text,
        dateCreated: new Date().toISOString(),
      });
      await TasksDataTouch(task.id);
      await recordTaskUpdate(task.id, userSession.userId, "New comment");
      return { targetId: task.id };
    }
    const items = SplitChecklistItems(input.text);
    if (items.length === 0) {
      throw this.failure(400, "Missing: text");
    }
    task.checklist = [
      ...(task.checklist || []),
      ...items.map((text) => ({ text, done: false })),
    ].slice(0, 200);
    await TasksDataUpdate(task);
    await recordTaskUpdate(task.id, userSession.userId, "Checklist updated");
    return { targetId: task.id };
  }
}