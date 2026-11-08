import { Project } from "../model/Project";
import { Task } from "../model/Task";
import { Note } from "../model/Note";
import { TaskTemplate } from "../model/TaskTemplate";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { ProjectsDataList } from "../projects/ProjectsData";
import { hasProjectPermission, permissionDeniedMessage } from "../projects/ProjectVisibility";
import { TasksDataList } from "../tasks/TasksData";
import { NotesDataList } from "../notes/NotesData";
import { TaskTemplatesList } from "../tasktemplates/TaskTemplatesData";
import { UsersDataList, UsersDataGet } from "../users/UsersData";
import { DictationActionProposal, DictationActionType } from "./DictationLlm";
import { DictationTelemetryRecordActionResolution } from "./DictationTelemetry";

export type DictationEntityKind =
  | "project"
  | "task"
  | "note"
  | "template"
  | "user";

export type DictationResolutionStatus = "resolved" | "ambiguous" | "unresolved";

export interface DictationEntityCandidate {
  kind: DictationEntityKind;
  id: string;
  label: string;
  projectId?: string;
  projectName?: string;
}

export interface DictationTargetInfo {
  kind: "task" | "note" | "project" | "template";
  id: string;
  label: string;
  projectId: string | null;
  projectName: string | null;
}

export interface DictationFieldDiff {
  field: string;
  before: string | null;
  after: string | null;
}

/**
 * One previewed proposal. `resolved*` fields are the write-ready ids the
 * client may echo back as overrides; they are re-resolved on apply anyway.
 */
export interface DictationActionPreview {
  index: number;
  type: DictationActionType;
  action: DictationActionProposal;
  status: DictationResolutionStatus;
  target: DictationTargetInfo | null;
  candidates: DictationEntityCandidate[];
  diff: DictationFieldDiff[];
  error?: string;
  resolvedProjectId?: string;
  resolvedStatus?: string;
  resolvedTargetId?: string;
  resolvedAssigneeIds?: string[];
  resolvedAddAssigneeIds?: string[];
  resolvedRemoveAssigneeIds?: string[];
}

export interface DictationResolutionContext {
  userSession: UserSession;
  projects: Project[];
  tasks: Task[];
  notes: Note[];
  templates: TaskTemplate[];
  users: User[];
}

/**
 * Loads every reference list once, restricted to what the caller may see.
 * Admins get unrestricted lists; restricted projects and their items are
 * never loaded for other users, so they can never be resolved or previewed.
 */
export async function LoadDictationResolutionContext(
  userSession: UserSession,
): Promise<DictationResolutionContext> {
  const isAdmin = userSession.role === "admin";
  const userId = userSession.userId || "";
  const visibleTo = isAdmin ? undefined : { userId };
  const [projects, tasks, notes, templates, users] = await Promise.all([
    ProjectsDataList(isAdmin ? undefined : userId),
    TasksDataList({ visibleTo, limit: 1000 }),
    NotesDataList({ visibleTo, limit: 1000 }),
    TaskTemplatesList({ visibleTo }),
    UsersDataList(),
  ]);
  return { userSession, projects, tasks, notes, templates, users };
}

/**
 * Normalized comparison form: NFKC, accent-insensitive, lower-cased, with
 * punctuation collapsed to single spaces. Used for exact and fuzzy entity
 * matches only; display values are never rewritten.
 */
export function NormalizeEntityText(value: string): string {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = current;
    }
  }
  return previous[b.length];
}

/** Bounded fuzzy score: token overlap first, then a small edit distance. */
function fuzzyScore(query: string, candidate: string): number {
  if (!query || !candidate) {
    return 0;
  }
  if (query === candidate) {
    return 100;
  }
  const queryTokens = query.split(" ");
  const candidateTokens = candidate.split(" ");
  let overlap = 0;
  for (const token of queryTokens) {
    if (
      candidateTokens.some(
        (other) => other === token || (token.length >= 3 && other.includes(token)),
      )
    ) {
      overlap += 2;
    }
  }
  if (overlap > 0) {
    return overlap;
  }
  if (query.length >= 4 && candidate.length >= 4) {
    const distance = levenshtein(query, candidate);
    const allowed = query.length >= 12 ? 3 : query.length >= 8 ? 2 : 1;
    if (distance <= allowed) {
      return 1;
    }
  }
  return 0;
}

interface NamedEntity {
  kind: DictationEntityKind;
  id: string;
  label: string;
  projectId?: string;
  projectName?: string;
}

