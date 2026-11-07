import { v4 as uuidv4 } from "uuid";
import { ChecklistItem, Task, TaskComment } from "../model/Task";
import { Note } from "../model/Note";
import { Project } from "../model/Project";
import { UserSession } from "../model/UserSession";
import { DictationJobRecord } from "./DictationData";
import {
  DictationActionProposal,
  MAX_ACTIONS,
  ParseActionProposals,
} from "./DictationLlm";
import {
  BuildActionPreviews,
  DictationActionPreview,
  LoadDictationResolutionContext,
} from "./DictationResolution";
import {
  DictationTelemetryRecordActionApplied,
  DictationTelemetryRecordActionUndo,
} from "./DictationTelemetry";
import { ProjectsDataGet } from "../projects/ProjectsData";
import {
  isProjectItemVisible,
  isProjectVisible,
  projectMutationError,
} from "../projects/ProjectVisibility";
import {
  MutateTaskLabels,
  TasksDataAdd,
  TasksDataDelete,
  TasksDataGet,
  TasksDataTouch,
  TasksDataUpdate,
  addAssignee,
  addComment,
  deleteComment,
  getComment,
  removeAssignee,
  replaceLabels,
} from "../tasks/TasksData";
import {
  NotesDataAdd,
  NotesDataDelete,
  NotesDataGet,
  NotesDataUpdate,
  addNoteComment,
  deleteNoteComment,
  getNoteComment,
} from "../notes/NotesData";
import { TaskTemplatesGet } from "../tasktemplates/TaskTemplatesData";
import { createInstanceFromTemplate } from "../tasktemplates/TaskTemplatesInstance";
import { recordTaskUpdate } from "../tasks/TaskUpdates";
import {
  resolveTaskStatus,
  validateLabelList,
} from "../tasks/TasksRoutes";
import {
  DictationActionDataInsert,
  DictationActionDataListByRequest,
  DictationActionDataMarkUndone,
  DictationAppliedActionRecord,
} from "./DictationActionData";

const MAX_DESCRIPTION_LENGTH = 20000;
const MAX_CHECKLIST_LENGTH = 100;
const MAX_REQUEST_ID_LENGTH = 100;
const MAX_OVERRIDE_LENGTH = 5000;

export interface DictationActionSelection {
  index: number;
  projectId?: string;
  status?: string;
  targetId?: string;
  title?: string;
  description?: string;
}

export interface DictationActionApplyResult {
  index: number;
  type: string;
  status: "applied" | "failed" | "skipped";
  targetId?: string;
  error?: string;
}

export interface DictationActionUndoResult {
  index: number;
  type: string;
  status: "undone" | "failed" | "skipped";
  error?: string;
}

export interface DictationApplyOutcome {
  requestId: string;
  alreadyApplied: boolean;
  results: DictationActionApplyResult[];
}

export interface DictationUndoOutcome {
  requestId: string;
  results: DictationActionUndoResult[];
}

/**
 * Re-parses the actions persisted on a job (v1 rows included) with the strict
 * v2 parser, so apply/preview never trust the stored JSON blindly.
 */
export function ParseStoredActions(
  record: DictationJobRecord,
): DictationActionProposal[] {
  if (!Array.isArray(record.actions) || record.actions.length === 0) {
    return [];
  }
  const parsed = ParseActionProposals(
    JSON.stringify({ actions: record.actions }),
  );
  return parsed || [];
}

function boundedOverride(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
}

/**
 * Validates the client-supplied selection list: only the allowlisted
 * overrides are kept, indices are bounded and de-duplicated. Unknown fields
 * are ignored so the endpoint can never be used as a free-form write API.
 */
