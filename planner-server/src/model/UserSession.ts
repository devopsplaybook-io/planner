import { UserRole } from "./User";

export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  userName?: string;
  role?: UserRole;
}
