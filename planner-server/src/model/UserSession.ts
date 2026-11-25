import { UserRole } from "./User";

/**
 * How the request authenticated: an interactive JWT session or a long-lived
 * API key. Endpoints that mint credentials must only accept `"jwt"`.
 */
export type AuthCredentialType = "jwt" | "apiKey";

export interface UserSession {
  isAuthenticated: boolean;
  userId?: string;
  userName?: string;
  role?: UserRole;
  credentialType?: AuthCredentialType;
}
