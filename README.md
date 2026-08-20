# Resume Checker

Role-aware resume screening. Two layers run on every submission:

1. **Deterministic rule engine** (`lib/rules.js`) — no model involved, same input gives the same score every time. Covers ATS parseability, contact block, section headings, date coverage, bullet quantification, verb strength, duty-language and filler phrases, passive voice, length versus level, and keyword coverage against the role profile plus the pasted job description.
2. **Deep AI analysis** (`lib/analyze.js`) — Gemini `gemini-2.5-flash` reads the resume with the rule findings already in hand, and returns a hiring-manager verdict, role fit, section-by-section review, bullet rewrites, red flags, an ordered action plan, and the interview questions the resume invites. Output is constrained by a JSON response schema.

If the model call fails, the rule-based report is still returned in full and the UI says so.

## Run

```
cd resume-checker
npm install
npm start           # http://localhost:3100
```

`npm start` reads `../.env`, which must contain `GEMINI_API_KEY`. Override the port with `RESUME_PORT`.

## Deploy (Cloudflare Workers)

The same `lib/` code runs in two hosts. `server.js` is the local Express host; `src/worker.js` is the Workers host, which serves `public/` through the Assets binding and handles `/api/*` itself. PDF text extraction uses `unpdf` so it works in both.

```
npx wrangler secret put GEMINI_API_KEY   # once per worker
npm run deploy
npm run cf:dev                           # local Workers runtime on :8787
```

`wrangler.jsonc` holds the config. `nodejs_compat` is required — `lib/extract.js` uses `Buffer`, and `lib/analyze.js` reads `process.env.GEMINI_API_KEY`, which Workers populates from secrets and vars.

## Input

- **File upload**: PDF, DOCX, DOC, TXT/MD, up to 8 MB. Scanned PDFs are detected and flagged — an ATS sees them as blank too. Legacy `.doc` is read with a lossy fallback and marked as such.
- **Paste text**: for when you only have the text.
- **Job description** (optional): supply it as pasted text *or* as a file (same formats as the resume). Two things happen with it — the top 30 terms are matched against the resume for a keyword gap, and `lib/criteria.js` pulls the individual stated requirements out of the posting and checks each one.

## Requirement check

`lib/criteria.js` reads the posting the way a screener does. It splits the text into sections, drops the parts that are not criteria (benefits, responsibilities, about-us), folds wrapped bullets back together, and labels each requirement must-have or nice-to-have. Every requirement is then matched against the resume by stemmed term coverage, with a specific check for "N+ years" claims against the datable history in the resume, producing `met` / `partial` / `missing`.

With deep analysis on, the model receives that same numbered list and returns a per-requirement verdict with a quoted line of evidence, the gap, and the edit that would close it. The UI shows the model's verdict when present and the deterministic one otherwise, so the panel works with the AI pass switched off.

Requirement coverage carries half the weight of the role-fit dimension when a posting is supplied.

## Output

The results render as a consulting deliverable, not a dashboard: a cover block with the engagement facts, a contents list, then numbered sections — executive summary, assessment scorecard, requirement compliance, prioritized recommendations, role fit, vocabulary alignment, section review, bullet remediation, interview exposure, and a metrics appendix. Tables are numbered as exhibits. `public/report.js` builds it and `public/report.css` styles it, including a print stylesheet, so "Print / PDF" produces a clean letter-size document with the app chrome stripped.

## Job profiles

Nine role families plus a general fallback, in `lib/jobs.js`: software engineering, data science / ML, product, marketing / growth, sales, finance, design, operations / PM, healthcare. Each profile carries its own hard-skill vocabulary, soft-skill vocabulary, what the role is judged on, and the signals a screener looks for. Role choice changes both the keyword scoring and the model's rubric — a design resume without a portfolio link is a critical finding, an engineering resume without one is not.

Level (intern through lead) drives length targets, expected scope, and whether a Projects section is required.

## Scoring

Six weighted dimensions produce the overall score:

| Dimension | Weight | Driven by |
|---|---|---|
| Quantified impact | 28% | share of bullets with numbers, strong-verb starts |
| ATS parseability | 20% | contact fields found, standard section headings, file format |
| Role / keyword fit | 18% | stated-requirement coverage, profile keyword coverage, job-description term match |
| Structure & dates | 15% | required sections present, date ranges detected |
| Language quality | 14% | duty-language, filler, first person, passive voice |
| Length | 5% | estimated pages against the target for the level |

## API

`GET /api/options` — role and level lists for the form.

`POST /api/check` — `multipart/form-data`:

| Field | Notes |
|---|---|
| `resume` | file; or send `text` instead |
| `text` | raw resume text, minimum 80 characters |
| `jobId` | role profile id, defaults to `general` |
| `seniority` | `intern` \| `entry` \| `mid` \| `senior` \| `lead` |
| `jobDescription` | optional posting text |
| `deep` | `false` to skip the model call and return rules only |

Returns `{ meta, rules, analysis, analysisError }`.

## Layout

```
server.js          Express app, upload handling, /api routes
lib/extract.js     PDF / DOCX / DOC / TXT text extraction
lib/jobs.js        Role profiles and level definitions
lib/rules.js       Deterministic checks and scoring
lib/analyze.js     Gemini call, prompt, response schema, retry
public/            Single-page frontend, no build step
```
