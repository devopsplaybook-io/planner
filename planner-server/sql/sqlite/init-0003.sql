CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(50) NOT NULL,
    projectId VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(100) NOT NULL DEFAULT 'To Do',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    dueDate VARCHAR(100),
    checklist TEXT NOT NULL DEFAULT '[]',
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS task_assignees (
    taskId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id),
    FOREIGN KEY (userId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS task_comments (
    id VARCHAR(50) NOT NULL,
    taskId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_attachments (
    id VARCHAR(50) NOT NULL,
    taskId VARCHAR(50) NOT NULL,
    fileName VARCHAR(500) NOT NULL,
    filePath VARCHAR(1000) NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS task_labels (
    id VARCHAR(50) NOT NULL,
    taskId VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    FOREIGN KEY (taskId) REFERENCES tasks(id)
);
