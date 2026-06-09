CREATE TABLE IF NOT EXISTS tasks (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(100) NOT NULL DEFAULT 'To Do',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "dueDate" VARCHAR(100),
    "checklist" TEXT NOT NULL DEFAULT '[]',
    "dateCreated" VARCHAR(100) NOT NULL,
    "dateUpdated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS task_assignees (
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL
);

CREATE TABLE IF NOT EXISTS task_comments (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS task_attachments (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "filePath" VARCHAR(1000) NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS task_labels (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL
);
