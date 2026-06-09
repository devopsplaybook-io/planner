import { v4 as uuidv4 } from "uuid";

export const DEFAULT_STATUSES = ["To Do", "In Progress", "Done"];

export class Project {
  public static fromJson(json: Record<string, unknown>): Project {
    if (!json) {
      return null;
    }
    const project = new Project();
    if (json.id) {
      project.id = json.id as string;
    }
    project.name = json.name as string;
    project.description = (json.description as string) || "";
    project.isDefault = json.isDefault === true || json.isDefault === 1;
    if (json.statuses) {
      try {
        project.statuses =
          typeof json.statuses === "string"
            ? JSON.parse(json.statuses as string)
            : (json.statuses as string[]);
      } catch {
        project.statuses = [...DEFAULT_STATUSES];
      }
    }
    return project;
  }

  public id: string;
  public name: string;
  public description: string;
  public isDefault: boolean;
  public statuses: string[];
  public dateCreated: string;

  constructor() {
    this.id = uuidv4();
    this.description = "";
    this.isDefault = false;
    this.statuses = [...DEFAULT_STATUSES];
    this.dateCreated = new Date().toISOString();
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isDefault: this.isDefault,
      statuses: JSON.stringify(this.statuses),
      dateCreated: this.dateCreated,
    };
  }

  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      isDefault: this.isDefault,
      statuses: this.statuses,
    };
  }
}
