CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    statuses TEXT NOT NULL,
    dateUpdated VARCHAR(100)
);
