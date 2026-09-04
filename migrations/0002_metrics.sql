-- Activation counters and unique visitors.
--
-- Deliberately separate from the submissions table. That table is pruned to
-- RETENTION_LIMIT rows (lib/store.js), so any count derived from it decays
-- silently as older rows drop; and resetting a counter to zero must never mean
-- deleting submission data. These two tables are append-and-update only.
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  reset_at TEXT
);

-- One row per distinct address: the primary key is what makes the list
-- non-repetitive, so no de-duplication is needed at read time.
CREATE TABLE IF NOT EXISTS visitors (
  ip TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors (last_seen DESC);
