-- Daily notification digest: per-user preference for one consolidated
-- reminders push per day instead of one push per task.

ALTER TABLE users ADD COLUMN "notificationDigest" BOOLEAN NOT NULL DEFAULT FALSE;
