-- Align the SQLite schema with PostgreSQL: same foreign keys, same cascades.
-- SQLite cannot ALTER TABLE ADD CONSTRAINT, so the child tables (and the
-- tasks/notes parents, for their project cascade) are rebuilt. Foreign key
-- enforcement is disabled during the rebuild so the copy is neither
-- validated nor cascaded. It is re-enabled at the end.

-- Remove child rows referencing missing parents (declared FKs were never
-- enforced before this migration).
DELETE FROM task_labels WHERE taskId NOT IN (SELECT id FROM tasks);

DELETE FROM task_assignees WHERE taskId NOT IN (SELECT id FROM tasks);

DELETE FROM task_assignees WHERE userId NOT IN (SELECT id FROM users);

DELETE FROM task_comments WHERE taskId NOT IN (SELECT id FROM tasks);

DELETE FROM task_attachments WHERE taskId NOT IN (SELECT id FROM tasks);

DELETE FROM note_labels WHERE noteId NOT IN (SELECT id FROM notes);

DELETE FROM note_comments WHERE noteId NOT IN (SELECT id FROM notes);

DELETE FROM note_attachments WHERE noteId NOT IN (SELECT id FROM notes);

DELETE FROM project_users WHERE projectId NOT IN (SELECT id FROM projects);

DELETE FROM project_users WHERE userId NOT IN (SELECT id FROM users);

DELETE FROM api_keys WHERE userId NOT IN (SELECT id FROM users);

DELETE FROM push_subscriptions WHERE userId NOT IN (SELECT id FROM users);

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS tasks_new;
CREATE TABLE tasks_new (
    id VARCHAR(50) PRIMARY KEY,
    projectId VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(100) NOT NULL DEFAULT 'To Do',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    dueDate VARCHAR(100),
    checklist TEXT NOT NULL DEFAULT '[]',
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
INSERT INTO tasks_new (id, projectId, title, description, status, priority, dueDate, checklist, dateCreated, dateUpdated) SELECT id, projectId, title, description, status, priority, dueDate, checklist, dateCreated, dateUpdated FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

DROP TABLE IF EXISTS notes_new;
CREATE TABLE notes_new (
    id VARCHAR(50) PRIMARY KEY,
    projectId VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
INSERT INTO notes_new (id, projectId, title, description, dateCreated, dateUpdated) SELECT id, projectId, title, description, dateCreated, dateUpdated FROM notes;
DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

DROP TABLE IF EXISTS task_assignees_new;
CREATE TABLE task_assignees_new (
    taskId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO task_assignees_new (taskId, userId) SELECT taskId, userId FROM task_assignees;
DROP TABLE task_assignees;
ALTER TABLE task_assignees_new RENAME TO task_assignees;

DROP TABLE IF EXISTS task_comments_new;
CREATE TABLE task_comments_new (
    id VARCHAR(50) NOT NULL,
    taskId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100),
    FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
);
INSERT INTO task_comments_new (id, taskId, userId, text, dateCreated, dateUpdated) SELECT id, taskId, userId, text, dateCreated, dateUpdated FROM task_comments;
DROP TABLE task_comments;
ALTER TABLE task_comments_new RENAME TO task_comments;

DROP TABLE IF EXISTS task_attachments_new;
CREATE TABLE task_attachments_new (
    id VARCHAR(50) NOT NULL,
    taskId VARCHAR(50) NOT NULL,
    fileName VARCHAR(500) NOT NULL,
    filePath VARCHAR(1000) NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
);
INSERT INTO task_attachments_new (id, taskId, fileName, filePath, dateCreated) SELECT id, taskId, fileName, filePath, dateCreated FROM task_attachments;
DROP TABLE task_attachments;
ALTER TABLE task_attachments_new RENAME TO task_attachments;

DROP TABLE IF EXISTS task_labels_new;
CREATE TABLE task_labels_new (
    id VARCHAR(50) NOT NULL,
    taskId VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
);
INSERT INTO task_labels_new (id, taskId, name) SELECT id, taskId, name FROM task_labels;
DROP TABLE task_labels;
ALTER TABLE task_labels_new RENAME TO task_labels;

DROP TABLE IF EXISTS note_comments_new;
CREATE TABLE note_comments_new (
    id VARCHAR(50) NOT NULL,
    noteId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100),
    FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
);
INSERT INTO note_comments_new (id, noteId, userId, text, dateCreated, dateUpdated) SELECT id, noteId, userId, text, dateCreated, dateUpdated FROM note_comments;
DROP TABLE note_comments;
ALTER TABLE note_comments_new RENAME TO note_comments;

DROP TABLE IF EXISTS note_attachments_new;
CREATE TABLE note_attachments_new (
    id VARCHAR(50) NOT NULL,
    noteId VARCHAR(50) NOT NULL,
    fileName VARCHAR(500) NOT NULL,
    filePath VARCHAR(1000) NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
);
INSERT INTO note_attachments_new (id, noteId, fileName, filePath, dateCreated) SELECT id, noteId, fileName, filePath, dateCreated FROM note_attachments;
DROP TABLE note_attachments;
ALTER TABLE note_attachments_new RENAME TO note_attachments;

DROP TABLE IF EXISTS note_labels_new;
CREATE TABLE note_labels_new (
    id VARCHAR(50) NOT NULL,
    noteId VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    FOREIGN KEY (noteId) REFERENCES notes(id) ON DELETE CASCADE
);
INSERT INTO note_labels_new (id, noteId, name) SELECT id, noteId, name FROM note_labels;
DROP TABLE note_labels;
ALTER TABLE note_labels_new RENAME TO note_labels;

DROP TABLE IF EXISTS project_users_new;
CREATE TABLE project_users_new (
    projectId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (projectId, userId)
);
INSERT INTO project_users_new (projectId, userId) SELECT projectId, userId FROM project_users;
DROP TABLE project_users;
ALTER TABLE project_users_new RENAME TO project_users;

DROP TABLE IF EXISTS api_keys_new;
CREATE TABLE api_keys_new (
    id VARCHAR(50) PRIMARY KEY,
    userId VARCHAR(50) NOT NULL UNIQUE,
    key VARCHAR(200) NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    keyHash VARCHAR(200),
    keyPrefix VARCHAR(50),
    expiresAt VARCHAR(100),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO api_keys_new (id, userId, key, dateCreated, keyHash, keyPrefix, expiresAt) SELECT id, userId, key, dateCreated, keyHash, keyPrefix, expiresAt FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_new RENAME TO api_keys;

DROP TABLE IF EXISTS push_subscriptions_new;
CREATE TABLE push_subscriptions_new (
    userId VARCHAR(50) NOT NULL,
    endpoint TEXT NOT NULL PRIMARY KEY,
    keys TEXT NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO push_subscriptions_new (userId, endpoint, keys, dateCreated) SELECT userId, endpoint, keys, dateCreated FROM push_subscriptions;
DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

PRAGMA foreign_keys = ON;