export function NormalizeActionSelections(
  raw: unknown,
): DictationActionSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const selections: DictationActionSelection[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const parsed =
      typeof record.index === "number"
        ? Math.floor(record.index)
        : Number.parseInt(String(record.index ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed < 0 || seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    const selection: DictationActionSelection = { index: parsed };
    const projectId = boundedOverride(record.projectId, 200);
    if (projectId) {
      selection.projectId = projectId;
    }
    const status = boundedOverride(record.status, 100);
    if (status) {
      selection.status = status;
    }
    const targetId = boundedOverride(record.targetId, 200);
    if (targetId) {
      selection.targetId = targetId;
    }
    const title = boundedOverride(record.title, 200);
    if (title) {
      selection.title = title;
    }
    if (typeof record.description === "string") {
      selection.description = record.description
        .trim()
        .slice(0, MAX_OVERRIDE_LENGTH);
    }
    selections.push(selection);
    if (selections.length >= MAX_ACTIONS) {
      break;
    }
  }
  return selections;
}

function mergeSelection(
  action: DictationActionProposal,
  selection: DictationActionSelection,
): DictationActionProposal {
  const merged = JSON.parse(JSON.stringify(action)) as DictationActionProposal;
  if (merged.type === "create_task" || merged.type === "create_note") {
    if (selection.projectId) {
      merged.project = selection.projectId;
    }
    if (selection.title) {
      merged.title = selection.title;
    }
    if (selection.description !== undefined) {
      merged.description = selection.description;
    }
    if (selection.status && merged.type === "create_task") {
      merged.status = selection.status;
    }
    return merged;
  }
  if (merged.type === "update_task") {
    if (selection.targetId) {
      merged.target = selection.targetId;
    }
    const changes = { ...merged.changes };
    if (selection.projectId) {
      changes.project = selection.projectId;
    }
    if (selection.status) {
      changes.status = selection.status;
    }
    if (selection.title) {
      changes.title = selection.title;
    }
    if (selection.description !== undefined) {
      changes.description = selection.description;
    }
    merged.changes = changes;
    return merged;
  }
  if (merged.type === "instantiate_template") {
    if (selection.targetId) {
      merged.template = selection.targetId;
    }
    if (selection.title) {
      merged.title = selection.title;
    }
    return merged;
  }
  if (selection.targetId) {
    merged.target = selection.targetId;
  }
  return merged;
}

function revalidate(
  action: DictationActionProposal,
): DictationActionProposal | null {
  const parsed = ParseActionProposals(
    JSON.stringify({ actions: [action] }),
  );
  return parsed && parsed.length === 1 ? parsed[0] : null;
}

function labelsOrThrow(labels: string[] | undefined): string[] {
  if (!labels || labels.length === 0) {
    return [];
  }
  return validateLabelList(labels);
}

async function getVisibleTask(
  id: string,
  userSession: UserSession,
): Promise<Task | null> {
  const task = await TasksDataGet(id);
  if (!task || !(await isProjectItemVisible(task, userSession))) {
    return null;
  }
  return task;
}

async function getVisibleNote(
  id: string,
  userSession: UserSession,
): Promise<Note | null> {
  const note = await NotesDataGet(id);
  if (!note || !(await isProjectItemVisible(note, userSession))) {
    return null;
  }
  return note;
}

async function requireProject(
  projectId: string,
  userSession: UserSession,
  required: "update" | "comment" | "all",
): Promise<Project> {
  const project = await ProjectsDataGet(projectId);
  if (!project || !isProjectVisible(project, userSession)) {
    throw new Error("Project Not Found");
  }
  const guard = await projectMutationError(projectId, userSession, required);
  if (guard) {
    throw new Error(guard.error);
  }
  return project;
}

interface ActionOutcome {
  targetId?: string;
  targetType?: string;
  before?: unknown;
}

async function applyCreateTask(
  preview: DictationActionPreview,
  userId: string,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const projectId = preview.resolvedProjectId;
  if (!projectId) {
    throw new Error("Project Not Found");
  }
  const project = await requireProject(projectId, userSession, "update");
  const assigneeIds =
    preview.resolvedAssigneeIds && preview.resolvedAssigneeIds.length > 0
      ? preview.resolvedAssigneeIds
      : [userId];
  const task = new Task();
  task.projectId = project.id;
  task.title = action.title as string;
  task.description = action.description || "";
  task.status = resolveTaskStatus(project, preview.resolvedStatus);
  task.priority = action.priority || "medium";
  if (action.dueDate) {
    task.dueDate = action.dueDate;
  }
  try {
    task.labels = labelsOrThrow(action.labels);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  task.assignees = assigneeIds.map((id) => ({ userId: id }));
  await TasksDataAdd(task);
  return { targetId: task.id, targetType: "task", before: { kind: "created" } };
}

async function applyCreateNote(
  preview: DictationActionPreview,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const projectId = preview.resolvedProjectId;
  if (!projectId) {
    throw new Error("Project Not Found");
  }
  const project = await requireProject(projectId, userSession, "update");
  const note = new Note();
  note.projectId = project.id;
  note.title = action.title as string;
  note.description = action.description || "";
  try {
    note.labels = labelsOrThrow(action.labels);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  await NotesDataAdd(note);
  return { targetId: note.id, targetType: "note", before: { kind: "created" } };
}

async function applyUpdateTask(
  preview: DictationActionPreview,
  userId: string,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const taskId = preview.resolvedTargetId;
  if (!taskId) {
    throw new Error("Task Not Found");
  }
  const task = await getVisibleTask(taskId, userSession);
  if (!task) {
    throw new Error("Task Not Found");
  }
  let targetProject = await requireProject(
    task.projectId,
    userSession,
    "update",
  );
  const sourceProjectId = task.projectId;
  if (preview.resolvedProjectId && preview.resolvedProjectId !== task.projectId) {
    targetProject = await requireProject(
      preview.resolvedProjectId,
      userSession,
      "update",
    );
    task.projectId = targetProject.id;
  }
  const changes = action.changes || {};
  const before = {
    kind: "task-update",
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate || null,
    projectId: sourceProjectId,
    labels: [...task.labels],
    assignees: task.assignees.map((assignee) => assignee.userId),
    checklist: task.checklist.map((item) => ({ ...item })),
  };
  if (changes.title !== undefined) {
    task.title = changes.title;
  }
  if (changes.description !== undefined) {
    task.description = changes.description;
  }
  if (changes.priority !== undefined) {
    task.priority = changes.priority;
  }
  if (changes.dueDate !== undefined) {
    task.dueDate = changes.dueDate === null ? undefined : changes.dueDate;
  }
  task.status = resolveTaskStatus(
    targetProject,
    preview.resolvedStatus || task.status,
  );
  await TasksDataUpdate(task);
  const addLabels = changes.addLabels || [];
  const removeLabels = changes.removeLabels || [];
  if (addLabels.length > 0 || removeLabels.length > 0) {
    try {
      await MutateTaskLabels(
        task.id,
        labelsOrThrow(addLabels),
        labelsOrThrow(removeLabels),
      );
    } catch (error) {
      throw new Error((error as Error).message);
    }
  }
  for (const id of preview.resolvedAddAssigneeIds || []) {
    if (!task.assignees.some((assignee) => assignee.userId === id)) {
      await addAssignee(task.id, id);
    }
  }
  for (const id of preview.resolvedRemoveAssigneeIds || []) {
    if (task.assignees.some((assignee) => assignee.userId === id)) {
      await removeAssignee(task.id, id);
    }
  }
  await TasksDataTouch(task.id);
  await recordTaskUpdate(task.id, userId, "Task updated (dictation)");
  return { targetId: task.id, targetType: "task", before };
}

function appendText(before: string, text: string): string {
  return before ? `${before}\n\n${text}` : text;
}

async function applyAppend(
  preview: DictationActionPreview,
  userId: string,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const targetId = preview.resolvedTargetId;
  if (!targetId) {
    throw new Error("Target Not Found");
  }
  const text = action.text || "";
  if (action.type === "append_to_task") {
    const task = await getVisibleTask(targetId, userSession);
    if (!task) {
      throw new Error("Task Not Found");
    }
    await requireProject(task.projectId, userSession, "update");
    const combined = appendText(task.description, text);
    if (combined.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error("The description would be too long");
    }
    const before = {
      kind: "task-field",
      id: task.id,
      field: "description",
      before: task.description,
    };
    task.description = combined;
    await TasksDataUpdate(task);
    await recordTaskUpdate(task.id, userId, "Description appended (dictation)");
    return { targetId: task.id, targetType: "task", before };
  }
  const note = await getVisibleNote(targetId, userSession);
  if (!note) {
    throw new Error("Note Not Found");
  }
  await requireProject(note.projectId, userSession, "update");
  const combined = appendText(note.description, text);
  if (combined.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error("The description would be too long");
  }
  const before = {
    kind: "note-field",
    id: note.id,
    field: "description",
    before: note.description,
  };
  note.description = combined;
  await NotesDataUpdate(note);
  return { targetId: note.id, targetType: "note", before };
}

async function applyAddComment(
  preview: DictationActionPreview,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const targetId = preview.resolvedTargetId;
  if (!targetId) {
    throw new Error("Target Not Found");
  }
  const commentId = uuidv4();
  const text = action.text || "";
  const dateCreated = new Date().toISOString();
  if (action.targetType === "note") {
    const note = await getVisibleNote(targetId, userSession);
    if (!note) {
      throw new Error("Note Not Found");
    }
    await requireProject(note.projectId, userSession, "comment");
    await addNoteComment(targetId, {
      id: commentId,
      userId: userSession.userId as string,
      text,
      dateCreated,
    });
    return {
      targetId,
      targetType: "note",
      before: { kind: "comment", targetId, targetType: "note", commentId },
    };
  }
  const task = await getVisibleTask(targetId, userSession);
  if (!task) {
    throw new Error("Task Not Found");
  }
  await requireProject(task.projectId, userSession, "comment");
  const comment: TaskComment = {
    id: commentId,
    userId: userSession.userId as string,
    userName: userSession.userName,
    text,
    dateCreated,
  };
  await addComment(targetId, comment);
  await TasksDataTouch(targetId);
  await recordTaskUpdate(targetId, userSession.userId as string, "New comment");
  return {
    targetId,
    targetType: "task",
    before: { kind: "comment", targetId, targetType: "task", commentId },
  };
}

async function applyChecklist(
  preview: DictationActionPreview,
  userId: string,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const targetId = preview.resolvedTargetId;
  if (!targetId) {
    throw new Error("Task Not Found");
  }
  const task = await getVisibleTask(targetId, userSession);
  if (!task) {
    throw new Error("Task Not Found");
  }
  await requireProject(task.projectId, userSession, "update");
  const items = action.items || [];
  if (task.checklist.length + items.length > MAX_CHECKLIST_LENGTH) {
    throw new Error("The checklist would exceed 100 items");
  }
  const before = {
    kind: "task-field",
    id: task.id,
    field: "checklist",
    before: task.checklist.map((item) => ({ ...item })),
  };
  task.checklist.push(...items.map((text) => ({ text, done: false })));
  await TasksDataUpdate(task);
  await recordTaskUpdate(task.id, userId, "Checklist updated (dictation)");
  return { targetId: task.id, targetType: "task", before };
}

async function applyInstantiateTemplate(
  preview: DictationActionPreview,
  userSession: UserSession,
): Promise<ActionOutcome> {
  const action = preview.action;
  const templateId = preview.target?.id;
  if (!templateId) {
    throw new Error("Template Not Found");
  }
  const template = await TaskTemplatesGet(templateId);
  if (!template) {
    throw new Error("Template Not Found");
  }
  const project = await ProjectsDataGet(template.projectId);
  if (!project || !isProjectVisible(project, userSession)) {
    throw new Error("Project Not Found");
  }
  await requireProject(project.id, userSession, "update");
  const task = await createInstanceFromTemplate(template, project, {
    titleOverride: action.title,
  });
  return {
    targetId: task.id,
    targetType: "task",
    before: { kind: "created" },
  };
}

async function applyOne(
  preview: DictationActionPreview,
  userId: string,
  userSession: UserSession,
): Promise<ActionOutcome> {
  if (preview.status !== "resolved") {
    throw new Error(preview.error || "Action cannot be applied");
  }
  switch (preview.action.type) {
    case "create_task":
      return applyCreateTask(preview, userId, userSession);
    case "create_note":
      return applyCreateNote(preview, userSession);
    case "update_task":
      return applyUpdateTask(preview, userId, userSession);
    case "append_to_task":
    case "append_to_note":
      return applyAppend(preview, userId, userSession);
    case "add_comment":
      return applyAddComment(preview, userSession);
    case "add_checklist_items":
      return applyChecklist(preview, userId, userSession);
    case "instantiate_template":
      return applyInstantiateTemplate(preview, userSession);
    default:
      throw new Error("Unsupported action");
  }
}

function boundedError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "The action could not be applied";
  return message.slice(0, 500);
}

/**
 * Applies the selected proposals of a job, in index order. Every action is
 * independent: a failure is reported for that action only and never rolls
 * back the others. The stored proposal is the source of truth; the client
 * only supplies allowlisted overrides. An identical `requestId` never
 * applies an action twice.
 */
export async function ApplyDictationActions(
  userSession: UserSession,
  record: DictationJobRecord,
  requestId: string,
  selections: DictationActionSelection[],
): Promise<DictationApplyOutcome> {
  const boundedRequestId =
    requestId.trim().slice(0, MAX_REQUEST_ID_LENGTH) || uuidv4();
  const actions = ParseStoredActions(record);
  const existing = await DictationActionDataListByRequest(
    record.id,
    boundedRequestId,
  );
  if (existing.length > 0) {
    return {
      requestId: boundedRequestId,
      alreadyApplied: true,
      results: existing.map((row) => ({
        index: row.actionIndex,
        type: row.type,
        status: row.status,
        targetId: row.targetId || undefined,
        error: row.error || undefined,
      })),
    };
  }

  const context = await LoadDictationResolutionContext(userSession);
  const merged: { index: number; action: DictationActionProposal }[] = [];
  for (const selection of selections) {
    const stored = actions[selection.index];
    if (!stored) {
      continue;
    }
    const selected = revalidate(mergeSelection(stored, selection));
    if (!selected) {
      continue;
    }
    merged.push({ index: selection.index, action: selected });
  }
  const previews = BuildActionPreviews(
    merged.map((entry) => entry.action),
    context,
  );

  const results: DictationActionApplyResult[] = [];
  for (const [position, entry] of merged.entries()) {
    const preview = previews[position];
    const type = entry.action.type;
    try {
      const outcome = await applyOne(
        preview,
        userSession.userId as string,
        userSession,
      );
      await DictationActionDataInsert({
        jobId: record.id,
        userId: userSession.userId as string,
        requestId: boundedRequestId,
        actionIndex: entry.index,
        type,
        status: "applied",
        targetId: outcome.targetId ?? null,
        targetType: outcome.targetType ?? null,
        beforeJson: outcome.before ? JSON.stringify(outcome.before) : null,
      });
      results.push({
        index: entry.index,
        type,
        status: "applied",
        targetId: outcome.targetId,
      });
      DictationTelemetryRecordActionApplied(type, "applied");
    } catch (error) {
      const message = boundedError(error);
      await DictationActionDataInsert({
        jobId: record.id,
        userId: userSession.userId as string,
        requestId: boundedRequestId,
        actionIndex: entry.index,
        type,
        status: "failed",
        error: message,
      });
      results.push({
        index: entry.index,
        type,
        status: "failed",
        error: message,
      });
      DictationTelemetryRecordActionApplied(type, "failed");
    }
  }
  return { requestId: boundedRequestId, alreadyApplied: false, results };
}

interface TaskUpdateSnapshot {
  kind: "task-update";
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectId: string;
  labels: string[];
  assignees: string[];
  checklist: ChecklistItem[];
}

interface TaskFieldSnapshot {
  kind: "task-field";
  id: string;
  field: "description" | "checklist";
  before: string | ChecklistItem[];
}

interface NoteFieldSnapshot {
  kind: "note-field";
  id: string;
  field: "description";
  before: string;
}

interface CommentSnapshot {
  kind: "comment";
  targetId: string;
  targetType: "task" | "note";
  commentId: string;
}

interface CreatedSnapshot {
  kind: "created";
}

type UndoSnapshot =
  | TaskUpdateSnapshot
  | TaskFieldSnapshot
  | NoteFieldSnapshot
  | CommentSnapshot
  | CreatedSnapshot;

function parseSnapshot(row: DictationAppliedActionRecord): UndoSnapshot | null {
  if (!row.beforeJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.beforeJson);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as UndoSnapshot)
      : null;
  } catch {
    return null;
  }
}

