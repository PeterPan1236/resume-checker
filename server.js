import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractText, ExtractError } from './lib/extract.js';
import { runRules } from './lib/rules.js';
import { deepAnalyze } from './lib/analyze.js';
import { listJobs, listSeniority, JOB_PROFILES, SENIORITY } from './lib/jobs.js';
import { openLocalD1 } from './lib/sqlite-d1.js';
import { buildSubmission, saveSubmission } from './lib/store.js';
import { handleAdmin, isAdminPath } from './lib/admin.js';
import { generateCoverLetter } from './lib/cover-letter.js';
import { recordActivation } from './lib/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.RESUME_PORT || 3100;
const DB_PATH = process.env.RESUME_DB || path.join(__dirname, 'data', 'submissions.sqlite');

const db = openLocalD1(DB_PATH);

// Every migration, in filename order, so a new one lands without a manual step.
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
for (const file of (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 }
});

const uploadFields = upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'jobDescriptionFile', maxCount: 1 }
]);

// req.ip reports the socket address unless Express is told to trust a proxy.
// Off by default: with it on anyone can spoof X-Forwarded-For, so it is only safe
// when a proxy you control actually sits in front. Set TRUST_PROXY to enable.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Workers' Assets binding drops the .html extension, so /admin is the canonical
// path there. Express answers the same path so both hosts match.
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/options', (_req, res) => {
  res.json({ jobs: listJobs(), seniority: listSeniority() });
});

app.get('/api/sample', async (_req, res) => {
  try {
    const [text, jobDescription] = await Promise.all([
      readFile(path.join(__dirname, 'sample-resume.txt'), 'utf8'),
      readFile(path.join(__dirname, 'sample-job-description.txt'), 'utf8')
    ]);
    res.json({ text, jobDescription, jobId: 'software_engineer', seniority: 'senior' });
  } catch {
    res.status(404).json({ error: 'Sample resume is not available.' });
  }
});

app.post('/api/check', uploadFields, async (req, res) => {
  try {
    const jobId = JOB_PROFILES[req.body.jobId] ? req.body.jobId : 'general';
    const seniority = SENIORITY[req.body.seniority] ? req.body.seniority : 'mid';
    const deep = req.body.deep !== 'false';
    const resumeFile = req.files?.resume?.[0] || null;
    const jdFile = req.files?.jobDescriptionFile?.[0] || null;

    let jobDescription = (req.body.jobDescription || '').slice(0, 12000);
    let jobDescriptionSource = jobDescription.trim().length > 40 ? 'text' : null;
    let jdWarnings = [];
    if (jdFile) {
      const jd = await extractText(jdFile.buffer, jdFile.originalname, jdFile.mimetype);
      jobDescription = jd.text.slice(0, 12000);
      jobDescriptionSource = jdFile.originalname;
      jdWarnings = (jd.warnings || []).map((w) => `Job description file: ${w}`);
      if (jobDescription.trim().length < 40) {
        return res.status(400).json({ error: 'No readable text found in the job description file. Paste the posting text instead.' });
      }
    }

    let text;
    let kind = 'txt';
    let pages = null;
    let warnings = [];

    if (resumeFile) {
      const out = await extractText(resumeFile.buffer, resumeFile.originalname, resumeFile.mimetype);
      ({ text, kind, pages, warnings } = out);
    } else if ((req.body.text || '').trim().length >= 80) {
      text = req.body.text.trim();
    } else {
      return res.status(400).json({ error: 'Upload a PDF, DOCX, DOC, or TXT file, or paste at least a few lines of resume text.' });
    }

    const rules = runRules(text, { jobId, seniority, jobDescription, pages, fileKind: kind });

    let analysis = null;
    let analysisError = null;
    if (deep) {
      try {
        analysis = await deepAnalyze({ text, jobId, seniority, jobDescription, rules });
      } catch (err) {
        analysisError = err.message || 'Deep analysis failed.';
      }
    }

    const { bullets, ...rulesOut } = rules;
    const meta = {
      jobId,
      jobLabel: JOB_PROFILES[jobId].label,
      seniority,
      fileKind: kind,
      pages,
      filename: resumeFile?.originalname || null,
      hasJobDescription: jobDescription.trim().length > 40,
      jobDescriptionSource,
      warnings: [...warnings, ...jdWarnings]
    };

    // A storage failure must not cost the user their report.
    try {
      await saveSubmission(
        db,
        buildSubmission({
          meta,
          rules: rulesOut,
          analysis,
          analysisError,
          deep,
          text,
          jobDescription,
          host: 'node',
          userAgent: req.get('user-agent') || null
        })
      );
    } catch (storeErr) {
      console.error('Failed to store submission:', storeErr);
    }

    await recordActivation(db, { name: 'check_run', ip: req.ip });

    // resumeText goes back so the cover letter can be generated without a
    // re-upload and without reading stored data back out of the database.
    res.json({ meta, rules: rulesOut, analysis, analysisError, resumeText: text });
  } catch (err) {
    if (err instanceof ExtractError) return res.status(400).json({ error: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is larger than 8 MB.' });
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong while checking the resume.' });
  }
});

app.post('/api/cover-letter', async (req, res) => {
  try {
    const jobId = JOB_PROFILES[req.body?.jobId] ? req.body.jobId : 'general';
    const seniority = SENIORITY[req.body?.seniority] ? req.body.seniority : 'mid';
    const text = (req.body?.text || '').trim();
    const jobDescription = (req.body?.jobDescription || '').slice(0, 12000);
    const evidence = Array.isArray(req.body?.evidence) ? req.body.evidence.slice(0, 6) : [];

    if (text.length < 80) {
      return res.status(400).json({ error: 'Run a check first — the cover letter is written from your resume.' });
    }

    const letter = await generateCoverLetter({ text, jobId, seniority, jobDescription, evidence });
    await recordActivation(db, { name: 'cover_letter_run', ip: req.ip });
    res.json({ letter });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || 'Cover letter generation failed.' });
  }
});

app.all(/^\/api\/admin(\/.*)?$/, async (req, res) => {
  if (!isAdminPath(req.path)) return res.status(404).json({ error: 'Unknown admin endpoint.' });
  try {
    const { status, body, headers } = await handleAdmin({
      db,
      method: req.method,
      url: new URL(req.originalUrl, `http://localhost:${PORT}`),
      authorization: req.get('authorization'),
      adminToken: process.env.ADMIN_TOKEN,
      ip: req.ip
    });
    if (headers) res.set(headers);
    res.status(status).json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Admin query failed.' });
  }
});

app.listen(PORT, () => {
  console.log(`Resume checker running at http://localhost:${PORT}`);
});
