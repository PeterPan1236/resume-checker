// Activation counters and unique-visitor tracking.
//
// Kept out of lib/store.js because these numbers must outlive the submissions
// table: store.js prunes to RETENTION_LIMIT rows, so counts derived from
// submissions decay as old rows drop. See migrations/0002_metrics.sql.

// The known counters. Anything not listed here is rejected, so a typo at a call
// site cannot quietly create a third counter nobody reads.
export const COUNTERS = {
  check_run: 'Run the check',
  cover_letter_run: 'Cover letter generated'
};

export async function bumpCounter(db, name) {
  if (!db || !(name in COUNTERS)) return;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO counters (name, count, updated_at) VALUES (?, 1, ?)
       ON CONFLICT(name) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
    )
    .bind(name, now)
    .run();
}

export async function recordVisitor(db, ip) {
  if (!db || !ip) return;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO visitors (ip, first_seen, last_seen, hits) VALUES (?, ?, ?, 1)
       ON CONFLICT(ip) DO UPDATE SET last_seen = excluded.last_seen, hits = hits + 1`
    )
    .bind(ip, now, now)
    .run();
}

/**
 * One call site for both, so the two hosts stay identical. Never throws: metrics
 * are not worth costing a user their report.
 */
export async function recordActivation(db, { name, ip }) {
  if (!db) return;
  try {
    await bumpCounter(db, name);
    await recordVisitor(db, ip);
  } catch (err) {
    console.error('Failed to record activation:', err);
  }
}

/**
 * Every known counter is returned whether or not it has ever been incremented,
 * so the admin shows an explicit 0 rather than an empty table.
 */
export async function listCounters(db) {
  const { results } = await db.prepare('SELECT name, count, updated_at, reset_at FROM counters').all();
  const byName = new Map((results || []).map((r) => [r.name, r]));
  return Object.entries(COUNTERS).map(([name, label]) => {
    const row = byName.get(name);
    return {
      name,
      label,
      count: row?.count ?? 0,
      updatedAt: row?.updated_at ?? null,
      resetAt: row?.reset_at ?? null
    };
  });
}

/**
 * Zeroes one counter, or all of them when `name` is omitted. The row is kept and
 * stamped rather than deleted, so the admin can see when the reset happened.
 */
export async function resetCounters(db, name) {
  const now = new Date().toISOString();
  // Report only what was actually reset. Echoing an unknown name back as though
  // it had been zeroed is a lie the caller cannot detect.
  const names = (name ? [name] : Object.keys(COUNTERS)).filter((n) => n in COUNTERS);
  for (const n of names) {
    await db
      .prepare(
        `INSERT INTO counters (name, count, updated_at, reset_at) VALUES (?, 0, ?, ?)
         ON CONFLICT(name) DO UPDATE SET count = 0, updated_at = excluded.updated_at, reset_at = excluded.reset_at`
      )
      .bind(n, now, now)
      .run();
  }
  return { reset: names, at: now };
}

export async function listVisitors(db, { limit = 200, offset = 0 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const skip = Math.max(Number(offset) || 0, 0);
  const [{ results }, total] = await Promise.all([
    db
      .prepare('SELECT ip, first_seen, last_seen, hits FROM visitors ORDER BY last_seen DESC LIMIT ? OFFSET ?')
      .bind(capped, skip)
      .all(),
    db.prepare('SELECT COUNT(*) AS n FROM visitors').first('n')
  ]);
  return {
    unique: total ?? 0,
    limit: capped,
    offset: skip,
    visitors: (results || []).map((r) => ({
      ip: r.ip,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      hits: r.hits
    }))
  };
}

export async function clearVisitors(db) {
  await db.prepare('DELETE FROM visitors').run();
  return { cleared: true, at: new Date().toISOString() };
}
