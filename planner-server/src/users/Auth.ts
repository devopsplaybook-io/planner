import * as jwt from "jsonwebtoken";
import { Config } from "../Config";
import { User } from "../model/User";
import { UserSession } from "../model/UserSession";
import { ApiKeysDataGetByKey } from "./ApiKeysData";
import { UsersDataGet } from "./UsersData";

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
  let token: string | null = null;
  if (req.headers.authorization) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.query?.token) {
    token = req.query.token as string;
  }
  if (!token) {
    return null;
  }
  try {
    const info = jwt.verify(token, config.JWT_KEY) as Record<string, unknown>;
    req._jwtPayload = info;
    return info;
  } catch {
    return null;
  }
}

async function apiKeyDecodeCached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
): Promise<Record<string, unknown> | null> {
  if (req._apiKeyPayload) {
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
  const user = await UsersDataGet(keyRecord.userId);
  if (!user) {
    return null;
  }
  const info = {
    userId: user.id,
    userName: user.name,
    role: user.role,
  };
  req._apiKeyPayload = info;
  return info;
}

export async function AuthMustBeAuthenticated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
): Promise<void> {
  if (!(await jwtDecodeCached(req)) && !(await apiKeyDecodeCached(req))) {
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
  const jwtInfo = await jwtDecodeCached(req);
  const apiKeyInfo = await apiKeyDecodeCached(req);
  const info = jwtInfo || apiKeyInfo;
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
  const jwtInfo = await jwtDecodeCached(req);
  const apiKeyInfo = await apiKeyDecodeCached(req);
  const info = jwtInfo || apiKeyInfo;
  if (info) {
    userSession.userId = info.userId as string;
    userSession.userName = info.userName as string;
    userSession.role = info.role as "admin" | "user";
    userSession.isAuthenticated = true;
  }
  return userSession;
}
