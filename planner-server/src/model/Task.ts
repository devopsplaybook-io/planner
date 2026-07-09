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

  public toTransportJson(): Record<string, unknown> {
    return {
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
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
  }
}
