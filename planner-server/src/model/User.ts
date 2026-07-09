import { v4 as uuidv4 } from "uuid";

export type UserRole = "admin" | "user";

export class User {
  public static fromJson(json: Record<string, unknown>): User {
    if (!json) {
      return null;
    }
    const user = new User();
    if (json.id) {
      user.id = json.id as string;
    }
    user.name = json.name as string;
    user.passwordEncrypted = json.passwordEncrypted as string;
    user.role = (json.role as UserRole) || "user";
    return user;
  }

  public id: string;
  public name: string;
  public passwordEncrypted: string;
  public role: UserRole = "user";
  public dateCreated: string;

  constructor() {
    this.id = uuidv4();
    this.dateCreated = new Date().toISOString();
  }

  public toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      passwordEncrypted: this.passwordEncrypted,
      role: this.role,
      dateCreated: this.dateCreated,
    };
  }

  public toTransportJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
    };
  }
}
