-- Daily notification digest: per-user preference for one consolidated
-- reminders push per day instead of one push per task.

ALTER TABLE users ADD COLUMN notificationDigest INTEGER NOT NULL DEFAULT 0;
