import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { Config } from "../Config";
import { User, UserRole } from "../model/User";
import { AuthCredentialType, UserSession } from "../model/UserSession";
import { ApiKeysDataGetByKey } from "./ApiKeysData";
import { UsersDataGet } from "./UsersData";

let config: Config;

/**
 * Short-lived cache of validated users (exists + current role + token
 * version). Bounds the per-request DB lookups while making session
 * revocation (role change, password change, deletion) effective within
 * seconds; explicit mutations invalidate the entry immediately.
 */
export const AUTH_USER_CACHE_TTL_MS = 30 * 1000;

interface CachedUser {
  userId: string;
  userName: string;
  role: UserRole;
  tokenVersion: number;
  expiresAt: number;
}

const userCache = new Map<string, CachedUser>();

export function AuthInit(configIn: Config): Promise<void> {
  config = configIn;
  userCache.clear();
  return Promise.resolve();
}

export function AuthInvalidateUserCache(userId?: string): void {
  if (userId) {
    userCache.delete(userId);
  } else {
    userCache.clear();
  }
}

async function getValidatedUser(userId: string): Promise<CachedUser | null> {
  const cached = userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const user = await UsersDataGet(userId);
  if (!user) {
    userCache.delete(userId);
    return null;
  }
  const entry: CachedUser = {
    userId: user.id,
    userName: user.name,
    role: user.role,
    tokenVersion: user.tokenVersion || 0,
    expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS,
  };
  userCache.set(userId, entry);
  return entry;
}

export async function AuthGenerateJWT(user: User): Promise<string> {
  return jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
      userId: user.id,
      userName: user.name,
      role: user.role,
      tv: user.tokenVersion || 0,
    },
    config.JWT_KEY,
  );
}

/**
 * A request's authenticated identity plus how it authenticated. The
 * credential type distinguishes an interactive JWT session (safe to mint a
 * new session) from a long-lived API key (not safe for that).
 */
export interface AuthCredentialSession {
  userId: string;
  userName: string;
  role: UserRole;
  credentialType: AuthCredentialType;
}

async function jwtDecodeCached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<Record<string, unknown> | null> {
  if (req._jwtPayload !== undefined) {
    if (req._jwtPayload) {
      req._authCredentialType = "jwt";
    }
    return req._jwtPayload;
  }
  let token: string | null = null;
  if (req.headers.authorization) {
    token = req.headers.authorization.split(" ")[1];
  }
  // The historical ?token= query fallback was removed on purpose: a JWT in a
  // URL leaks into logs, history and Referer headers.
  if (!token) {
    return null;
  }
  try {
    const info = jwt.verify(token, config.JWT_KEY) as Record<string, unknown>;
    // The token is only a claim: the user must still exist, keep the same
    // role and not have been revoked through a token version bump.
    const user = await getValidatedUser(info.userId as string);
    if (!user) {
      return null;
    }
    if (Number(info.tv || 0) !== user.tokenVersion) {
      return null;
    }
    const payload = {
      userId: user.userId,
      userName: user.userName,
      role: user.role,
    };
    req._jwtPayload = payload;
    req._authCredentialType = "jwt";
    return payload;
  } catch {
    return null;
  }
}

async function apiKeyDecodeCached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<Record<string, unknown> | null> {
  if (req._apiKeyPayload !== undefined) {
    // A request carrying both a valid JWT and a key keeps the JWT type: the
    // JWT wins in every caller, so the credential must be reported as such.
    if (req._apiKeyPayload && req._authCredentialType !== "jwt") {
      req._authCredentialType = "apiKey";
    }
    return req._apiKeyPayload;
  }
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    return null;
  }
  const keyRecord = await ApiKeysDataGetByKey(apiKey);
  if (!keyRecord) {
    return null;
  }
  const user = await getValidatedUser(keyRecord.userId);
  if (!user) {
    return null;
  }
  const info = {
    userId: user.userId,
    userName: user.userName,
    role: user.role,
  };
  req._apiKeyPayload = info;
  if (req._authCredentialType !== "jwt") {
    req._authCredentialType = "apiKey";
  }
  return info;
}

export async function AuthMustBeAuthenticated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  if (!(await jwtDecodeCached(req)) && !(await apiKeyDecodeCached(req))) {
    res.status(401).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

export async function AuthMustBeAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  const info = (await jwtDecodeCached(req)) || (await apiKeyDecodeCached(req));
  if (!info) {
    // Not authenticated at all: 401 (the client must log in again)
    res.status(401).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
  if (info.role !== "admin") {
    // Authenticated but lacking the permission: 403 (do not log the user out)
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

/**
 * Resolve the request identity and how it authenticated. JWT wins over an
 * API key when a request carries both (the historical precedence).
 */
export async function AuthGetCredentialSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<AuthCredentialSession | null> {
  const jwtInfo = await jwtDecodeCached(req);
  if (jwtInfo) {
    return {
      userId: jwtInfo.userId as string,
      userName: jwtInfo.userName as string,
      role: jwtInfo.role as UserRole,
      credentialType: "jwt",
    };
  }
  const apiKeyInfo = await apiKeyDecodeCached(req);
  if (apiKeyInfo) {
    return {
      userId: apiKeyInfo.userId as string,
      userName: apiKeyInfo.userName as string,
      role: apiKeyInfo.role as UserRole,
      credentialType: "apiKey",
    };
  }
  return null;
}

/**
 * Interactive session only: like {@link AuthGetCredentialSession} but returns
 * `null` for API keys. Endpoints that mint a new session on the caller's
 * behalf must use this so a leaked long-lived key cannot escalate into a
 * fresh interactive token.
 */
export async function AuthGetInteractiveSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<AuthCredentialSession | null> {
  const session = await AuthGetCredentialSession(req);
  if (!session || session.credentialType !== "jwt") {
    return null;
  }
  return session;
}

export async function AuthGetUserSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false };
  const credential = await AuthGetCredentialSession(req);
  if (credential) {
    userSession.userId = credential.userId;
    userSession.userName = credential.userName;
    userSession.role = credential.role;
    userSession.credentialType = credential.credentialType;
    userSession.isAuthenticated = true;
  }
  return userSession;
}

/**
 * Rate-limit key for the current request: the authenticated user when a
 * verifiable JWT is present, otherwise a hash of the API key, otherwise the
 * client IP. Signature-only check (no database), suitable for the
 * rate-limit hook that runs before the route handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function AuthRateLimitKey(req: any): string {
  const authHeader = req.headers?.authorization as string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const info = jwt.verify(
        authHeader.split(" ")[1],
        config.JWT_KEY,
      ) as Record<string, unknown>;
      if (info?.userId) {
        return `user:${info.userId}`;
      }
    } catch {
      // Fall through to the other identifiers
    }
  }
  const apiKey = req.headers?.["x-api-key"] as string | undefined;
  if (apiKey) {
    return `key:${crypto.createHash("sha256").update(apiKey).digest("hex")}`;
  }
  return `ip:${req.ip}`;
}
