-- Task templates: blueprint tasks created manually or on a cron schedule,
-- replacing the per-task recurrence mechanism (init-0019). The child tables
-- mirror the task pattern; task_template_runs records every created instance
-- so the scheduler can apply "skip if the previous instance is still open".

CREATE TABLE IF NOT EXISTS task_templates (
    id VARCHAR(50) PRIMARY KEY,
    "projectId" UUID NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    checklist TEXT NOT NULL DEFAULT '[]',
    "scheduleCron" VARCHAR(100),
    "skipIfPreviousNotDone" BOOLEAN NOT NULL DEFAULT FALSE,
    "addDateToTitle" BOOLEAN NOT NULL DEFAULT FALSE,
    "dateCreated" VARCHAR(100) NOT NULL,
    "dateUpdated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_template_assignees (
    "templateId" VARCHAR(50) NOT NULL,
    "userId" UUID NOT NULL,
    PRIMARY KEY ("templateId", "userId"),
    FOREIGN KEY ("templateId") REFERENCES task_templates(id) ON DELETE CASCADE,
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_template_labels (
    id VARCHAR(50) NOT NULL,
    "templateId" VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    FOREIGN KEY ("templateId") REFERENCES task_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_template_comments (
    id VARCHAR(50) NOT NULL,
    "templateId" VARCHAR(50) NOT NULL,
    "userId" VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL,
    "dateUpdated" VARCHAR(100),
    FOREIGN KEY ("templateId") REFERENCES task_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_template_attachments (
    id VARCHAR(50) NOT NULL,
    "templateId" VARCHAR(50) NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "filePath" VARCHAR(1000) NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("templateId") REFERENCES task_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_template_runs (
    id VARCHAR(50) NOT NULL,
    "templateId" VARCHAR(50) NOT NULL,
    "taskId" VARCHAR(50) NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("templateId") REFERENCES task_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_templates_projectId ON task_templates("projectId");

CREATE INDEX IF NOT EXISTS idx_task_template_assignees_templateId ON task_template_assignees("templateId");

CREATE INDEX IF NOT EXISTS idx_task_template_labels_templateId ON task_template_labels("templateId");

CREATE INDEX IF NOT EXISTS idx_task_template_comments_templateId ON task_template_comments("templateId");

CREATE INDEX IF NOT EXISTS idx_task_template_attachments_templateId ON task_template_attachments("templateId");

CREATE INDEX IF NOT EXISTS idx_task_template_runs_templateId ON task_template_runs("templateId");
