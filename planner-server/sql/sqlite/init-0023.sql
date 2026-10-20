-- One row per (taskId, name): concurrent label mutations cannot create
-- duplicates. Deduplicate the rows written before the constraint first,
-- keeping the oldest one (MIN(id)) per pair.
DELETE FROM task_labels WHERE id NOT IN (SELECT MIN(id) FROM task_labels GROUP BY taskId, name);

CREATE UNIQUE INDEX idx_task_labels_taskId_name ON task_labels (taskId, name);
