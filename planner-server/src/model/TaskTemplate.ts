import { v4 as uuidv4 } from "uuid";
import { ChecklistItem } from "./Task";

export interface TaskTemplateComment {
  id: string;
  userId: string;
  userName?: string;
  text: string;
  dateCreated: string;
  dateUpdated?: string;
}

export interface TaskTemplateAttachment {
  id: string;
  fileName: string;
  filePath: string;
  dateCreated: string;
}

/**
 * Automation settings of a task template (template-only, never on tasks):
 * `scheduleCron` is a 5-field cron expression (null = no schedule), the two
 * flags shape the instance creation and `instanceStatus` optionally forces
 * the initial status of created instances (null = project's first status).
 */
export interface TaskTemplateAutomation {
  scheduleCron?: string | null;
  skipIfPreviousNotDone: boolean;
  addDateToTitle: boolean;
  instanceStatus?: string | null;
}

export class TaskTemplate {
  public static fromJson(json: Record<string, unknown>): TaskTemplate {
    if (!json) {
      return null;
    }
    const template = new TaskTemplate();
    if (json.id) {
      template.id = json.id as string;
    }
    template.projectId = json.projectId as string;
    template.title = json.title as string;
    template.description = (json.description as string) || "";
    template.priority = (json.priority as string) || "medium";
    if (json.scheduleCron) {
      template.scheduleCron = json.scheduleCron as string;
    }
    template.skipIfPreviousNotDone =
      json.skipIfPreviousNotDone === true ||
      json.skipIfPreviousNotDone === 1 ||
      json.skipIfPreviousNotDone === "1";
    template.addDateToTitle =
      json.addDateToTitle === true ||
      json.addDateToTitle === 1 ||
      json.addDateToTitle === "1";
    if (json.instanceStatus) {
      template.instanceStatus = json.instanceStatus as string;
    }
    if (json.dateCreated) {
      template.dateCreated = json.dateCreated as string;
    }
    if (json.dateUpdated) {
      template.dateUpdated = json.dateUpdated as string;
    }
    if (json.checklist) {
      try {
        template.checklist =
          typeof json.checklist === "string"
            ? JSON.parse(json.checklist as string)
            : (json.checklist as ChecklistItem[]);
      } catch {
        template.checklist = [];
      }
    }
    if (json.assignees) {
      template.assignees = json.assignees as { userId: string; userName?: string }[];
    }
    if (json.comments) {
      template.comments = json.comments as TaskTemplateComment[];
    }
    if (json.attachments) {
      template.attachments = json.attachments as TaskTemplateAttachment[];
    }
    if (json.labels) {
      template.labels = json.labels as string[];
    }
    return template;
  }

  public id: string;
  public projectId: string;
  public title: string;
  public description: string;
  public priority: string;
  public checklist: ChecklistItem[];
  public scheduleCron?: string;
  public skipIfPreviousNotDone: boolean;
  public addDateToTitle: boolean;
  public instanceStatus?: string;
  public assignees: { userId: string; userName?: string }[];
  public comments: TaskTemplateComment[];
  public attachments: TaskTemplateAttachment[];
  public labels: string[];
  public dateCreated: string;
  public dateUpdated: string;

  constructor() {
    this.id = uuidv4();
    this.description = "";
    this.priority = "medium";
    this.skipIfPreviousNotDone = false;
    this.addDateToTitle = false;
    this.checklist = [];
    this.assignees = [];
    this.comments = [];
    this.attachments = [];
    this.labels = [];
    this.dateCreated = new Date().toISOString();
    this.dateUpdated = new Date().toISOString();
  }

  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      projectId: this.projectId,
      title: this.title,
      description: this.description,
      priority: this.priority,
      checklist: this.checklist,
      automation: {
        scheduleCron: this.scheduleCron || null,
        skipIfPreviousNotDone: this.skipIfPreviousNotDone,
        addDateToTitle: this.addDateToTitle,
        instanceStatus: this.instanceStatus || null,
      },
      assignees: this.assignees,
      comments: this.comments,
      attachments: this.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        dateCreated: a.dateCreated,
      })),
      labels: this.labels,
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
  }
}
