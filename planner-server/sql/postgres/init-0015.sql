-- Indexes on the columns used by list/dashboard/delete queries.

CREATE INDEX IF NOT EXISTS "idx_tasks_projectId" ON tasks("projectId");

CREATE INDEX IF NOT EXISTS "idx_tasks_dueDate" ON tasks("dueDate");

CREATE INDEX IF NOT EXISTS "idx_tasks_dateUpdated" ON tasks("dateUpdated");

CREATE INDEX IF NOT EXISTS "idx_task_labels_taskId" ON task_labels("taskId");

CREATE INDEX IF NOT EXISTS "idx_task_comments_taskId" ON task_comments("taskId");

CREATE INDEX IF NOT EXISTS "idx_task_assignees_taskId" ON task_assignees("taskId");

CREATE INDEX IF NOT EXISTS "idx_task_assignees_userId" ON task_assignees("userId");

CREATE INDEX IF NOT EXISTS "idx_task_attachments_taskId" ON task_attachments("taskId");

CREATE INDEX IF NOT EXISTS "idx_notes_projectId" ON notes("projectId");

CREATE INDEX IF NOT EXISTS "idx_note_comments_noteId" ON note_comments("noteId");

CREATE INDEX IF NOT EXISTS "idx_note_labels_noteId" ON note_labels("noteId");

CREATE INDEX IF NOT EXISTS "idx_note_attachments_noteId" ON note_attachments("noteId");

CREATE INDEX IF NOT EXISTS "idx_project_users_projectId" ON project_users("projectId");

CREATE INDEX IF NOT EXISTS "idx_project_users_userId" ON project_users("userId");

CREATE INDEX IF NOT EXISTS "idx_api_keys_userId" ON api_keys("userId");

CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_userId" ON push_subscriptions("userId");