async function restoreTaskUpdate(
  snapshot: TaskUpdateSnapshot,
  userSession: UserSession,
): Promise<void> {
  const task = await TasksDataGet(snapshot.id);
  if (!task || !(await isProjectItemVisible(task, userSession))) {
    throw new UndoSkipped("Task no longer available");
  }
  await requireProject(task.projectId, userSession, "update");
  if (snapshot.projectId !== task.projectId) {
    const snapshotProject = await ProjectsDataGet(snapshot.projectId);
    if (
      !snapshotProject ||
      !isProjectVisible(snapshotProject, userSession)
    ) {
      throw new UndoSkipped("Previous project no longer available");
    }
    await requireProject(snapshot.projectId, userSession, "update");
  }
  const currentAssignees = task.assignees.map((assignee) => assignee.userId);
  task.projectId = snapshot.projectId;
  task.title = snapshot.title;
  task.description = snapshot.description;
  task.status = snapshot.status;
  task.priority = snapshot.priority;
  task.dueDate = snapshot.dueDate || undefined;
  task.checklist = snapshot.checklist.map((item) => ({ ...item }));
  await TasksDataUpdate(task);
  await replaceLabels(task.id, snapshot.labels);
  for (const id of snapshot.assignees) {
    if (!currentAssignees.includes(id)) {
      await addAssignee(task.id, id);
    }
  }
  for (const id of currentAssignees) {
    if (!snapshot.assignees.includes(id)) {
      await removeAssignee(task.id, id);
    }
  }
  await recordTaskUpdate(
    task.id,
    userSession.userId as string,
    "Task restored (dictation undo)",
  );
}

