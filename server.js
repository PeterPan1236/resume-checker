import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extractText, ExtractError } from './lib/extract.js';
import { runRules } from './lib/rules.js';
import { deepAnalyze } from './lib/analyze.js';
import { listJobs, listSeniority, JOB_PROFILES, SENIORITY } from './lib/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.RESUME_PORT || 3100;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 }
});

const uploadFields = upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'jobDescriptionFile', maxCount: 1 }
]);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
    res.json({
      meta: {
        jobId,
        jobLabel: JOB_PROFILES[jobId].label,
        seniority,
        fileKind: kind,
        pages,
        filename: resumeFile?.originalname || null,
        hasJobDescription: jobDescription.trim().length > 40,
        jobDescriptionSource,
        warnings: [...warnings, ...jdWarnings]
      },
      rules: rulesOut,
      analysis,
      analysisError
    });
  } catch (err) {
    if (err instanceof ExtractError) return res.status(400).json({ error: err.message });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is larger than 8 MB.' });
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong while checking the resume.' });
  }
});

app.listen(PORT, () => {
  console.log(`Resume checker running at http://localhost:${PORT}`);
});
