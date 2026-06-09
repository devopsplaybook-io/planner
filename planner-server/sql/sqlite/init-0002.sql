CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    isDefault INTEGER NOT NULL DEFAULT 0,
    statuses TEXT NOT NULL DEFAULT '[]',
    dateCreated VARCHAR(100) NOT NULL
);
