import { v4 as uuidv4 } from "uuid";

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskComment {
  id: string;
  userId: string;
  userName?: string;
  text: string;
  dateCreated: string;
  dateUpdated?: string;
}

export interface TaskAttachment {
  id: string;
  fileName: string;
  filePath: string;
  dateCreated: string;
}

export interface TaskAssignee {
  userId: string;
  userName?: string;
}

/**
 * One entry of a task's dependencies: a reference to another task, hydrated
 * with the dependency's current title and status so consumers can evaluate
 * "all dependencies Done" from a single response.
 */
export interface TaskDependency {
  taskId: string;
  title?: string;
  status?: string;
}

/**
 * Top-level keys of the task transport shape, in response order. Used by
 * the list endpoint's sparse fieldsets: a "fields" query param names a
 * subset of these and unrequested keys are omitted from the response.
 */
export const TASK_TRANSPORT_FIELDS = [
  "id",
  "projectId",
  "title",
  "description",
  "status",
  "priority",
  "dueDate",
  "checklist",
  "assignees",
  "comments",
  "attachments",
  "labels",
  "dependencies",
  "dateCreated",
  "dateUpdated",
] as const;

export class Task {
  public static fromJson(json: Record<string, unknown>): Task {
    if (!json) {
      return null;
    }
    const task = new Task();
    if (json.id) {
      task.id = json.id as string;
    }
    task.projectId = json.projectId as string;
    task.title = json.title as string;
    task.description = (json.description as string) || "";
    task.status = (json.status as string) || "To Do";
    task.priority = (json.priority as string) || "medium";
    task.dueDate = json.dueDate as string | undefined;
    if (json.dateCreated) {
      task.dateCreated = json.dateCreated as string;
    }
    if (json.dateUpdated) {
      task.dateUpdated = json.dateUpdated as string;
    }
    if (json.checklist) {
      try {
        task.checklist =
          typeof json.checklist === "string"
            ? JSON.parse(json.checklist as string)
            : (json.checklist as ChecklistItem[]);
      } catch {
        task.checklist = [];
      }
    }
    if (json.assignees) {
      task.assignees = json.assignees as TaskAssignee[];
    }
    if (json.comments) {
      task.comments = json.comments as TaskComment[];
    }
    if (json.attachments) {
      task.attachments = json.attachments as TaskAttachment[];
    }
    if (json.labels) {
      task.labels = json.labels as string[];
    }
    if (json.dependencies) {
      task.dependencies = json.dependencies as TaskDependency[];
    }
    return task;
  }

  public id: string;
  public projectId: string;
  public title: string;
  public description: string;
  public status: string;
  public priority: string;
  public dueDate?: string;
  public checklist: ChecklistItem[];
  public assignees: TaskAssignee[];
  public comments: TaskComment[];
  public attachments: TaskAttachment[];
  public labels: string[];
  public dependencies: TaskDependency[];
  public dateCreated: string;
  public dateUpdated: string;

  constructor() {
    this.id = uuidv4();
    this.description = "";
    this.status = "To Do";
    this.priority = "medium";
    this.checklist = [];
    this.assignees = [];
    this.comments = [];
    this.attachments = [];
    this.labels = [];
    this.dependencies = [];
    this.dateCreated = new Date().toISOString();
    this.dateUpdated = new Date().toISOString();
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      projectId: this.projectId,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      dueDate: this.dueDate || null,
      checklist: JSON.stringify(this.checklist),
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
  }

  /**
   * Without fields (or with every field requested) the full transport
   * shape is emitted; otherwise only the requested keys are emitted and
   * unrequested keys are omitted entirely (never sent as empty values).
   */
  public toTransportJson(fields?: ReadonlySet<string>): Record<string, unknown> {
    const json: Record<string, unknown> = {
      id: this.id,
      projectId: this.projectId,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      dueDate: this.dueDate,
      checklist: this.checklist,
      assignees: this.assignees,
      comments: this.comments,
      attachments: this.attachments,
      labels: this.labels,
      dependencies: this.dependencies,
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
    if (!fields || fields.size >= TASK_TRANSPORT_FIELDS.length) {
      return json;
    }
    const filtered: Record<string, unknown> = {};
    for (const field of TASK_TRANSPORT_FIELDS) {
      if (fields.has(field)) {
        filtered[field] = json[field];
      }
    }
    return filtered;
  }
}
