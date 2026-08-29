CREATE TABLE IF NOT EXISTS push_subscriptions (
    "userId" VARCHAR(50) NOT NULL,
    "endpoint" TEXT NOT NULL PRIMARY KEY,
    "keys" TEXT NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS push_notifications_log (
    "taskId" VARCHAR(50) NOT NULL,
    "dueDate" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "dateSent" VARCHAR(100) NOT NULL,
    PRIMARY KEY ("taskId", "dueDate", "kind")
);
