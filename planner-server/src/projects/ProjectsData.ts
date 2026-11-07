import {
  Project,
  ProjectPermission,
  ProjectUserAccess,
  normalizePermission,
} from "../model/Project";
import {
  DbUtilsExecSQL,
  DbUtilsQuerySQL,
  DbUtilsGetType,
  DbUtilsTransaction,
} from "../utils/DbUtils";
import { buildInPlaceholders } from "../tasks/TasksData";
import { removeFilesQuietly } from "../utils/FileUtils";

export async function ProjectsDataGet(id: string): Promise<Project> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_PROJECT[DbUtilsGetType()],
    [id],
  );
  if (rows.length === 0) {
    return null;
  }
  const project = Project.fromJson(rows[0]);
  project.userAccess = await getProjectUsers(project.id);
  return project;
}

export async function ProjectsDataList(userId?: string): Promise<Project[]> {
  let rows: Record<string, unknown>[];
  if (userId) {
    rows = await DbUtilsQuerySQL(
      SQL_QUERIES.LIST_VISIBLE_PROJECTS[DbUtilsGetType()],
      [userId],
    );
  } else {
    rows = await DbUtilsQuerySQL(SQL_QUERIES.LIST_PROJECTS[DbUtilsGetType()]);
  }
  const projects = rows.map((row) => Project.fromJson(row));
  // One batched query for the access lists instead of one query per project
  const usersByProject = await getProjectUsersForProjects(
    projects.map((p) => p.id),
  );
  for (const project of projects) {
    project.userAccess = usersByProject.get(project.id) || [];
  }
  return projects;
}

export async function ProjectsDataAdd(project: Project): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_PROJECT[DbUtilsGetType()], [
    project.id,
    project.name,
    project.description,
    project.isDefault ? 1 : 0,
    project.archived ? 1 : 0,
    project.visibility,
    JSON.stringify(project.statuses),
    project.dateCreated,
  ]);
  for (const entry of project.userAccess) {
    await addProjectUser(project.id, entry.userId, entry.permission);
  }
}

/**
 * Updates the project and, when `replaceUserAccess` is provided, replaces its
 * whole access list in one transaction: a failure leaves the previous list
 * and project untouched.
 */
export async function ProjectsDataUpdate(
  project: Project,
  replaceUserAccess?: ProjectUserAccess[],
): Promise<void> {
  await DbUtilsTransaction(async () => {
    await DbUtilsExecSQL(SQL_QUERIES.UPDATE_PROJECT[DbUtilsGetType()], [
      project.name,
      project.description,
      project.isDefault ? 1 : 0,
      project.archived ? 1 : 0,
      project.visibility,
      JSON.stringify(project.statuses),
      project.id,
    ]);
    if (replaceUserAccess) {
      await clearProjectUsers(project.id);
      for (const entry of replaceUserAccess) {
        await addProjectUser(project.id, entry.userId, entry.permission);
      }
    }
  });
}

/**
 * Number of tasks in the project that are not Done. A project can only be
 * archived when every task is Done; "Done" is mandatory in every project's
 * status selection, so status != 'Done' means not done.
 */
export async function ProjectsDataCountOpenTasks(
  projectId: string,
): Promise<number> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.COUNT_OPEN_TASKS[DbUtilsGetType()],
    [projectId],
  );
  return Number(rows[0]?.count || 0);
}

// ==================== PROJECT USERS ====================

export async function getProjectUsers(
  projectId: string,
): Promise<ProjectUserAccess[]> {
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_PROJECT_USERS[DbUtilsGetType()],
    [projectId],
  );
  return rows.map((r) => ({
    userId: r.userId as string,
    permission: normalizePermission(r.permission),
  }));
}

async function getProjectUsersForProjects(
  projectIds: string[],
): Promise<Map<string, ProjectUserAccess[]>> {
  const usersByProject = new Map<string, ProjectUserAccess[]>();
  if (projectIds.length === 0) {
    return usersByProject;
  }
  const rows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_PROJECT_USERS_BY_PROJECT_IDS[DbUtilsGetType()].replace(
      ":ids",
      buildInPlaceholders(projectIds.length),
    ),
    projectIds,
  );
  for (const row of rows) {
    const list = usersByProject.get(row.projectId as string) || [];
    list.push({
      userId: row.userId as string,
      permission: normalizePermission(row.permission),
    });
    usersByProject.set(row.projectId as string, list);
  }
  return usersByProject;
}

