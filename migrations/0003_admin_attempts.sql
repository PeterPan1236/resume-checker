-- Failed admin authentication attempts, keyed by address.
--
-- Without this the admin token faces unlimited online guessing: checkAdminAuth
-- compares and returns 401 with no counter, no backoff and no lockout, so a
-- short token is only as strong as the attacker's patience.
--
-- A row exists only while an address has recent failures; it is cleared on a
-- successful authentication and pruned once the lockout has expired.
CREATE TABLE IF NOT EXISTS admin_attempts (
  ip TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  first_failure TEXT NOT NULL,
  last_failure TEXT NOT NULL,
  locked_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_attempts_locked ON admin_attempts (locked_until);