interface EntityMatch {
  match?: NamedEntity;
  candidates: DictationEntityCandidate[];
  error?: string;
}

function toCandidate(entity: NamedEntity): DictationEntityCandidate {
  const candidate: DictationEntityCandidate = {
    kind: entity.kind,
    id: entity.id,
    label: entity.label,
  };
  if (entity.projectId) {
    candidate.projectId = entity.projectId;
  }
  if (entity.projectName) {
    candidate.projectName = entity.projectName;
  }
  return candidate;
}

/**
 * Resolves a name or id against entities: explicit id first, then exact
 * normalized match, then bounded fuzzy matching. Ties return at most five
 * candidates (ambiguous); no match returns an error (unresolved).
 */
function resolveNamed(
  entities: NamedEntity[],
  raw: string | undefined,
  projectScope?: string,
): EntityMatch {
  const query = (raw || "").trim();
  if (!query) {
    return { candidates: [], error: "Missing target" };
  }
  const byId = entities.find((entity) => entity.id === query);
  if (byId) {
    return { match: byId, candidates: [] };
  }
  const normalized = NormalizeEntityText(query);
  if (!normalized) {
    return { candidates: [], error: "Missing target" };
  }
  let pool = entities;
  let scoped = false;
  if (projectScope) {
    const inScope = entities.filter(
      (entity) => entity.projectId === projectScope,
    );
    if (inScope.length > 0) {
      pool = inScope;
      scoped = true;
    }
  }
  const exact = pool.filter(
    (entity) => NormalizeEntityText(entity.label) === normalized,
  );
  if (exact.length === 1) {
    return { match: exact[0], candidates: [] };
  }
  if (exact.length > 1) {
    return { candidates: exact.slice(0, 5).map(toCandidate) };
  }
  const scored = pool
    .map((entity) => ({
      entity,
      score: fuzzyScore(normalized, NormalizeEntityText(entity.label)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    if (scoped) {
      return resolveNamed(entities, raw);
    }
    return { candidates: [], error: `No visible match for "${query}"` };
  }
  const bestScore = scored[0].score;
  const best = scored.filter((entry) => entry.score === bestScore);
  if (best.length === 1) {
    return { match: best[0].entity, candidates: [] };
  }
  return { candidates: best.slice(0, 5).map((entry) => toCandidate(entry.entity)) };
}

function projectById(
  context: DictationResolutionContext,
  id: string | null | undefined,
): Project | null {
  if (!id) {
    return null;
  }
  return context.projects.find((project) => project.id === id) || null;
}

function projectCandidates(context: DictationResolutionContext): NamedEntity[] {
  return context.projects.map((project) => ({
    kind: "project",
    id: project.id,
    label: project.name,
  }));
}

function defaultProject(
  context: DictationResolutionContext,
): Project | null {
  return (
    context.projects.find((project) => project.isDefault && !project.archived) ||
    context.projects.find((project) => !project.archived) ||
    null
  );
}

interface ProjectResolution {
  project?: Project;
  candidates: DictationEntityCandidate[];
  error?: string;
}

function resolveProject(
  context: DictationResolutionContext,
  raw: string,
): ProjectResolution {
  const resolved = resolveNamed(projectCandidates(context), raw);
  if (!resolved.match) {
    return { candidates: resolved.candidates, error: resolved.error };
  }
  const project = projectById(context, resolved.match.id);
  if (!project) {
    return { candidates: [], error: "Project Not Found" };
  }
  if (project.archived) {
    return { candidates: [], error: "Project is archived" };
  }
  return { project, candidates: [] };
}

function resolveCreateProject(
  context: DictationResolutionContext,
  raw: string | undefined,
): ProjectResolution {
  if (raw) {
    return resolveProject(context, raw);
  }
  const project = defaultProject(context);
  if (!project) {
    return { candidates: [], error: "No project available for this action" };
  }
  return { project, candidates: [] };
}

function mutationError(
  context: DictationResolutionContext,
  project: Project,
  required: "update" | "comment" | "all",
): string | null {
  if (project.archived) {
    return "Project is archived";
  }
  if (!hasProjectPermission(project, context.userSession, required)) {
    return permissionDeniedMessage(required);
  }
  return null;
}

function resolveStatus(
  project: Project,
  raw: string | undefined,
): { status?: string; error?: string } {
  if (!raw) {
    return { status: project.statuses[0] || "To Do" };
  }
  const normalized = raw.trim().toLowerCase();
  const status = project.statuses.find(
    (candidate) => candidate.toLowerCase() === normalized,
  );
  if (!status) {
    return {
      status: undefined,
      error: `Unknown status "${raw}" in project "${project.name}"`,
    };
  }
  return { status };
}

function userCandidates(context: DictationResolutionContext): NamedEntity[] {
  return context.users.map((user) => ({
    kind: "user",
    id: user.id,
    label: user.name,
  }));
}

interface UsersResolution {
  ids?: string[];
  candidates: DictationActionPreview["candidates"];
  error?: string;
}

function resolveUsers(
  context: DictationResolutionContext,
  names: string[],
): UsersResolution {
  const entities = userCandidates(context);
  const ids: string[] = [];
  const candidates: DictationEntityCandidate[] = [];
  let error: string | undefined;
  for (const name of names) {
    const resolved = resolveNamed(entities, name);
    if (resolved.match) {
      if (!ids.includes(resolved.match.id)) {
        ids.push(resolved.match.id);
      }
      continue;
    }
    if (resolved.candidates.length > 0) {
      candidates.push(...resolved.candidates);
    } else if (!error) {
      error = resolved.error || `Unknown user "${name}"`;
    }
  }
  if (candidates.length > 0) {
    return { candidates, error: "Several users match this name" };
  }
  if (error) {
    return { candidates: [], error };
  }
  return { ids, candidates: [] };
}

function taskCandidates(context: DictationResolutionContext): NamedEntity[] {
  return context.tasks.map((task) => {
    const project = projectById(context, task.projectId);
    return {
      kind: "task",
      id: task.id,
      label: task.title,
      projectId: task.projectId,
      projectName: project?.name ?? undefined,
    };
  });
}

function noteCandidates(context: DictationResolutionContext): NamedEntity[] {
  return context.notes.map((note) => {
    const project = projectById(context, note.projectId);
    return {
      kind: "note",
      id: note.id,
      label: note.title,
      projectId: note.projectId,
      projectName: project?.name ?? undefined,
    };
  });
}

function templateCandidates(
  context: DictationResolutionContext,
): NamedEntity[] {
  return context.templates.map((template) => {
    const project = projectById(context, template.projectId);
    return {
      kind: "template",
      id: template.id,
      label: template.title,
      projectId: template.projectId,
      projectName: project?.name ?? undefined,
    };
  });
}

function taskTarget(
  context: DictationResolutionContext,
  task: Task,
): DictationTargetInfo {
  const project = projectById(context, task.projectId);
  return {
    kind: "task",
    id: task.id,
    label: task.title,
    projectId: task.projectId,
    projectName: project?.name ?? null,
  };
}

function noteTarget(
  context: DictationResolutionContext,
  note: Note,
): DictationTargetInfo {
  const project = projectById(context, note.projectId);
  return {
    kind: "note",
    id: note.id,
    label: note.title,
    projectId: note.projectId,
    projectName: project?.name ?? null,
  };
}

function userName(
  context: DictationResolutionContext,
  id: string,
): string {
  return context.users.find((user) => user.id === id)?.name || id;
}

function formatLabels(labels: string[]): string {
  return labels.join(", ");
}

function basePreview(
  index: number,
  action: DictationActionProposal,
): DictationActionPreview {
  return {
    index,
    type: action.type,
    action,
    status: "resolved",
    target: null,
    candidates: [],
    diff: [],
  };
}

function unresolved(
  preview: DictationActionPreview,
  error: string,
  candidates: DictationEntityCandidate[] = [],
): DictationActionPreview {
  preview.status = candidates.length > 0 ? "ambiguous" : "unresolved";
  preview.error = error;
  preview.candidates = candidates;
  return preview;
}

function previewCreateTask(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const projectResolution = resolveCreateProject(context, action.project);
  if (!projectResolution.project) {
    return unresolved(
      preview,
      projectResolution.error || "Project Not Found",
      projectResolution.candidates,
    );
  }
  const project = projectResolution.project;
  const guard = mutationError(context, project, "update");
  if (guard) {
    return unresolved(preview, guard);
  }
  const statusResolution = resolveStatus(project, action.status);
  if (!statusResolution.status) {
    return unresolved(preview, statusResolution.error || "Unknown status");
  }
  let assigneeIds: string[] = [];
  if (action.assignees && action.assignees.length > 0) {
    const resolvedUsers = resolveUsers(context, action.assignees);
    if (!resolvedUsers.ids) {
      return unresolved(
        preview,
        resolvedUsers.error || "Unknown assignee",
        resolvedUsers.candidates,
      );
    }
    assigneeIds = resolvedUsers.ids;
  }
  preview.status = "resolved";
  preview.target = {
    kind: "project",
    id: project.id,
    label: project.name,
    projectId: project.id,
    projectName: project.name,
  };
  preview.resolvedProjectId = project.id;
  preview.resolvedStatus = statusResolution.status;
  preview.resolvedAssigneeIds = assigneeIds;
  // Nothing existed before a creation: the card's editable fields already
  // show the new values, so repeating them as a before/after diff is noise.
  return preview;
}

function previewCreateNote(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const projectResolution = resolveCreateProject(context, action.project);
  if (!projectResolution.project) {
    return unresolved(
      preview,
      projectResolution.error || "Project Not Found",
      projectResolution.candidates,
    );
  }
  const project = projectResolution.project;
  const guard = mutationError(context, project, "update");
  if (guard) {
    return unresolved(preview, guard);
  }
  preview.target = {
    kind: "project",
    id: project.id,
    label: project.name,
    projectId: project.id,
    projectName: project.name,
  };
  preview.resolvedProjectId = project.id;
  return preview;
}

function resolveTargetTask(
  context: DictationResolutionContext,
  action: DictationActionProposal,
): EntityMatch {
  const scope = action.project;
  return resolveNamed(taskCandidates(context), action.target, scope);
}

function previewUpdateTask(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const changes = action.changes || {};
  const resolved = resolveTargetTask(context, action);
  if (!resolved.match) {
    return unresolved(preview, resolved.error || "Task Not Found", resolved.candidates);
  }
  const task = context.tasks.find((entry) => entry.id === resolved.match!.id);
  if (!task) {
    return unresolved(preview, "Task Not Found");
  }
  const sourceProject = projectById(context, task.projectId);
  if (!sourceProject) {
    return unresolved(preview, "Project Not Found");
  }
  const sourceGuard = mutationError(context, sourceProject, "update");
  if (sourceGuard) {
    return unresolved(preview, sourceGuard);
  }
  preview.target = taskTarget(context, task);

  let targetProject = sourceProject;
  if (changes.project) {
    const projectResolution = resolveProject(context, changes.project);
    if (!projectResolution.project) {
      return unresolved(
        preview,
        projectResolution.error || "Project Not Found",
        projectResolution.candidates,
      );
    }
    targetProject = projectResolution.project;
    const targetGuard = mutationError(context, targetProject, "update");
    if (targetGuard) {
      return unresolved(preview, targetGuard);
    }
  }
  const statusResolution = resolveStatus(
    targetProject,
    changes.status ?? (changes.project ? undefined : task.status),
  );
  if (!statusResolution.status) {
    return unresolved(preview, statusResolution.error || "Unknown status");
  }

  let addAssigneeIds: string[] | undefined;
  let removeAssigneeIds: string[] | undefined;
  if (changes.addAssignees && changes.addAssignees.length > 0) {
    const resolvedUsers = resolveUsers(context, changes.addAssignees);
    if (!resolvedUsers.ids) {
      return unresolved(
        preview,
        resolvedUsers.error || "Unknown assignee",
        resolvedUsers.candidates,
      );
    }
    addAssigneeIds = resolvedUsers.ids;
  }
  if (changes.removeAssignees && changes.removeAssignees.length > 0) {
    const resolvedUsers = resolveUsers(context, changes.removeAssignees);
    if (!resolvedUsers.ids) {
      return unresolved(
        preview,
        resolvedUsers.error || "Unknown assignee",
        resolvedUsers.candidates,
      );
    }
    removeAssigneeIds = resolvedUsers.ids;
  }

  preview.resolvedProjectId = targetProject.id;
  preview.resolvedStatus = statusResolution.status;
  preview.resolvedTargetId = task.id;
  preview.resolvedAssigneeIds = [
    ...(addAssigneeIds || []),
  ];
  preview.resolvedAddAssigneeIds = addAssigneeIds || [];
  preview.resolvedRemoveAssigneeIds = removeAssigneeIds || [];

  const diff: DictationFieldDiff[] = [];
  if (changes.title !== undefined && changes.title !== task.title) {
    diff.push({ field: "title", before: task.title, after: changes.title });
  }
  if (
    changes.description !== undefined &&
    changes.description !== task.description
  ) {
    diff.push({
      field: "description",
      before: task.description,
      after: changes.description,
    });
  }
  if (changes.status !== undefined && statusResolution.status !== task.status) {
    diff.push({
      field: "status",
      before: task.status,
      after: statusResolution.status,
    });
  }
  if (changes.priority !== undefined && changes.priority !== task.priority) {
    diff.push({
      field: "priority",
      before: task.priority,
      after: changes.priority,
    });
  }
  if (changes.dueDate !== undefined) {
    const before = task.dueDate || null;
    const after = changes.dueDate;
    if (before !== after) {
      diff.push({ field: "dueDate", before, after });
    }
  }
  if (changes.project !== undefined && targetProject.id !== task.projectId) {
    diff.push({
      field: "project",
      before: sourceProject.name,
      after: targetProject.name,
    });
  }
  const addLabels = changes.addLabels || [];
  const removeLabels = changes.removeLabels || [];
  if (addLabels.length > 0 || removeLabels.length > 0) {
    const resulting = task.labels.filter(
      (label) => !removeLabels.includes(label),
    );
    for (const label of addLabels) {
      if (!resulting.includes(label)) {
        resulting.push(label);
      }
    }
    diff.push({
      field: "labels",
      before: formatLabels(task.labels),
      after: formatLabels(resulting),
    });
  }
  if (
    (addAssigneeIds && addAssigneeIds.length > 0) ||
    (removeAssigneeIds && removeAssigneeIds.length > 0)
  ) {
    const resulting = task.assignees
      .map((assignee) => assignee.userId)
      .filter((id) => !(removeAssigneeIds || []).includes(id));
    for (const id of addAssigneeIds || []) {
      if (!resulting.includes(id)) {
        resulting.push(id);
      }
    }
    diff.push({
      field: "assignees",
      before: formatLabels(
        task.assignees.map((assignee) => userName(context, assignee.userId)),
      ),
      after: formatLabels(resulting.map((id) => userName(context, id))),
    });
  }
  preview.diff = diff;
  return preview;
}

function previewAppend(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const kind = action.type === "append_to_task" ? "task" : "note";
  const resolved = resolveNamed(
    kind === "task" ? taskCandidates(context) : noteCandidates(context),
    action.target,
    action.project,
  );
  if (!resolved.match) {
    return unresolved(preview, resolved.error || "Target Not Found", resolved.candidates);
  }
  const project = projectById(context, resolved.match.projectId);
  if (!project) {
    return unresolved(preview, "Project Not Found");
  }
  const guard = mutationError(context, project, "update");
  if (guard) {
    return unresolved(preview, guard);
  }
  if (kind === "task") {
    const task = context.tasks.find((entry) => entry.id === resolved.match!.id);
    if (!task) {
      return unresolved(preview, "Task Not Found");
    }
    preview.target = taskTarget(context, task);
    preview.resolvedTargetId = task.id;
    preview.diff = [
      {
        field: "description",
        before: task.description,
        after: task.description
          ? `${task.description}\n\n${action.text || ""}`
          : action.text || "",
      },
    ];
  } else {
    const note = context.notes.find((entry) => entry.id === resolved.match!.id);
    if (!note) {
      return unresolved(preview, "Note Not Found");
    }
    preview.target = noteTarget(context, note);
    preview.resolvedTargetId = note.id;
    preview.diff = [
      {
        field: "description",
        before: note.description,
        after: note.description
          ? `${note.description}\n\n${action.text || ""}`
          : action.text || "",
      },
    ];
  }
  return preview;
}

function previewAddComment(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const kind = action.targetType === "note" ? "note" : "task";
  const resolved = resolveNamed(
    kind === "task" ? taskCandidates(context) : noteCandidates(context),
    action.target,
    action.project,
  );
  if (!resolved.match) {
    return unresolved(preview, resolved.error || "Target Not Found", resolved.candidates);
  }
  const project = projectById(context, resolved.match.projectId);
  if (!project) {
    return unresolved(preview, "Project Not Found");
  }
  const guard = mutationError(context, project, "comment");
  if (guard) {
    return unresolved(preview, guard);
  }
  if (kind === "task") {
    const task = context.tasks.find((entry) => entry.id === resolved.match!.id);
    if (!task) {
      return unresolved(preview, "Task Not Found");
    }
    preview.target = taskTarget(context, task);
  } else {
    const note = context.notes.find((entry) => entry.id === resolved.match!.id);
    if (!note) {
      return unresolved(preview, "Note Not Found");
    }
    preview.target = noteTarget(context, note);
  }
  preview.resolvedTargetId = resolved.match.id;
  preview.diff = [
    { field: "comment", before: null, after: action.text || "" },
  ];
  return preview;
}

function previewChecklist(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const resolved = resolveNamed(
    taskCandidates(context),
    action.target,
    action.project,
  );
  if (!resolved.match) {
    return unresolved(preview, resolved.error || "Task Not Found", resolved.candidates);
  }
  const task = context.tasks.find((entry) => entry.id === resolved.match!.id);
  if (!task) {
    return unresolved(preview, "Task Not Found");
  }
  const project = projectById(context, task.projectId);
  if (!project) {
    return unresolved(preview, "Project Not Found");
  }
  const guard = mutationError(context, project, "update");
  if (guard) {
    return unresolved(preview, guard);
  }
  if ((task.checklist?.length || 0) + (action.items?.length || 0) > 100) {
    return unresolved(preview, "The checklist would exceed 100 items");
  }
  preview.target = taskTarget(context, task);
  preview.resolvedTargetId = task.id;
  preview.diff = [
    {
      field: "checklist",
      before: `${task.checklist?.length || 0} item(s)`,
      after: `${(task.checklist?.length || 0) + (action.items?.length || 0)} item(s)`,
    },
  ];
  return preview;
}

function previewInstantiateTemplate(
  index: number,
  action: DictationActionProposal,
  context: DictationResolutionContext,
): DictationActionPreview {
  const preview = basePreview(index, action);
  const resolved = resolveNamed(templateCandidates(context), action.template);
  if (!resolved.match) {
    return unresolved(
      preview,
      resolved.error || "Template Not Found",
      resolved.candidates,
    );
  }
  const template = context.templates.find(
    (entry) => entry.id === resolved.match!.id,
  );
  if (!template) {
    return unresolved(preview, "Template Not Found");
  }
  const project = projectById(context, template.projectId);
  if (!project) {
    return unresolved(preview, "Project Not Found");
  }
  const guard = mutationError(context, project, "update");
  if (guard) {
    return unresolved(preview, guard);
  }
  preview.target = {
    kind: "template",
    id: template.id,
    label: template.title,
    projectId: project.id,
    projectName: project.name,
  };
  preview.resolvedProjectId = project.id;
  return preview;
}

/**
 * Builds one preview per stored proposal. Every entry is independently
 * resolved: nothing is written and a failure only affects its own card.
 */
export function BuildActionPreviews(
  actions: DictationActionProposal[],
  context: DictationResolutionContext,
): DictationActionPreview[] {
  return actions.map((action, index) => {
    let preview: DictationActionPreview;
    switch (action.type) {
      case "create_task":
        preview = previewCreateTask(index, action, context);
        break;
      case "create_note":
        preview = previewCreateNote(index, action, context);
        break;
      case "update_task":
        preview = previewUpdateTask(index, action, context);
        break;
      case "append_to_task":
      case "append_to_note":
        preview = previewAppend(index, action, context);
        break;
      case "add_comment":
        preview = previewAddComment(index, action, context);
        break;
      case "add_checklist_items":
        preview = previewChecklist(index, action, context);
        break;
      case "instantiate_template":
        preview = previewInstantiateTemplate(index, action, context);
        break;
      default:
        preview = unresolved(basePreview(index, action), "Unsupported action");
        break;
    }
    DictationTelemetryRecordActionResolution(action.type, preview.status);
    return preview;
  });
}

/**
 * Compact visible-data block for the actions prompt: only names, ids,
 * statuses and project names. No task/note content is sent.
 */
export async function BuildActionsReference(
  userId: string,
): Promise<string | null> {
  try {
    const user = await UsersDataGet(userId);
    if (!user) {
      return null;
    }
    const isAdmin = user.role === "admin";
    const projects = await ProjectsDataList(isAdmin ? undefined : userId);
    const templates = await TaskTemplatesList(
      isAdmin ? {} : { visibleTo: { userId } },
    );
    const lines: string[] = [];
    for (const project of projects.filter((entry) => !entry.archived).slice(0, 50)) {
      lines.push(
        `Project ${project.id} "${project.name}" statuses: ${project.statuses.join(", ")}`,
      );
    }
    for (const template of templates.slice(0, 50)) {
      const project = projects.find(
        (entry) => entry.id === template.projectId,
      );
      lines.push(
        `Template ${template.id} "${template.title}" project: "${project?.name ?? ""}"`,
      );
    }
    const reference = lines.join("\n").slice(0, 4000);
    return reference || null;
  } catch {
    return null;
  }
}
