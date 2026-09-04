// Lockout for the admin surface. Shared by both hosts, like everything in lib/.
//
// The token check alone allows unlimited guesses; this bounds them. Defaults are
// deliberately strict, since the admin API returns stored resumes in full.

export const MAX_FAILURES = Number(process.env.ADMIN_MAX_FAILURES) || 5;
export const LOCKOUT_MS = Number(process.env.ADMIN_LOCKOUT_MS) || 15 * 60 * 1000;

// Failures older than this stop counting, so an honest typo months ago does not
// combine with one today to trigger a lockout.
export const WINDOW_MS = Number(process.env.ADMIN_WINDOW_MS) || 15 * 60 * 1000;

// Repeat offenders are locked out for longer: the base lockout doubles per extra
// failure past the threshold, capped so a lockout is never permanent.
const MAX_LOCKOUT_MS = 60 * 60 * 1000;

function lockoutFor(failures) {
  const extra = Math.max(0, failures - MAX_FAILURES);
  return Math.min(LOCKOUT_MS * 2 ** extra, MAX_LOCKOUT_MS);
}

/**
 * Is this address currently locked out? Returns seconds remaining when it is.
 *
 * Fails open: a storage error here must not lock every administrator out of the
 * console. The token is still required either way, so an open failure costs
 * rate limiting, not authentication.
 */
export async function checkLock(db, ip) {
  if (!db || !ip) return { locked: false };
  try {
    const row = await db
      .prepare('SELECT failures, last_failure, locked_until FROM admin_attempts WHERE ip = ?')
      .bind(ip)
      .first();
    if (!row?.locked_until) return { locked: false };
    const remaining = Date.parse(row.locked_until) - Date.now();
    if (remaining <= 0) return { locked: false };
    return { locked: true, retryAfter: Math.ceil(remaining / 1000), failures: row.failures };
  } catch (err) {
    console.error('Rate limit check failed:', err);
    return { locked: false };
  }
}

/**
 * Count a failed attempt and lock the address once it crosses the threshold.
 * Returns the resulting state so the caller can report it.
 */
export async function recordFailure(db, ip) {
  if (!db || !ip) return { failures: 0, locked: false };
  const now = Date.now();
  const iso = new Date(now).toISOString();
  try {
    const row = await db
      .prepare('SELECT failures, last_failure FROM admin_attempts WHERE ip = ?')
      .bind(ip)
      .first();

    // Outside the window the count restarts rather than accumulating forever.
    const stale = row && now - Date.parse(row.last_failure) > WINDOW_MS;
    const failures = row && !stale ? row.failures + 1 : 1;

    const locked = failures >= MAX_FAILURES;
    const lockedUntil = locked ? new Date(now + lockoutFor(failures)).toISOString() : null;

    await db
      .prepare(
        `INSERT INTO admin_attempts (ip, failures, first_failure, last_failure, locked_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET
           failures = excluded.failures,
           last_failure = excluded.last_failure,
           locked_until = excluded.locked_until`
      )
      .bind(ip, failures, iso, iso, lockedUntil)
      .run();

    return {
      failures,
      locked,
      remaining: Math.max(0, MAX_FAILURES - failures),
      retryAfter: locked ? Math.ceil(lockoutFor(failures) / 1000) : 0
    };
  } catch (err) {
    console.error('Rate limit record failed:', err);
    return { failures: 0, locked: false, remaining: MAX_FAILURES };
  }
}

/** A correct token clears the address's history. */
export async function clearFailures(db, ip) {
  if (!db || !ip) return;
  try {
    await db.prepare('DELETE FROM admin_attempts WHERE ip = ?').bind(ip).run();
  } catch (err) {
    console.error('Rate limit clear failed:', err);
  }
}

/** For the admin console: who is currently locked out. */
export async function listLockouts(db) {
  const { results } = await db
    .prepare(
      `SELECT ip, failures, first_failure, last_failure, locked_until FROM admin_attempts
       ORDER BY last_failure DESC LIMIT 100`
    )
    .all();
  const now = Date.now();
  return (results || []).map((r) => ({
    ip: r.ip,
    failures: r.failures,
    firstFailure: r.first_failure,
    lastFailure: r.last_failure,
    lockedUntil: r.locked_until,
    active: Boolean(r.locked_until && Date.parse(r.locked_until) > now)
  }));
}
