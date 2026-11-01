import { jwtDecode } from "jwt-decode";

interface JwtExpiryPayload {
  exp?: number;
}

/**
 * Whether the token can no longer be used locally. Empty, malformed and
 * token without expiry are treated as expired so an unreadable session
 * never renders authenticated UI.
 */
export function isTokenExpired(token: string, now: number = Date.now()): boolean {
  if (!token) {
    return true;
  }
  try {
    const { exp } = jwtDecode<JwtExpiryPayload>(token);
    return typeof exp !== "number" || exp * 1000 <= now;
  } catch {
    return true;
  }
}
