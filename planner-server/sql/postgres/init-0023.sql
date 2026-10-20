-- One row per (taskId, name): concurrent label mutations cannot create
-- duplicates. Deduplicate the rows written before the constraint first,
-- keeping the oldest one per pair (the DELETE removes every newer row).
DELETE FROM task_labels t USING task_labels d WHERE t."taskId" = d."taskId" AND t."name" = d."name" AND t."id" > d."id";

CREATE UNIQUE INDEX idx_task_labels_taskId_name ON task_labels ("taskId", "name");
