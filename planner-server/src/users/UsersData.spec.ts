import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { Config } from "../Config";
import { DbUtilsClose, DbUtilsExecSQL, DbUtilsInit } from "../utils/DbUtils";
import { RunMigrations } from "../DbMigrations";
import {
  UsersDataGet,
  UsersDataListNotificationDigestOptIn,
  UsersDataSetNotificationDigest,
} from "./UsersData";

/**
 * Integration tests of the per-user notification digest preference against a
 * real SQLite database: persistence and no tokenVersion bump (a settings
 * toggle must not revoke the user's sessions).
 */

const dir = path.join(os.tmpdir(), `planner-users-digest-${Date.now()}`);
const now = new Date().toISOString();

async function insertUser(id: string): Promise<void> {
  await DbUtilsExecSQL(
    "INSERT INTO users (id, name, passwordEncrypted, role, dateCreated, tokenVersion) VALUES (?,?,?,?,?,0)",
    [id, `user-${id}`, "x", "user", now],
  );
}

describe("UsersData notification digest (integration)", () => {
  beforeAll(async () => {
    await fs.remove(dir);
    await fs.ensureDir(dir);
    const config = new Config();
    config.DATA_DIR = dir;
    await DbUtilsInit(config);
    await RunMigrations();
  });

  afterAll(async () => {
    await DbUtilsClose();
    await fs.remove(dir);
  });

  it("should persist the digest preference without bumping tokenVersion", async () => {
    await insertUser("u-digest-persist");

    await UsersDataSetNotificationDigest("u-digest-persist", true);
    let user = await UsersDataGet("u-digest-persist");
    expect(user.notificationDigest).toBe(true);
    expect(user.tokenVersion).toBe(0);

    await UsersDataSetNotificationDigest("u-digest-persist", false);
    user = await UsersDataGet("u-digest-persist");
    expect(user.notificationDigest).toBe(false);
    expect(user.tokenVersion).toBe(0);
  });

  it("should default the digest to false and keep users independent", async () => {
    await insertUser("u-digest-off");
    await insertUser("u-digest-on");
    await UsersDataSetNotificationDigest("u-digest-on", true);

    expect((await UsersDataGet("u-digest-off")).notificationDigest).toBe(
      false,
    );
    expect((await UsersDataGet("u-digest-on")).notificationDigest).toBe(true);
  });

  it("should list only the users who opted in", async () => {
    await insertUser("u-optin-a");
    await insertUser("u-optin-b");
    await insertUser("u-optin-c");
    await UsersDataSetNotificationDigest("u-optin-a", true);
    await UsersDataSetNotificationDigest("u-optin-c", true);

    const optedIn = await UsersDataListNotificationDigestOptIn();
    expect(optedIn).toContain("u-optin-a");
    expect(optedIn).toContain("u-optin-c");
    expect(optedIn).not.toContain("u-optin-b");
  });
});
