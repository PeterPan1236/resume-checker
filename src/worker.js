import { extractText, ExtractError } from '../lib/extract.js';
import { runRules } from '../lib/rules.js';
import { deepAnalyze } from '../lib/analyze.js';
import { listJobs, listSeniority, JOB_PROFILES, SENIORITY } from '../lib/jobs.js';
import { buildSubmission, saveSubmission } from '../lib/store.js';
import { handleAdmin, isAdminPath } from '../lib/admin.js';
import { generateCoverLetter } from '../lib/cover-letter.js';
import { recordActivation } from '../lib/metrics.js';
import sampleResume from '../sample-resume.txt';
import sampleJobDescription from '../sample-job-description.txt';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

// Cloudflare populates CF-Connecting-IP with the true client address; the
// x-forwarded-for fallback only matters for wrangler dev.
function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    null
  );
}

async function fileToBuffer(file) {
  if (file.size > MAX_FILE_BYTES) throw new ExtractError('File is larger than 8 MB.');
  return Buffer.from(await file.arrayBuffer());
}

function field(form, name) {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

function filePart(form, name) {
  const v = form.get(name);
  return v && typeof v !== 'string' && v.size > 0 ? v : null;
}

async function handleCheck(request, env, ctx) {
  const form = await request.formData();

  const jobId = JOB_PROFILES[field(form, 'jobId')] ? field(form, 'jobId') : 'general';
  const seniority = SENIORITY[field(form, 'seniority')] ? field(form, 'seniority') : 'mid';
  const deep = field(form, 'deep') !== 'false';
  const resumeFile = filePart(form, 'resume');
  const jdFile = filePart(form, 'jobDescriptionFile');

  let jobDescription = field(form, 'jobDescription').slice(0, 12000);
  let jobDescriptionSource = jobDescription.trim().length > 40 ? 'text' : null;
  let jdWarnings = [];
  if (jdFile) {
    const jd = await extractText(await fileToBuffer(jdFile), jdFile.name, jdFile.type);
    jobDescription = jd.text.slice(0, 12000);
    jobDescriptionSource = jdFile.name;
    jdWarnings = (jd.warnings || []).map((w) => `Job description file: ${w}`);
    if (jobDescription.trim().length < 40) {
      return json({ error: 'No readable text found in the job description file. Paste the posting text instead.' }, 400);
    }
  }

  let text;
  let kind = 'txt';
  let pages = null;
  let warnings = [];

  if (resumeFile) {
    const out = await extractText(await fileToBuffer(resumeFile), resumeFile.name, resumeFile.type);
    ({ text, kind, pages, warnings } = out);
  } else if (field(form, 'text').trim().length >= 80) {
    text = field(form, 'text').trim();
  } else {
    return json({ error: 'Upload a PDF, DOCX, DOC, or TXT file, or paste at least a few lines of resume text.' }, 400);
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
    filename: resumeFile?.name || null,
    hasJobDescription: jobDescription.trim().length > 40,
    jobDescriptionSource,
    warnings: [...warnings, ...jdWarnings]
  };

  // Storing the submission happens after the response is handed back, and a
  // storage failure must not cost the user their report.
  if (env.DB) {
    const row = buildSubmission({
      meta,
      rules: rulesOut,
      analysis,
      analysisError,
      deep,
      text,
      jobDescription,
      host: 'worker',
      userAgent: request.headers.get('user-agent')
    });
    const write = saveSubmission(env.DB, row).catch((err) => console.error('Failed to store submission:', err));
    ctx.waitUntil(write);
  }

  ctx.waitUntil(recordActivation(env.DB, { name: 'check_run', ip: clientIp(request) }));

  // resumeText goes back so the cover letter can be generated without a
  // re-upload and without reading stored data back out of the database.
  return json({ meta, rules: rulesOut, analysis, analysisError, resumeText: text });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/options' && request.method === 'GET') {
        return json({ jobs: listJobs(), seniority: listSeniority() });
      }

      if (url.pathname === '/api/sample' && request.method === 'GET') {
        return json({
          text: sampleResume,
          jobDescription: sampleJobDescription,
          jobId: 'software_engineer',
          seniority: 'senior'
        });
      }

      if (url.pathname === '/api/check' && request.method === 'POST') {
        return await handleCheck(request, env, ctx);
      }

      if (url.pathname === '/api/cover-letter' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const jobId = JOB_PROFILES[body?.jobId] ? body.jobId : 'general';
        const seniority = SENIORITY[body?.seniority] ? body.seniority : 'mid';
        const text = (body?.text || '').trim();
        const jobDescription = (body?.jobDescription || '').slice(0, 12000);
        const evidence = Array.isArray(body?.evidence) ? body.evidence.slice(0, 6) : [];

        if (text.length < 80) {
          return json({ error: 'Run a check first — the cover letter is written from your resume.' }, 400);
        }

        try {
          const letter = await generateCoverLetter({ text, jobId, seniority, jobDescription, evidence });
          ctx.waitUntil(recordActivation(env.DB, { name: 'cover_letter_run', ip: clientIp(request) }));
          return json({ letter });
        } catch (err) {
          return json({ error: err.message || 'Cover letter generation failed.' }, 502);
        }
      }

      if (isAdminPath(url.pathname)) {
        const { status, body } = await handleAdmin({
          db: env.DB,
          method: request.method,
          url,
          authorization: request.headers.get('authorization'),
          adminToken: env.ADMIN_TOKEN
        });
        return json(body, status);
      }
    } catch (err) {
      if (err instanceof ExtractError) return json({ error: err.message }, 400);
      console.error(err);
      return json({ error: err.message || 'Something went wrong while checking the resume.' }, 500);
    }

    return env.ASSETS.fetch(request);
  }
};
