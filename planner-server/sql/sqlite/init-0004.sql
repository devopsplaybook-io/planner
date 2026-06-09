CREATE TABLE IF NOT EXISTS notes (
    id VARCHAR(50) NOT NULL,
    projectId VARCHAR(50) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dateCreated VARCHAR(100) NOT NULL,
    dateUpdated VARCHAR(100) NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS note_comments (
    id VARCHAR(50) NOT NULL,
    noteId VARCHAR(50) NOT NULL,
    userId VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (noteId) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS note_attachments (
    id VARCHAR(50) NOT NULL,
    noteId VARCHAR(50) NOT NULL,
    fileName VARCHAR(500) NOT NULL,
    filePath VARCHAR(1000) NOT NULL,
    dateCreated VARCHAR(100) NOT NULL,
    FOREIGN KEY (noteId) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS note_labels (
    id VARCHAR(50) NOT NULL,
    noteId VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    FOREIGN KEY (noteId) REFERENCES notes(id)
);
