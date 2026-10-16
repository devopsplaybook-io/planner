-- Recurring tasks: per-task recurrence rule (JSON) driving the automatic
-- creation of the next occurrence when the task is completed.

ALTER TABLE tasks ADD COLUMN "recurrence" TEXT;
