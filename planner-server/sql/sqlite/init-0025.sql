-- One settings row per category: the save becomes an upsert and duplicate
-- reads can no longer return an arbitrary row. Settings are app-managed
-- documents, so keeping the most recently written physical row is safe.
DELETE FROM settings WHERE rowid NOT IN (SELECT MAX(rowid) FROM settings GROUP BY category);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_category ON settings (category);
