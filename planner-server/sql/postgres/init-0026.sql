-- Dictation jobs are persisted so a result survives a server restart and can
-- be reopened from the recent-dictations list. Audio is never stored here:
-- plain dictation audio is deleted right after STT, voice-message audio stays
-- as the task attachment. Jobs expire (TTL) and are purged by a periodic
-- sweep. `revision` drives the long-poll push channel; `attachmentId` has no
-- foreign key (task_attachments.id has no unique constraint in PostgreSQL) but
-- a partial unique index prevents concurrent transcriptions of one attachment.
CREATE TABLE IF NOT EXISTS dictation_jobs (
    "id" UUID PRIMARY KEY,
    "userId" UUID NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'dictation',
    "taskId" UUID,
    "attachmentId" UUID,
    "commentId" UUID,
    "status" VARCHAR(20) NOT NULL,
    "stage" VARCHAR(20),
    "language" VARCHAR(20),
    "engine" VARCHAR(20) NOT NULL,
    "model" VARCHAR(100),
    "rawTranscript" TEXT,
    "polishedText" TEXT,
    "polished" BOOLEAN NOT NULL DEFAULT FALSE,
    "actions" TEXT,
    "actionsAvailable" BOOLEAN NOT NULL DEFAULT FALSE,
    "error" TEXT,
    "audioDurationMs" INTEGER,
    "queueMs" INTEGER,
    "sttMs" INTEGER,
    "polishMs" INTEGER,
    "actionsMs" INTEGER,
    "totalMs" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" VARCHAR(100) NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL,
    "dateUpdated" VARCHAR(100) NOT NULL,
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY ("taskId") REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dictation_jobs_user ON dictation_jobs ("userId", "dateCreated");

CREATE INDEX IF NOT EXISTS idx_dictation_jobs_expires ON dictation_jobs ("expiresAt");

CREATE INDEX IF NOT EXISTS idx_dictation_jobs_attachment ON dictation_jobs ("attachmentId");

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_jobs_attachment_processing
    ON dictation_jobs ("attachmentId")
    WHERE "attachmentId" IS NOT NULL AND "status" = 'processing';
