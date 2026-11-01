-- One row per username: concurrent registrations (including the first-user
-- bootstrap) can no longer create duplicate names or ambiguous logins.
-- Rename the newer rows written before the constraint first, keeping the
-- oldest one (MIN(rowid)) per name: "<name truncated>#<id>" stays within the
-- 100-character name column for UUID ids.
UPDATE users
SET name = substr(name, 1, 99 - length(id)) || '#' || id
WHERE rowid NOT IN (SELECT MIN(rowid) FROM users GROUP BY name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_name ON users (name);
