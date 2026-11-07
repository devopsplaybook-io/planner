-- Dictation accuracy: custom vocabulary (hotwords), segment confidence,
-- raw-vs-polished trust and optional translation.
-- All additions are nullable/empty-safe: no backfill is needed and an older
-- server ignores the new columns/table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS "dictationTargetLanguage" VARCHAR(20);
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "segments" TEXT;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "targetLanguage" VARCHAR(20);

-- Per-user and optional per-project vocabulary. `term` keeps the display
-- casing, `normalizedTerm` (trimmed, whitespace-collapsed, lower-cased,
-- NFKC) backs the case-insensitive uniqueness of a scope. The partial
-- unique indexes enforce one scope per (user, term): personal terms have no
-- "projectId", project terms are scoped to their project.
CREATE TABLE IF NOT EXISTS dictation_vocabulary (
    "id" UUID PRIMARY KEY,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "term" VARCHAR(200) NOT NULL,
    "normalizedTerm" VARCHAR(200) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "dateCreated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictation_vocabulary_user
    ON dictation_vocabulary ("userId", "projectId");

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_vocabulary_user_term
    ON dictation_vocabulary ("userId", "normalizedTerm") WHERE "projectId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_vocabulary_project_term
    ON dictation_vocabulary ("projectId", "normalizedTerm") WHERE "projectId" IS NOT NULL;
