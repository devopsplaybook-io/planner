import { v4 as uuidv4 } from "uuid";

export interface NoteComment {
  id: string;
  userId: string;
  userName?: string;
  text: string;
  dateCreated: string;
}

export interface NoteAttachment {
  id: string;
  fileName: string;
  filePath: string;
  dateCreated: string;
}

export class Note {
  public static fromJson(json: Record<string, unknown>): Note {
    if (!json) {
      return null;
    }
    const note = new Note();
    if (json.id) {
      note.id = json.id as string;
    }
    note.projectId = json.projectId as string;
    note.title = json.title as string;
    note.description = (json.description as string) || "";
    if (json.comments) {
      note.comments = json.comments as NoteComment[];
    }
    if (json.attachments) {
      note.attachments = json.attachments as NoteAttachment[];
    }
    if (json.labels) {
      note.labels = json.labels as string[];
    }
    return note;
  }

  public id: string;
  public projectId: string;
  public title: string;
  public description: string;
  public comments: NoteComment[];
  public attachments: NoteAttachment[];
  public labels: string[];
  public dateCreated: string;
  public dateUpdated: string;

  constructor() {
    this.id = uuidv4();
    this.description = "";
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
      comments: this.comments,
      attachments: this.attachments,
      labels: this.labels,
      dateCreated: this.dateCreated,
      dateUpdated: this.dateUpdated,
    };
  }
}
