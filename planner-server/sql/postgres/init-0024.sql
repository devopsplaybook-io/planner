-- One row per username: concurrent registrations (including the first-user
-- bootstrap) can no longer create duplicate names or ambiguous logins.
-- Rename the newer rows written before the constraint first, keeping the
-- oldest one per name: "<name truncated>#<id>" stays within the
-- 100-character name column for UUID ids.
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "name" ORDER BY "dateCreated", "id") AS rn
  FROM users
)
UPDATE users u
SET "name" = left(u."name", 99 - length(u."id"::text)) || '#' || u."id"::text
FROM ranked r
WHERE u."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users ("name");