async function restoreTaskField(
  snapshot: TaskFieldSnapshot,
  userId: string,
  userSession: UserSession,
): Promise<void> {
  const task = await TasksDataGet(snapshot.id);
  if (!task || !(await isProjectItemVisible(task, userSession))) {
    throw new UndoSkipped("Task no longer available");
  }
  await requireProject(task.projectId, userSession, "update");
  if (snapshot.field === "checklist") {
    task.checklist = (snapshot.before as ChecklistItem[]).map((item) => ({
      ...item,
    }));
  } else {
    task.description = snapshot.before as string;
  }
  await TasksDataUpdate(task);
  await recordTaskUpdate(task.id, userId, "Task restored (dictation undo)");
}

async function restoreNoteField(
  snapshot: NoteFieldSnapshot,
  userSession: UserSession,
): Promise<void> {
  const note = await NotesDataGet(snapshot.id);
  if (!note || !(await isProjectItemVisible(note, userSession))) {
    throw new UndoSkipped("Note no longer available");
  }
  await requireProject(note.projectId, userSession, "update");
  note.description = snapshot.before;
  await NotesDataUpdate(note);
}

async function undoComment(
  snapshot: CommentSnapshot,
  userSession: UserSession,
): Promise<void> {
  if (snapshot.targetType === "note") {
    const note = await NotesDataGet(snapshot.targetId);
    if (!note || !(await isProjectItemVisible(note, userSession))) {
      throw new UndoSkipped("Note no longer available");
    }
    await requireProject(note.projectId, userSession, "comment");
    const comment = await getNoteComment(snapshot.commentId, snapshot.targetId);
    if (!comment) {
      throw new UndoSkipped("Comment no longer available");
    }
    if (
      comment.userId !== userSession.userId &&
      userSession.role !== "admin"
    ) {
      throw new Error("Access Denied: only the author can delete this comment");
    }
    await deleteNoteComment(snapshot.commentId);
    return;
  }
  const task = await TasksDataGet(snapshot.targetId);
  if (!task || !(await isProjectItemVisible(task, userSession))) {
    throw new UndoSkipped("Task no longer available");
  }
  await requireProject(task.projectId, userSession, "comment");
  const comment = await getComment(snapshot.commentId, snapshot.targetId);
  if (!comment) {
    throw new UndoSkipped("Comment no longer available");
  }
  if (comment.userId !== userSession.userId && userSession.role !== "admin") {
    throw new Error("Access Denied: only the author can delete this comment");
  }
  await deleteComment(snapshot.commentId);
  await TasksDataTouch(task.id);
  await recordTaskUpdate(
    task.id,
    userSession.userId as string,
    "Comment deleted (dictation undo)",
  );
}

