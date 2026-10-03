ALTER TABLE projects ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS project_users (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    FOREIGN KEY ("projectId") REFERENCES projects(id),
    FOREIGN KEY ("userId") REFERENCES users(id),
    PRIMARY KEY ("projectId", "userId")
);
