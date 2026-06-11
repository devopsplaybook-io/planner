ALTER TABLE projects ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS project_users (
    projectId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id),
    FOREIGN KEY (userId) REFERENCES users(id),
    PRIMARY KEY (projectId, userId)
);