async function undoCreated(
  row: DictationAppliedActionRecord,
  userSession: UserSession,
): Promise<void> {
  if (!row.targetId) {
    throw new UndoSkipped("Created item no longer available");
  }
  if (row.targetType === "note") {
    const note = await NotesDataGet(row.targetId);
    if (!note || !(await isProjectItemVisible(note, userSession))) {
      throw new UndoSkipped("Note no longer available");
    }
    await requireProject(note.projectId, userSession, "all");
    await NotesDataDelete(row.targetId);
    return;
  }
  const task = await TasksDataGet(row.targetId);
  if (!task || !(await isProjectItemVisible(task, userSession))) {
    throw new UndoSkipped("Task no longer available");
  }
  await requireProject(task.projectId, userSession, "all");
  await TasksDataDelete(row.targetId);
}

/** Distinguishes "the item was deleted meanwhile" from a real failure. */
class UndoSkipped extends Error {}

async function undoOne(
  row: DictationAppliedActionRecord,
  userSession: UserSession,
): Promise<void> {
  const snapshot = parseSnapshot(row);
  if (!snapshot) {
    throw new UndoSkipped("Nothing to restore");
  }
  switch (snapshot.kind) {
    case "created":
      await undoCreated(row, userSession);
      return;
    case "task-update":
      await restoreTaskUpdate(snapshot, userSession);
      return;
    case "task-field":
      await restoreTaskField(
        snapshot,
        userSession.userId as string,
        userSession,
      );
      return;
    case "note-field":
      await restoreNoteField(snapshot, userSession);
      return;
    case "comment":
      await undoComment(snapshot, userSession);
      return;
    default:
      throw new UndoSkipped("Nothing to restore");
  }
}

