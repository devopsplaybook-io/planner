-- Voice inbox, non-blocking capture and long-form / meeting transcription.
-- Additive only: existing rows get safe defaults (short jobs, audio deleted
-- after transcription) and an older server ignores the new columns.

ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "jobKind" VARCHAR(20) NOT NULL DEFAULT 'short';
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "clientId" VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "archivedAt" VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "transcriptSegments" TEXT;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "decisionsJson" TEXT;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "chunkPlan" TEXT;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "segmentsDone" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "segmentsTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "audioPath" TEXT;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "audioRetained" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "audioDeletedAt" VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "convertedAt" VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "convertedType" VARCHAR(20);
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "convertedTargetId" VARCHAR(50);
-- Default project for the action items proposed by a meeting import
ALTER TABLE dictation_jobs ADD COLUMN IF NOT EXISTS "projectId" VARCHAR(50);

-- Inbox triage (archive state) and idempotent client uploads
CREATE INDEX IF NOT EXISTS idx_dictation_jobs_user_archived
    ON dictation_jobs ("userId", "archivedAt", "dateCreated");

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_jobs_user_client
    ON dictation_jobs ("userId", "clientId") WHERE "clientId" IS NOT NULL;

-- Startup recovery / sweep by kind and status
CREATE INDEX IF NOT EXISTS idx_dictation_jobs_kind_status
    ON dictation_jobs ("jobKind", "status");

ALTER TABLE users ADD COLUMN IF NOT EXISTS "notificationDictation" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "dictationKeepAudio" BOOLEAN NOT NULL DEFAULT FALSE;