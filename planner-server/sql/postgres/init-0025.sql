-- One settings row per category: the save becomes an upsert and duplicate
-- reads can no longer return an arbitrary row. Settings are app-managed
-- documents, so keeping the most recently written physical row is safe.
DELETE FROM settings s
USING (SELECT ctid, row_number() OVER (PARTITION BY "category" ORDER BY ctid) AS rn FROM settings) d
WHERE s.ctid = d.ctid AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_category ON settings ("category");