export async function addProjectUser(
  projectId: string,
  userId: string,
  permission: ProjectPermission = "all",
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.INSERT_PROJECT_USER[DbUtilsGetType()], [
    projectId,
    userId,
    permission,
  ]);
}

export async function removeProjectUser(
  projectId: string,
  userId: string,
): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT_USER[DbUtilsGetType()], [
    projectId,
    userId,
  ]);
}

export async function clearProjectUsers(projectId: string): Promise<void> {
  await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT_USERS[DbUtilsGetType()], [
    projectId,
  ]);
}

/**
 * Deletes the project and every child row (its notes/task templates with
 * their children, project users) in one transaction. Its tasks are either
 * deleted with their children and attachment files, or moved to
 * `moveTasksTo` (a task's comments, labels, assignees and attachment files
 * then stay attached). Returns the number of tasks moved.
 */
export async function ProjectsDataDelete(
  id: string,
  moveTasksTo?: Project,
): Promise<number> {
  // When tasks are moved their attachment files must survive
  const attachmentPaths = await getProjectAttachmentPaths(id, !moveTasksTo);
  let tasksMoved = 0;
  await DbUtilsTransaction(async () => {
    if (moveTasksTo) {
      tasksMoved = await moveTasks(moveTasksTo, id);
    } else {
      await DbUtilsExecSQL(
        SQL_QUERIES.DELETE_TASK_LABELS_BY_PROJECT[DbUtilsGetType()],
        [id],
      );
      await DbUtilsExecSQL(
        SQL_QUERIES.DELETE_TASK_ASSIGNEES_BY_PROJECT[DbUtilsGetType()],
        [id],
      );
      await DbUtilsExecSQL(
        SQL_QUERIES.DELETE_TASK_COMMENTS_BY_PROJECT[DbUtilsGetType()],
        [id],
      );
      await DbUtilsExecSQL(
        SQL_QUERIES.DELETE_TASK_ATTACHMENTS_BY_PROJECT[DbUtilsGetType()],
        [id],
      );
      await DbUtilsExecSQL(
        SQL_QUERIES.DELETE_TASKS_BY_PROJECT[DbUtilsGetType()],
        [id],
      );
    }
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_NOTE_LABELS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_NOTE_COMMENTS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_NOTE_ATTACHMENTS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_NOTES_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_LABELS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_ASSIGNEES_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_COMMENTS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_ATTACHMENTS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATE_RUNS_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_TEMPLATES_BY_PROJECT[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT_USERS[DbUtilsGetType()], [
      id,
    ]);
    await DbUtilsExecSQL(
      SQL_QUERIES.DELETE_PROJECT_DICTATION_VOCABULARY[DbUtilsGetType()],
      [id],
    );
    await DbUtilsExecSQL(SQL_QUERIES.DELETE_PROJECT[DbUtilsGetType()], [id]);
  });
  await removeFilesQuietly(attachmentPaths);
  return tasksMoved;
}

/**
 * Reassigns every task of `sourceProjectId` to the target project, bumping
 * dateUpdated like a regular project change. A task whose status is not
 * part of the target project's selection falls back to its first status,
 * mirroring the single-task project change.
 */
async function moveTasks(
  targetProject: Project,
  sourceProjectId: string,
): Promise<number> {
  const dbType = DbUtilsGetType();
  const moved = await DbUtilsExecSQL(
    SQL_QUERIES.MOVE_TASKS_TO_PROJECT[dbType],
    [targetProject.id, new Date().toISOString(), sourceProjectId],
  );
  const statuses = targetProject.statuses || [];
  if (statuses.length > 0) {
    await DbUtilsExecSQL(
      SQL_QUERIES.RESET_MOVED_TASK_STATUSES[dbType].replace(
        ":statuses",
        buildInPlaceholders(statuses.length),
      ),
      [statuses[0], targetProject.id, ...statuses],
    );
  }
  return moved;
}

