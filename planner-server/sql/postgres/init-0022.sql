-- Optional initial status of the instances created from a task template:
-- when set, instances start in this status instead of the project's first
-- status. Validated against the template's project statuses by the API.
ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS "instanceStatus" VARCHAR(100);
