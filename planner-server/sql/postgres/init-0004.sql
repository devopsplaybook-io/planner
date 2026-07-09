CREATE TABLE IF NOT EXISTS notes (
    "id" UUID PRIMARY KEY,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dateCreated" VARCHAR(100) NOT NULL,
    "dateUpdated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS note_comments (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS note_attachments (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "filePath" VARCHAR(1000) NOT NULL,
    "dateCreated" VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS note_labels (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL
);
