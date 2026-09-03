// Persistence for submitted resumes. Every write goes through a D1-shaped
// binding: `env.DB` on Workers, and the node:sqlite adapter in lib/sqlite-d1.js
// locally, so the same SQL runs on both hosts.

const KEYWORD_LIMIT = 20;

// D1 rejects rows past ~2 MB. Extraction already caps at 60k characters, but
// pasted text arrives uncapped, so the stored copy is clamped defensively.
const MAX_STORED_CHARS = 100_000;

function clampText(value) {
  if (typeof value !== 'string' || value.length <= MAX_STORED_CHARS) return value;
  return `${value.slice(0, MAX_STORED_CHARS)}\n\n[truncated for storage at ${MAX_STORED_CHARS} characters]`;
}

function newId() {
  return crypto.randomUUID();
}

function jsonOrNull(value) {
  return value == null ? null : JSON.stringify(value);
}

function bool(value) {
  return value ? 1 : 0;
}

/**
 * Flattens a completed check into the `submissions` row shape. The full report
 * is kept in `report_json`; the flattened columns exist so the admin queries can
 * filter and aggregate without parsing every row.
 */
export function buildSubmission({ meta, rules, analysis, analysisError, deep, text, jobDescription, host, userAgent }) {
  const dims = rules?.dimensions || {};
  const metrics = rules?.metrics || {};
  const criteria = rules?.criteria?.summary || null;

  return {
    id: newId(),
    created_at: new Date().toISOString(),

    job_id: meta.jobId,
    job_label: meta.jobLabel,
    seniority: meta.seniority,

    source: meta.filename ? 'file' : 'paste',
    file_kind: meta.fileKind ?? null,
    filename: meta.filename ?? null,
    pages: meta.pages ?? null,

    has_job_description: bool(meta.hasJobDescription),
    job_description_source: meta.jobDescriptionSource ?? null,

    deep: bool(deep),
    analysis_ok: bool(analysis),
    analysis_error: analysisError ?? null,

    overall: rules?.overall ?? null,
    dim_ats_parseability: dims.atsParseability ?? null,
    dim_structure: dims.structure ?? null,
    dim_impact: dims.impact ?? null,
    dim_language: dims.language ?? null,
    dim_job_fit: dims.jobFit ?? null,
    dim_length: dims.length ?? null,

    word_count: metrics.wordCount ?? null,
    est_pages: metrics.estPages ?? null,
    bullet_count: metrics.bulletCount ?? null,
    quantified_pct: metrics.quantifiedPct ?? null,
    strong_verb_pct: metrics.strongVerbPct ?? null,

    criteria_score: criteria?.score ?? null,
    criteria_total: criteria?.total ?? null,
    criteria_must_met: criteria?.mustMet ?? null,
    criteria_must_missing: criteria?.mustMissing ?? null,

    missing_keywords: jsonOrNull((rules?.keywords?.missing || []).slice(0, KEYWORD_LIMIT)),
    warnings: jsonOrNull(meta.warnings || []),

    resume_text: clampText(text),
    job_description_text: jobDescription && jobDescription.trim() ? clampText(jobDescription) : null,
    report_json: JSON.stringify({ meta, rules, analysis, analysisError }),

    host,
    user_agent: userAgent ?? null
  };
}

const COLUMNS = [
  'id', 'created_at', 'job_id', 'job_label', 'seniority', 'source', 'file_kind', 'filename', 'pages',
  'has_job_description', 'job_description_source', 'deep', 'analysis_ok', 'analysis_error', 'overall',
  'dim_ats_parseability', 'dim_structure', 'dim_impact', 'dim_language', 'dim_job_fit', 'dim_length',
  'word_count', 'est_pages', 'bullet_count', 'quantified_pct', 'strong_verb_pct',
  'criteria_score', 'criteria_total', 'criteria_must_met', 'criteria_must_missing',
  'missing_keywords', 'warnings', 'resume_text', 'job_description_text', 'report_json', 'host', 'user_agent'
];

const INSERT_SQL =
  `INSERT INTO submissions (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`;

// Retention: the table keeps the newest RETENTION_LIMIT submissions and drops the
// rest on every insert, so stored resumes age out instead of accumulating forever.
const RETENTION_LIMIT = Number(process.env.RETENTION_LIMIT) || 500;

const PRUNE_SQL = `
  DELETE FROM submissions
  WHERE id NOT IN (SELECT id FROM submissions ORDER BY created_at DESC, id DESC LIMIT ?)
`;

export async function pruneSubmissions(db, limit = RETENTION_LIMIT) {
  const out = await db.prepare(PRUNE_SQL).bind(limit).run();
  return out?.meta?.changes ?? out?.changes ?? 0;
}

export async function saveSubmission(db, row) {
  await db.prepare(INSERT_SQL).bind(...COLUMNS.map((c) => row[c] ?? null)).run();
  await pruneSubmissions(db);
  return row.id;
}

const LIST_COLUMNS = [
  'id', 'created_at', 'job_id', 'job_label', 'seniority', 'source', 'file_kind', 'filename', 'pages',
  'has_job_description', 'deep', 'analysis_ok', 'analysis_error', 'overall',
  'dim_ats_parseability', 'dim_structure', 'dim_impact', 'dim_language', 'dim_job_fit', 'dim_length',
  'word_count', 'est_pages', 'bullet_count', 'quantified_pct', 'strong_verb_pct',
  'criteria_score', 'criteria_total', 'criteria_must_met', 'criteria_must_missing', 'host'
];

