import { Config } from "../Config";
import { DbUtilsQuerySQL } from "../utils/DbUtils";
import {
  NotificationsDataListAssigneesByTaskIds,
  NotificationsDataListSubscriptions,
  NotificationsDataListSubscriptionsByUser,
  NotificationsDataLogSent,
} from "./NotificationsData";
import { UsersDataList, UsersDataListNotificationDigestOptIn } from "../users/UsersData";
import { NotificationsCheckAndSend, NotificationsInit } from "./Notifications";

jest.mock("web-push", () => ({
  sendNotification: jest.fn(async () => undefined),
  setVapidDetails: jest.fn(),
  generateVAPIDKeys: jest.fn(() => ({
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  })),
}));

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
}));

jest.mock("../utils/DbUtils", () => ({
  DbUtilsGetType: jest.fn(() => "sqlite"),
  DbUtilsQuerySQL: jest.fn(async () => []),
}));

jest.mock("./NotificationsData", () => ({
  NotificationsDataDeleteSubscriptionByEndpoint: jest.fn(),
  NotificationsDataListAssigneesByTaskIds: jest.fn(async () => new Map()),
  NotificationsDataListSubscriptions: jest.fn(async () => []),
  NotificationsDataListSubscriptionsByUser: jest.fn(async () => []),
  NotificationsDataListVisibleProjectIds: jest.fn(async () => []),
  NotificationsDataLogSent: jest.fn(async () => true),
}));

jest.mock("../users/UsersData", () => ({
  UsersDataList: jest.fn(async () => []),
  UsersDataListNotificationDigestOptIn: jest.fn(async () => []),
}));

const mockQuerySQL = DbUtilsQuerySQL as jest.Mock;
const mockListSubscriptions = NotificationsDataListSubscriptions as jest.Mock;
const mockListSubscriptionsByUser =
  NotificationsDataListSubscriptionsByUser as jest.Mock;
const mockListAssignees = NotificationsDataListAssigneesByTaskIds as jest.Mock;
const mockLogSent = NotificationsDataLogSent as jest.Mock;
const mockUsersDataList = UsersDataList as jest.Mock;
const mockDigestOptIn = UsersDataListNotificationDigestOptIn as jest.Mock;

// 2026-10-15 10:00 local (after the default 9:00 notification hour)
const now = new Date(2026, 9, 15, 10, 0);

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

async function initNotifications(): Promise<void> {
  const config = new Config();
  config.WEB_PUSH_ENABLED = true;
  config.WEB_PUSH_VAPID_PUBLIC_KEY = "test-public-key";
  config.WEB_PUSH_VAPID_PRIVATE_KEY = "test-private-key";
  config.WEB_PUSH_NOTIFY_HOUR = 9;
  config.WEB_PUSH_TIMEZONE = "";
  await NotificationsInit(config);
}

describe("NotificationsCheckAndSend overlap guard", () => {
  beforeAll(async () => {
    await initNotifications();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuerySQL.mockResolvedValue([]);
    mockListSubscriptions.mockResolvedValue([]);
    mockListSubscriptionsByUser.mockResolvedValue([]);
    mockListAssignees.mockResolvedValue(new Map());
    mockLogSent.mockResolvedValue(true);
    mockUsersDataList.mockResolvedValue([]);
    mockDigestOptIn.mockResolvedValue([]);
  });

  it("should skip a run while the previous one is still in flight", async () => {
    const subscriptions = deferred<unknown[]>();
    mockListSubscriptions.mockReturnValue(subscriptions.promise);

    const run1 = NotificationsCheckAndSend(now);
    await flush();
    // The first run is paused inside the subscription lookup
    expect(mockListSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockQuerySQL).toHaveBeenCalledTimes(1);

    // A second tick while run 1 is in flight is a no-op
    await NotificationsCheckAndSend(now);
    expect(mockListSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockQuerySQL).toHaveBeenCalledTimes(1);

    subscriptions.resolve([]);
    await run1;

    // A run after the first one completed executes again
    mockListSubscriptions.mockResolvedValue([]);
    await NotificationsCheckAndSend(now);
    expect(mockListSubscriptions).toHaveBeenCalledTimes(2);
    expect(mockQuerySQL).toHaveBeenCalledTimes(2);
  });

  it("should query only tasks due before the local day after tomorrow", async () => {
    await NotificationsCheckAndSend(now);
    expect(mockQuerySQL).toHaveBeenCalledWith(
      "SELECT id, title, status, dueDate, projectId FROM tasks " +
        "WHERE dueDate IS NOT NULL AND dueDate < ? AND status != ?",
      ["2026-10-17", "Done"],
    );
  });
});

describe("NotificationsCheckAndSend subscription batching", () => {
  beforeAll(async () => {
    await initNotifications();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuerySQL.mockResolvedValue([
      {
        id: "t1",
        title: "Task one",
        status: "To Do",
        dueDate: "2026-10-15",
        projectId: "p1",
      },
    ]);
    mockListAssignees.mockResolvedValue(new Map([["t1", ["u1", "u2"]]]));
    mockLogSent.mockResolvedValue(true);
    mockUsersDataList.mockResolvedValue([
      { id: "u1", role: "admin" },
      { id: "u2", role: "admin" },
    ]);
    mockDigestOptIn.mockResolvedValue([]);
    mockListSubscriptions.mockResolvedValue([
      {
        userId: "u1",
        endpoint: "https://push.example/u1",
        keys: { p256dh: "k", auth: "a" },
        dateCreated: "2026-10-15T00:00:00.000Z",
      },
      {
        userId: "u2",
        endpoint: "https://push.example/u2",
        keys: { p256dh: "k", auth: "a" },
        dateCreated: "2026-10-15T00:00:00.000Z",
      },
    ]);
    mockListSubscriptionsByUser.mockResolvedValue([]);
  });

  it("should load the subscriptions once per run and group them per user", async () => {
    const webpush = jest.requireMock("web-push");

    await NotificationsCheckAndSend(now);

    expect(mockListSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockListSubscriptionsByUser).not.toHaveBeenCalled();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    expect(webpush.sendNotification.mock.calls[0][0].endpoint).toBe(
      "https://push.example/u1",
    );
    expect(webpush.sendNotification.mock.calls[1][0].endpoint).toBe(
      "https://push.example/u2",
    );
  });
});
