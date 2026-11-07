-- Voice inbox, non-blocking capture and long-form / meeting transcription.
-- Additive only: existing rows get safe defaults (short jobs, audio deleted
-- after transcription) and an older server ignores the new columns.

ALTER TABLE dictation_jobs ADD COLUMN jobKind VARCHAR(20) NOT NULL DEFAULT 'short';
ALTER TABLE dictation_jobs ADD COLUMN clientId VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN archivedAt VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN transcriptSegments TEXT;
ALTER TABLE dictation_jobs ADD COLUMN summary TEXT;
ALTER TABLE dictation_jobs ADD COLUMN decisionsJson TEXT;
ALTER TABLE dictation_jobs ADD COLUMN chunkPlan TEXT;
ALTER TABLE dictation_jobs ADD COLUMN segmentsDone INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dictation_jobs ADD COLUMN segmentsTotal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dictation_jobs ADD COLUMN audioPath TEXT;
ALTER TABLE dictation_jobs ADD COLUMN audioRetained INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dictation_jobs ADD COLUMN audioDeletedAt VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN convertedAt VARCHAR(100);
ALTER TABLE dictation_jobs ADD COLUMN convertedType VARCHAR(20);
ALTER TABLE dictation_jobs ADD COLUMN convertedTargetId VARCHAR(50);
-- Default project for the action items proposed by a meeting import
ALTER TABLE dictation_jobs ADD COLUMN projectId VARCHAR(50);

-- Inbox triage (archive state) and idempotent client uploads
CREATE INDEX IF NOT EXISTS idx_dictation_jobs_user_archived
    ON dictation_jobs (userId, archivedAt, dateCreated);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dictation_jobs_user_client
    ON dictation_jobs (userId, clientId) WHERE clientId IS NOT NULL;

-- Startup recovery / sweep by kind and status
CREATE INDEX IF NOT EXISTS idx_dictation_jobs_kind_status
    ON dictation_jobs (jobKind, status);

ALTER TABLE users ADD COLUMN notificationDictation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN dictationKeepAudio INTEGER NOT NULL DEFAULT 0;