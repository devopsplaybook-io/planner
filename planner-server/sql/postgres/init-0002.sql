CREATE TABLE IF NOT EXISTS projects (
    "id" UUID PRIMARY KEY,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isDefault" INTEGER NOT NULL DEFAULT 0,
    "statuses" TEXT NOT NULL DEFAULT '[]',
    "dateCreated" VARCHAR(100) NOT NULL
);
