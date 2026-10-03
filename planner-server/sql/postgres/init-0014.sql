-- Align the PostgreSQL schema with SQLite: same foreign keys, same cascades.

-- Remove child rows referencing missing parents (defensive: FK enforcement
-- may not have been active on every deployment).
DELETE FROM task_labels WHERE "taskId" NOT IN (SELECT id FROM tasks);

DELETE FROM task_assignees WHERE "taskId" NOT IN (SELECT id FROM tasks);

DELETE FROM task_assignees WHERE "userId" NOT IN (SELECT id FROM users);

DELETE FROM task_comments WHERE "taskId" NOT IN (SELECT id FROM tasks);

DELETE FROM task_attachments WHERE "taskId" NOT IN (SELECT id FROM tasks);

DELETE FROM note_labels WHERE "noteId" NOT IN (SELECT id FROM notes);

DELETE FROM note_comments WHERE "noteId" NOT IN (SELECT id FROM notes);

DELETE FROM note_attachments WHERE "noteId" NOT IN (SELECT id FROM notes);

DELETE FROM project_users WHERE "projectId" NOT IN (SELECT id FROM projects);

DELETE FROM project_users WHERE "userId" NOT IN (SELECT id FROM users);

DELETE FROM api_keys WHERE "userId" NOT IN (SELECT id FROM users);

DELETE FROM push_subscriptions WHERE "userId" NOT IN (SELECT id FROM users);

-- The historical migrations declared these FK columns as VARCHAR while the
-- parent columns are UUID: assign the matching type so the constraints can
-- be created.
ALTER TABLE IF EXISTS project_users ALTER COLUMN "projectId" TYPE UUID USING "projectId"::uuid;

ALTER TABLE IF EXISTS project_users ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

ALTER TABLE IF EXISTS api_keys ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

ALTER TABLE IF EXISTS push_subscriptions ALTER COLUMN "userId" TYPE UUID USING "userId"::uuid;

-- Replace the legacy foreign keys with cascading ones.
ALTER TABLE IF EXISTS project_users DROP CONSTRAINT IF EXISTS project_users_projectId_fkey;

ALTER TABLE IF EXISTS project_users DROP CONSTRAINT IF EXISTS project_users_userId_fkey;

ALTER TABLE IF EXISTS api_keys DROP CONSTRAINT IF EXISTS api_keys_userId_fkey;

ALTER TABLE IF EXISTS project_users ADD CONSTRAINT project_users_projectId_fkey FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS project_users ADD CONSTRAINT project_users_userId_fkey FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS api_keys ADD CONSTRAINT api_keys_userId_fkey FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;

-- Add the missing foreign keys (parity with SQLite).
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_projectId_fkey;

ALTER TABLE tasks ADD CONSTRAINT tasks_projectId_fkey FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_projectId_fkey;

ALTER TABLE notes ADD CONSTRAINT notes_projectId_fkey FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_taskId_fkey;

ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_taskId_fkey FOREIGN KEY ("taskId") REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_userId_fkey;

ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_userId_fkey FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE task_comments DROP CONSTRAINT IF EXISTS task_comments_taskId_fkey;

ALTER TABLE task_comments ADD CONSTRAINT task_comments_taskId_fkey FOREIGN KEY ("taskId") REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE task_attachments DROP CONSTRAINT IF EXISTS task_attachments_taskId_fkey;

ALTER TABLE task_attachments ADD CONSTRAINT task_attachments_taskId_fkey FOREIGN KEY ("taskId") REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE task_labels DROP CONSTRAINT IF EXISTS task_labels_taskId_fkey;

ALTER TABLE task_labels ADD CONSTRAINT task_labels_taskId_fkey FOREIGN KEY ("taskId") REFERENCES tasks(id) ON DELETE CASCADE;

ALTER TABLE note_comments DROP CONSTRAINT IF EXISTS note_comments_noteId_fkey;

ALTER TABLE note_comments ADD CONSTRAINT note_comments_noteId_fkey FOREIGN KEY ("noteId") REFERENCES notes(id) ON DELETE CASCADE;

ALTER TABLE note_attachments DROP CONSTRAINT IF EXISTS note_attachments_noteId_fkey;

ALTER TABLE note_attachments ADD CONSTRAINT note_attachments_noteId_fkey FOREIGN KEY ("noteId") REFERENCES notes(id) ON DELETE CASCADE;

ALTER TABLE note_labels DROP CONSTRAINT IF EXISTS note_labels_noteId_fkey;

ALTER TABLE note_labels ADD CONSTRAINT note_labels_noteId_fkey FOREIGN KEY ("noteId") REFERENCES notes(id) ON DELETE CASCADE;

ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_userId_fkey;

ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_userId_fkey FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;
