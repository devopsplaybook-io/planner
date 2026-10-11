-- Task dependencies: a directed link "this task depends on that task".
-- Composite primary key like task_assignees and both foreign keys cascade so
-- deleting either task removes the link from both sides.

CREATE TABLE IF NOT EXISTS task_dependencies (
    taskId VARCHAR(50) NOT NULL,
    dependsOnTaskId VARCHAR(50) NOT NULL,
    PRIMARY KEY (taskId, dependsOnTaskId),
    FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (dependsOnTaskId) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_taskId ON task_dependencies(taskId);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_dependsOnTaskId ON task_dependencies(dependsOnTaskId);
