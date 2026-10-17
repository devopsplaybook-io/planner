-- Project-level user permissions: one level per granted user on a
-- restricted project (all / update / comment / view). Existing
-- memberships keep full access.
ALTER TABLE project_users ADD COLUMN "permission" VARCHAR(20) NOT NULL DEFAULT 'all';
