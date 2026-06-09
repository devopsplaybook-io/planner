import * as jwt from "jsonwebtoken";
import { Config } from "../Config";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";

let config: Config;

export async function AuthInit(configIn: Config): Promise<void> {
  config = configIn;
}

export async function AuthGenerateJWT(user: User): Promise<string> {
  return jwt.sign(
    {
      exp: Math.floor(Date.now() / 1000) + config.JWT_VALIDITY_DURATION,
      userId: user.id,
      userName: user.name,
      role: user.role,
    },
    config.JWT_KEY,
  );
}

function jwtDecodeCached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Record<string, unknown> | null {
  if (req._jwtPayload) {
    return req._jwtPayload;
  }
  if (!req.headers.authorization) {
    return null;
  }
  try {
    const info = jwt.verify(
      req.headers.authorization.split(" ")[1],
      config.JWT_KEY,
    ) as Record<string, unknown>;
    req._jwtPayload = info;
    return info;
  } catch {
    return null;
  }
}

export async function AuthMustBeAuthenticated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  if (!jwtDecodeCached(req)) {
    res.status(403).send({ error: "Access Denied" });
    throw new Error("Access Denied");
  }
}

export async function AuthMustBeAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  const info = jwtDecodeCached(req);
  if (info?.role === "admin") {
    return;
  }
  res.status(403).send({ error: "Access Denied" });
  throw new Error("Access Denied");
}

export async function AuthGetUserSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<UserSession> {
  const userSession: UserSession = { isAuthenticated: false };
  const info = jwtDecodeCached(req);
  if (info) {
    userSession.userId = info.userId as string;
    userSession.userName = info.userName as string;
    userSession.role = info.role as "admin" | "user";
    userSession.isAuthenticated = true;
  }
  return userSession;
}