const SORTS = {
  created_at: 'created_at',
  overall: 'overall',
  word_count: 'word_count'
};

export async function listSubmissions(db, filters = {}) {
  const { jobId, seniority, source, minScore, maxScore, search, sort, dir, limit, offset } = filters;
  const where = [];
  const params = [];

  if (jobId) { where.push('job_id = ?'); params.push(jobId); }
  if (seniority) { where.push('seniority = ?'); params.push(seniority); }
  if (source) { where.push('source = ?'); params.push(source); }
  if (Number.isFinite(minScore)) { where.push('overall >= ?'); params.push(minScore); }
  if (Number.isFinite(maxScore)) { where.push('overall <= ?'); params.push(maxScore); }
  if (search) {
    where.push('(resume_text LIKE ? OR filename LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = SORTS[sort] || 'created_at';
  const order = dir === 'asc' ? 'ASC' : 'DESC';
  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const skip = Math.max(Number(offset) || 0, 0);

  const rows = await db
    .prepare(`SELECT ${LIST_COLUMNS.join(', ')} FROM submissions ${clause} ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`)
    .bind(...params, take, skip)
    .all();

  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM submissions ${clause}`)
    .bind(...params)
    .first();

  return {
    total: total?.n ?? 0,
    limit: take,
    offset: skip,
    items: (rows?.results || []).map(inflateFlags)
  };
}

function inflateFlags(row) {
  return {
    ...row,
    has_job_description: !!row.has_job_description,
    deep: !!row.deep,
    analysis_ok: !!row.analysis_ok
  };
}

export async function getSubmission(db, id) {
  const row = await db.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first();
  if (!row) return null;
  return {
    ...inflateFlags(row),
    missing_keywords: row.missing_keywords ? JSON.parse(row.missing_keywords) : [],
    warnings: row.warnings ? JSON.parse(row.warnings) : [],
    report: JSON.parse(row.report_json)
  };
}

export async function deleteSubmission(db, id) {
  const out = await db.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
  return out?.meta?.changes ?? out?.changes ?? 0;
}

const BUCKETS = [
  ['0-39', 0, 39],
  ['40-59', 40, 59],
  ['60-74', 60, 74],
  ['75-89', 75, 89],
  ['90-100', 90, 100]
];

export async function submissionStats(db, { days } = {}) {
  const since = Number.isFinite(days) ? new Date(Date.now() - days * 86400000).toISOString() : null;
  const clause = since ? 'WHERE created_at >= ?' : '';
  const params = since ? [since] : [];

  const run = (sql) => {
    const stmt = db.prepare(sql);
    return params.length ? stmt.bind(...params) : stmt;
  };

  const totals = await run(`
    SELECT COUNT(*) AS submissions,
           AVG(overall) AS avg_overall,
           AVG(dim_ats_parseability) AS avg_ats,
           AVG(dim_structure) AS avg_structure,
           AVG(dim_impact) AS avg_impact,
           AVG(dim_language) AS avg_language,
           AVG(dim_job_fit) AS avg_job_fit,
           AVG(dim_length) AS avg_length,
           AVG(word_count) AS avg_word_count,
           AVG(quantified_pct) AS avg_quantified_pct,
           SUM(has_job_description) AS with_jd,
           SUM(deep) AS deep_runs,
           SUM(CASE WHEN deep = 1 AND analysis_ok = 0 THEN 1 ELSE 0 END) AS deep_failures
    FROM submissions ${clause}
  `).first();

  const byRole = await run(`
    SELECT job_id, job_label, COUNT(*) AS n, AVG(overall) AS avg_overall
    FROM submissions ${clause}
    GROUP BY job_id, job_label ORDER BY n DESC
  `).all();

  const bySeniority = await run(`
    SELECT seniority, COUNT(*) AS n, AVG(overall) AS avg_overall
    FROM submissions ${clause}
    GROUP BY seniority ORDER BY n DESC
  `).all();

  const bySource = await run(`
    SELECT source, file_kind, COUNT(*) AS n
    FROM submissions ${clause}
    GROUP BY source, file_kind ORDER BY n DESC
  `).all();

  const daily = await run(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, AVG(overall) AS avg_overall
    FROM submissions ${clause}
    GROUP BY day ORDER BY day DESC LIMIT 30
  `).all();

  const keywordRows = await run(`
    SELECT missing_keywords FROM submissions ${clause} ORDER BY created_at DESC LIMIT 500
  `).all();

  const counts = new Map();
  for (const row of keywordRows?.results || []) {
    if (!row.missing_keywords) continue;
    let list;
    try {
      list = JSON.parse(row.missing_keywords);
    } catch {
      continue;
    }
    for (const term of list) counts.set(term, (counts.get(term) || 0) + 1);
  }
  const topMissingKeywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([term, n]) => ({ term, n }));

  const distribution = [];
  for (const [label, lo, hi] of BUCKETS) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM submissions ${clause ? `${clause} AND` : 'WHERE'} overall BETWEEN ? AND ?`)
      .bind(...params, lo, hi)
      .first();
    distribution.push({ label, n: row?.n ?? 0 });
  }

  return {
    since,
    totals: totals || {},
    distribution,
    byRole: byRole?.results || [],
    bySeniority: bySeniority?.results || [],
    bySource: bySource?.results || [],
    daily: daily?.results || [],
    topMissingKeywords
  };
}