async function getProjectAttachmentPaths(
  projectId: string,
  includeTaskAttachments = true,
): Promise<string[]> {
  const dbType = DbUtilsGetType();
  const taskRows = includeTaskAttachments
    ? await DbUtilsQuerySQL(
        SQL_QUERIES.GET_TASK_ATTACHMENT_PATHS_BY_PROJECT[dbType],
        [projectId],
      )
    : [];
  const noteRows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_NOTE_ATTACHMENT_PATHS_BY_PROJECT[dbType],
    [projectId],
  );
  const templateRows = await DbUtilsQuerySQL(
    SQL_QUERIES.GET_TEMPLATE_ATTACHMENT_PATHS_BY_PROJECT[dbType],
    [projectId],
  );
  return [...taskRows, ...noteRows, ...templateRows].map(
    (r) => r.filePath as string,
  );
}

const SQL_QUERIES = {
  GET_PROJECT: {
    postgres: 'SELECT * FROM projects WHERE "id" = $1',
    sqlite: "SELECT * FROM projects WHERE id = ?",
  },
  LIST_PROJECTS: {
    postgres: 'SELECT * FROM projects ORDER BY "archived" ASC, "name" ASC',
    sqlite: "SELECT * FROM projects ORDER BY archived ASC, name ASC",
  },
  INSERT_PROJECT: {
    postgres:
      'INSERT INTO projects ("id", "name", "description", "isDefault", "archived", "visibility", "statuses", "dateCreated") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    sqlite:
      "INSERT INTO projects (id, name, description, isDefault, archived, visibility, statuses, dateCreated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  },
  UPDATE_PROJECT: {
    postgres:
      'UPDATE projects SET "name" = $1, "description" = $2, "isDefault" = $3, "archived" = $4, "visibility" = $5, "statuses" = $6 WHERE "id" = $7',
    sqlite:
      "UPDATE projects SET name = ?, description = ?, isDefault = ?, archived = ?, visibility = ?, statuses = ? WHERE id = ?",
  },
  COUNT_OPEN_TASKS: {
    postgres:
      'SELECT COUNT(*) AS "count" FROM tasks WHERE "projectId" = $1 AND "status" != \'Done\'',
    sqlite:
      "SELECT COUNT(*) AS count FROM tasks WHERE projectId = ? AND status != 'Done'",
  },
  DELETE_PROJECT: {
    postgres: 'DELETE FROM projects WHERE "id" = $1',
    sqlite: "DELETE FROM projects WHERE id = ?",
  },
  DELETE_TASKS_BY_PROJECT: {
    postgres: 'DELETE FROM tasks WHERE "projectId" = $1',
    sqlite: "DELETE FROM tasks WHERE projectId = ?",
  },
  MOVE_TASKS_TO_PROJECT: {
    postgres:
      'UPDATE tasks SET "projectId" = $1, "dateUpdated" = $2 WHERE "projectId" = $3',
    sqlite: "UPDATE tasks SET projectId = ?, dateUpdated = ? WHERE projectId = ?",
  },
  RESET_MOVED_TASK_STATUSES: {
    postgres:
      'UPDATE tasks SET "status" = $1 WHERE "projectId" = $2 AND "status" NOT IN (:statuses)',
    sqlite:
      "UPDATE tasks SET status = ? WHERE projectId = ? AND status NOT IN (:statuses)",
  },
  DELETE_TASK_LABELS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_labels WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_labels WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_TASK_ASSIGNEES_BY_PROJECT: {
    postgres:
      'DELETE FROM task_assignees WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_assignees WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_TASK_COMMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_comments WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_comments WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_TASK_ATTACHMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_attachments WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_attachments WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  DELETE_NOTES_BY_PROJECT: {
    postgres: 'DELETE FROM notes WHERE "projectId" = $1',
    sqlite: "DELETE FROM notes WHERE projectId = ?",
  },
  DELETE_NOTE_LABELS_BY_PROJECT: {
    postgres:
      'DELETE FROM note_labels WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM note_labels WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
  DELETE_NOTE_COMMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM note_comments WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM note_comments WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
  DELETE_NOTE_ATTACHMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM note_attachments WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM note_attachments WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
  LIST_VISIBLE_PROJECTS: {
    postgres: `SELECT * FROM projects WHERE "visibility" = 'public' OR "id" IN (SELECT "projectId" FROM project_users WHERE "userId" = $1) ORDER BY "archived" ASC, "name" ASC`,
    sqlite:
      "SELECT * FROM projects WHERE visibility = 'public' OR id IN (SELECT projectId FROM project_users WHERE userId = ?) ORDER BY archived ASC, name ASC",
  },
  INSERT_PROJECT_USER: {
    postgres:
      'INSERT INTO project_users ("projectId", "userId", "permission") VALUES ($1, $2, $3)',
    sqlite:
      "INSERT INTO project_users (projectId, userId, permission) VALUES (?, ?, ?)",
  },
  DELETE_PROJECT_USER: {
    postgres:
      'DELETE FROM project_users WHERE "projectId" = $1 AND "userId" = $2',
    sqlite: "DELETE FROM project_users WHERE projectId = ? AND userId = ?",
  },
  DELETE_PROJECT_USERS: {
    postgres: 'DELETE FROM project_users WHERE "projectId" = $1',
    sqlite: "DELETE FROM project_users WHERE projectId = ?",
  },
  DELETE_PROJECT_DICTATION_VOCABULARY: {
    postgres: 'DELETE FROM dictation_vocabulary WHERE "projectId" = $1',
    sqlite: "DELETE FROM dictation_vocabulary WHERE projectId = ?",
  },
  GET_PROJECT_USERS: {
    postgres:
      'SELECT "userId", "permission" FROM project_users WHERE "projectId" = $1',
    sqlite: "SELECT userId, permission FROM project_users WHERE projectId = ?",
  },
  GET_PROJECT_USERS_BY_PROJECT_IDS: {
    postgres:
      'SELECT "projectId", "userId", "permission" FROM project_users WHERE "projectId" IN (:ids)',
    sqlite:
      "SELECT projectId, userId, permission FROM project_users WHERE projectId IN (:ids)",
  },
  GET_TASK_ATTACHMENT_PATHS_BY_PROJECT: {
    postgres:
      'SELECT "filePath" FROM task_attachments WHERE "taskId" IN (SELECT "id" FROM tasks WHERE "projectId" = $1)',
    sqlite:
      "SELECT filePath FROM task_attachments WHERE taskId IN (SELECT id FROM tasks WHERE projectId = ?)",
  },
  GET_NOTE_ATTACHMENT_PATHS_BY_PROJECT: {
    postgres:
      'SELECT "filePath" FROM note_attachments WHERE "noteId" IN (SELECT "id" FROM notes WHERE "projectId" = $1)',
    sqlite:
      "SELECT filePath FROM note_attachments WHERE noteId IN (SELECT id FROM notes WHERE projectId = ?)",
  },
  GET_TEMPLATE_ATTACHMENT_PATHS_BY_PROJECT: {
    postgres:
      'SELECT "filePath" FROM task_template_attachments WHERE "templateId" IN (SELECT "id" FROM task_templates WHERE "projectId" = $1)',
    sqlite:
      "SELECT filePath FROM task_template_attachments WHERE templateId IN (SELECT id FROM task_templates WHERE projectId = ?)",
  },
  DELETE_TEMPLATES_BY_PROJECT: {
    postgres: 'DELETE FROM task_templates WHERE "projectId" = $1',
    sqlite: "DELETE FROM task_templates WHERE projectId = ?",
  },
  DELETE_TEMPLATE_LABELS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_template_labels WHERE "templateId" IN (SELECT "id" FROM task_templates WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_template_labels WHERE templateId IN (SELECT id FROM task_templates WHERE projectId = ?)",
  },
  DELETE_TEMPLATE_ASSIGNEES_BY_PROJECT: {
    postgres:
      'DELETE FROM task_template_assignees WHERE "templateId" IN (SELECT "id" FROM task_templates WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_template_assignees WHERE templateId IN (SELECT id FROM task_templates WHERE projectId = ?)",
  },
  DELETE_TEMPLATE_COMMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_template_comments WHERE "templateId" IN (SELECT "id" FROM task_templates WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_template_comments WHERE templateId IN (SELECT id FROM task_templates WHERE projectId = ?)",
  },
  DELETE_TEMPLATE_ATTACHMENTS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_template_attachments WHERE "templateId" IN (SELECT "id" FROM task_templates WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_template_attachments WHERE templateId IN (SELECT id FROM task_templates WHERE projectId = ?)",
  },
  DELETE_TEMPLATE_RUNS_BY_PROJECT: {
    postgres:
      'DELETE FROM task_template_runs WHERE "templateId" IN (SELECT "id" FROM task_templates WHERE "projectId" = $1)',
    sqlite:
      "DELETE FROM task_template_runs WHERE templateId IN (SELECT id FROM task_templates WHERE projectId = ?)",
  },
};
