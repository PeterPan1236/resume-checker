-- Every submission is retained in full, including the resume text. Treat this
-- table as PII: it is only reachable through the token-gated admin API.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,

  job_id TEXT NOT NULL,
  job_label TEXT NOT NULL,
  seniority TEXT NOT NULL,

  source TEXT NOT NULL,
  file_kind TEXT,
  filename TEXT,
  pages INTEGER,

  has_job_description INTEGER NOT NULL DEFAULT 0,
  job_description_source TEXT,

  deep INTEGER NOT NULL DEFAULT 0,
  analysis_ok INTEGER NOT NULL DEFAULT 0,
  analysis_error TEXT,

  overall INTEGER,
  dim_ats_parseability INTEGER,
  dim_structure INTEGER,
  dim_impact INTEGER,
  dim_language INTEGER,
  dim_job_fit INTEGER,
  dim_length INTEGER,

  word_count INTEGER,
  est_pages REAL,
  bullet_count INTEGER,
  quantified_pct INTEGER,
  strong_verb_pct INTEGER,

  criteria_score INTEGER,
  criteria_total INTEGER,
  criteria_must_met INTEGER,
  criteria_must_missing INTEGER,

  missing_keywords TEXT,
  warnings TEXT,

  resume_text TEXT NOT NULL,
  job_description_text TEXT,
  report_json TEXT NOT NULL,

  host TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_created_at ON submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_job_id ON submissions (job_id);
CREATE INDEX IF NOT EXISTS idx_submissions_seniority ON submissions (seniority);
CREATE INDEX IF NOT EXISTS idx_submissions_overall ON submissions (overall);
