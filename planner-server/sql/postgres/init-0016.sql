-- Task activity log: one row per task mutation, listed newest first in the
-- Update Feed. No foreign key on actorUserId: deleting a user must not erase
-- the history they created (actorName falls back to NULL in queries).

CREATE TABLE IF NOT EXISTS task_activity (
    "id" UUID PRIMARY KEY,
    "taskId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("taskId") REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_task_activity_taskId" ON task_activity("taskId");

CREATE INDEX IF NOT EXISTS "idx_task_activity_dateCreated" ON task_activity("dateCreated");
