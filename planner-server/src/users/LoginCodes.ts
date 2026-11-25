import {
  LoginCodesEvent,
  LoginCodesOptionsFromConfig,
  LoginCodesSettings,
  LoginCodesStore,
} from "@devopsplaybook.io/common-utils/users/login-codes";
import { LoginCodesRoutesOptions } from "@devopsplaybook.io/common-utils/users/login-codes";
import { Config } from "../Config";
import { AuthGenerateJWT, AuthGetCredentialSession } from "./Auth";
import { LoginCodesDataCreateStore } from "./LoginCodesData";
import { UserPasswordCheckPassword } from "./UserPassword";
import { UsersDataGet } from "./UsersData";

/**
 * Resolve the login-code settings from Planner's own `Config` (there is no
 * `ConfigBase`): the library's config reader applies every default and clamp.
 */
export function LoginCodesBuildSettings(config: Config): LoginCodesSettings {
  return LoginCodesOptionsFromConfig({
    LOGIN_CODE_ENABLED: config.LOGIN_CODE_ENABLED,
    LOGIN_CODE_TTL_SECONDS: config.LOGIN_CODE_TTL_SECONDS,
    LOGIN_CODE_ROTATION_SECONDS: config.LOGIN_CODE_ROTATION_SECONDS,
    LOGIN_CODE_GRACE_SECONDS: config.LOGIN_CODE_GRACE_SECONDS,
    LOGIN_CODE_POLL_INTERVAL_MS: config.LOGIN_CODE_POLL_INTERVAL_MS,
    LOGIN_CODE_MAX_ATTEMPTS: config.LOGIN_CODE_MAX_ATTEMPTS,
    LOGIN_CODE_MAX_PENDING: config.LOGIN_CODE_MAX_PENDING,
    LOGIN_CODE_RATE_LIMIT_CREATE_MAX: config.LOGIN_CODE_RATE_LIMIT_CREATE_MAX,
    LOGIN_CODE_RATE_LIMIT_POLL_MAX: config.LOGIN_CODE_RATE_LIMIT_POLL_MAX,
    LOGIN_CODE_RATE_LIMIT_APPROVE_MAX: config.LOGIN_CODE_RATE_LIMIT_APPROVE_MAX,
    LOGIN_CODE_APPROVE_REQUIRE_PASSWORD:
      config.LOGIN_CODE_APPROVE_REQUIRE_PASSWORD,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: config.LOGIN_CODE_RATE_LIMIT_WINDOW_SECONDS,
  });
}

/**
 * Structured audit log for the login-code flow. Only allow-listed fields are
 * written: the event type never carries a code, request token or header, so
 * this sink can never leak a secret into the logs.
 */
export function LoginCodesLogEvent(event: LoginCodesEvent): void {
  console.log(
    "[LoginCodes] " +
      JSON.stringify({
        type: event.type,
        requestId: event.requestId,
        userId: event.userId,
        userName: event.userName,
        deviceLabel: event.deviceLabel,
        reason: event.reason,
        ip: event.ip,
      }),
  );
}

/**
 * Build the `LoginCodesRoutes` options for Planner: the DB-backed store, an
 * approver that must be an interactive JWT session (API keys are flagged so
 * the library answers 403), a session issuer matching `POST /users/session`,
 * the bcrypt password check and the structured event log.
 */
export function LoginCodesBuildRoutesOptions(
  config: Config,
  store: LoginCodesStore = LoginCodesDataCreateStore(),
): LoginCodesRoutesOptions {
  return {
    ...LoginCodesBuildSettings(config),
    store,
    // Evaluated lazily at the first request; an empty key makes the feature
    // answer 503 instead of crashing the plugin.
    hashKey: () => config.JWT_KEY,
    getApprovingUser: async (req) => {
      const session = await AuthGetCredentialSession(req);
      if (!session) {
        return null;
      }
      if (session.credentialType === "apiKey") {
        // Flagged so LoginCodesRoutes answers 403: a long-lived API key must
        // never be able to approve a sign-in and mint a fresh session.
        return { id: session.userId, name: session.userName, isApiToken: true };
      }
      return { id: session.userId, name: session.userName };
    },
    getUserById: async (id) => {
      const user = await UsersDataGet(id);
      return user ? { id: user.id, name: user.name } : null;
    },
    issueSession: async (approver) => {
      // Re-read the user live: the approver may have been deleted since the
      // approval. A missing user aborts the redemption (fails closed).
      const userData = await UsersDataGet(approver.id);
      if (!userData) {
        throw new Error("Login code approver no longer exists");
      }
      return {
        token: await AuthGenerateJWT(userData),
        user: userData.toTransportJson(),
      };
    },
    verifyPassword: async (approver, password) => {
      const userData = await UsersDataGet(approver.id);
      if (!userData) {
        return false;
      }
      return UserPasswordCheckPassword(userData, password);
    },
    onEvent: LoginCodesLogEvent,
  };
}
