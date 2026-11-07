-- Structured dictation actions: idempotent apply/undo bookkeeping and
-- per-user custom command phrases.
-- Additive only: an older server ignores both new tables.

-- One row per applied/attempted proposal. "beforeJson" is the undo snapshot
-- and is never exposed through the API. The unique index makes a retried
-- apply request idempotent per action.
CREATE TABLE IF NOT EXISTS dictation_job_actions (
    "id" UUID PRIMARY KEY,
    "jobId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestId" VARCHAR(100) NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "targetId" UUID,
    "targetType" VARCHAR(50),
    "error" TEXT,
    "beforeJson" TEXT,
    "undoneAt" VARCHAR(100),
    "dateCreated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("jobId") REFERENCES dictation_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictation_job_actions_job
    ON dictation_job_actions ("jobId");

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_job_actions_request
    ON dictation_job_actions ("jobId", "requestId", "actionIndex");

-- Custom command phrases: a deterministic prefix ("create task in X") that
-- maps to exactly one project or template target. "phrase" keeps the display
-- casing; "normalizedPhrase" backs case/whitespace-insensitive uniqueness.
CREATE TABLE IF NOT EXISTS dictation_phrases (
    "id" UUID PRIMARY KEY,
    "userId" UUID NOT NULL,
    "phrase" VARCHAR(200) NOT NULL,
    "normalizedPhrase" VARCHAR(200) NOT NULL,
    "projectId" UUID,
    "templateId" VARCHAR(50),
    "labels" TEXT NOT NULL DEFAULT '[]',
    "dateCreated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY ("projectId") REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY ("templateId") REFERENCES task_templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dictation_phrases_user
    ON dictation_phrases ("userId");

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_phrases_user_phrase
    ON dictation_phrases ("userId", "normalizedPhrase");
