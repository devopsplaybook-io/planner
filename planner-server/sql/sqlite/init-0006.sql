-- Add UNIQUE indexes on parent table id columns for foreign key support
-- (Existing tables were created without PRIMARY KEY, which breaks FK constraints)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id ON users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_id ON projects(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_id ON tasks(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_id ON notes(id);