/**
 * Reverts one applied batch, newest action first. Each row is independent:
 * missing items are skipped, permission failures are reported, and one
 * failure never aborts the rest. Repeating undo is a no-op.
 */
export async function UndoDictationActions(
  userSession: UserSession,
  jobId: string,
  requestId: string,
): Promise<DictationUndoOutcome> {
  const rows = await DictationActionDataListByRequest(jobId, requestId);
  const results: DictationActionUndoResult[] = [];
  for (const row of [...rows].sort((a, b) => b.actionIndex - a.actionIndex)) {
    if (row.status !== "applied") {
      results.push({
        index: row.actionIndex,
        type: row.type,
        status: "skipped",
        error: row.error || "This action was not applied",
      });
      continue;
    }
    if (row.undoneAt) {
      results.push({
        index: row.actionIndex,
        type: row.type,
        status: "skipped",
        error: "Already undone",
      });
      continue;
    }
    try {
      await undoOne(row, userSession);
      await DictationActionDataMarkUndone(row.id, new Date().toISOString());
      results.push({
        index: row.actionIndex,
        type: row.type,
        status: "undone",
      });
      DictationTelemetryRecordActionUndo(row.type, "undone");
    } catch (error) {
      const skipped = error instanceof UndoSkipped;
      const message = boundedError(error);
      if (skipped) {
        await DictationActionDataMarkUndone(row.id, new Date().toISOString());
      }
      results.push({
        index: row.actionIndex,
        type: row.type,
        status: skipped ? "skipped" : "failed",
        error: message,
      });
      DictationTelemetryRecordActionUndo(row.type, skipped ? "skipped" : "failed");
    }
  }
  return { requestId, results };
}
