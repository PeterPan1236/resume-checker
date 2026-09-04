# Structured resume model, ATS-safe templates, and export

**Status:** parked — approved in design, not implemented.
**Date:** 2026-09-04

Covers two of four requested features: *ATS-safe templates/editor* and
*export (PDF/DOCX)*. They are one project because both need a structured resume,
which does not exist yet — `lib/extract.js` returns a string and `lib/rules.js`
runs regex over it.

The other two features shipped separately: cover letter generation and admin
activity metrics (see README).

## Decisions taken

| Question | Decision |
|---|---|
| Content or formatting? | Apply the model's rewrites, with per-bullet accept / reject / edit review |
| How to parse? | Deterministic `lib/parse.js` — no model in the export path |
| Where does generation run? | Server-side, pure-JS libraries, shared by both hosts |
| Which templates? | All three: Plain Block, Ruled Classic, Compact Modern |
| Export what? | The formatted resume, the analysis report, and the cover letter |

## Architecture

An intermediate, format-neutral document model sits between templates and writers:

```
extract.js -> parse.js -> ResumeModel -> templates.js -> DocModel -> docx.js
  (exists)     (new)                       (new)          (new)   \-> pdf.js
```

`DocModel` is a flat block list — `heading`, `paragraph`, `bullets`, `rule`,
`spacer` — carrying no styling beyond semantic role. Three resume templates, a
report layout and a cover letter layout across two output formats is 5 layouts +
2 writers = 7 pieces, rather than 10 hand-written exporters. The report and cover
letter exports come nearly free as two more `DocModel` producers.

| Module | Responsibility | Pure? |
|---|---|---|
| `lib/parse.js` | text -> `ResumeModel` | yes |
| `lib/templates.js` | `ResumeModel` + template id -> `DocModel` | yes |
| `lib/docmodel.js` | block constructors and validation | yes |
| `lib/export/docx.js` | `DocModel` -> .docx bytes | no |
| `lib/export/pdf.js` | `DocModel` -> .pdf bytes | no |

All live in `lib/` so both hosts share them, following the existing pattern.

## ResumeModel

```
{ contact:   { name, email, phone, linkedin, github, site, location },
  summary:   string | null,
  entries:   [ { org, title, start, end, current, bullets[], raw } ],
  education: [ { institution, credential, year, raw } ],
  skills:    string[],
  unparsed:  string[],
  confidence:{ entries, dates, sections } }
```

`unparsed` records lines the parser could not place — the honest record of what an
ATS would also drop. `confidence` drives degradation below.

Contact extraction moves out of `lib/rules.js` into `lib/parse.js`, and `rules.js`
imports it back: same logic, one owner, no behaviour change.

## What already exists

- Contact extraction — complete in `rules.js` (email, phone, linkedin, github,
  site, location). Reusable as-is.
- Section detection — `SECTION_PATTERNS` / `SECTION_HEAD_RE`, but boolean only
  (`sections[name] = re.test(text)`); never sliced into content.
- Dates — counted (`dates.ranges`), never bound to a company or title.

Grouping lines into `(company, title, dates, bullets)` tuples is the actual new work.

## Rewrite reconciliation

`lib/analyze.js` already emits `bulletRewrites[{original, problem, rewrite,
needsFromUser}]` and the app currently discards them.

- Match `original` to a parsed bullet by normalised exact match, then trigram
  similarity above a threshold.
- No fuzzy fallback below the threshold. An unmatched rewrite is dropped, never
  guessed — corrupting a resume is worse than missing an improvement.
- A non-empty `needsFromUser` means the rewrite contains a blank the model wants
  filled. Those render as an input and **cannot be accepted until filled**,
  otherwise the export contains "increased revenue by [X]%".

## Review UI

A diff list, explicitly not WYSIWYG: original struck, rewrite below, three
controls (accept / reject / edit inline), a running count, a template picker, then
Export. Accepted rewrites produce a revised `ResumeModel`. This stays clear of the
versioning sub-project's editor territory.

## Export writers

**DOCX** — low risk. A ZIP of XML, the same structure `mammoth` already unzips on
the read path. A pure-JS zip writer (`fflate`) has no Node builtins and runs in
Workers.

**PDF** — the main risk, in two parts:

1. `pdf-lib` is pure JS and should run under `nodejs_compat`, but the README's
   note about `@google/generative-ai` hanging the runtime is this same class of
   problem. **First implementation step is a spike: render one page under
   `wrangler dev` before building anything on top.**
2. `pdf-lib` has no layout engine. Text wrapping and page breaks must be computed
   by hand — measure each line, track a Y cursor, break at block boundaries.
   Tractable only because ATS-safe layouts are single-column and table-free. Still
   the largest chunk of work here.

If the spike fails, the documented fallback is DOCX server-side plus PDF via the
print path already wired at `public/app.js`.

## Error handling

- No entry bound -> export blocked, surfaced as a report finding: "no roles could
  be identified — an ATS reading this file has the same problem."
- Low `confidence.entries` -> export allowed, banner naming what landed in `unparsed`.
- Rewrite unmatched -> dropped silently, counted in a "3 suggestions couldn't be
  applied" line.
- PDF generation throws -> fall back to DOCX with an explicit message. Never a
  silent empty file.

## Testing

Golden fixtures rather than a new framework, matching the existing
`rules-test.json` convention. `node --test` is built into Node 22, so no
dependency is added. `parse.js` and `templates.js` are pure and snapshot cleanly.

## Out of scope

WYSIWYG editing; template customisation (colours, fonts, margins); `.doc` output;
storing generated files server-side (they stream to the user, keeping this project
clear of the storage/privacy work); the cover letter *layout* (shipped separately —
the `DocModel` seam is left open for it).

## Open question carried forward

The three templates were chosen from a rendered comparison. Plain Block is the
baseline the other two are measured against, so build it first.
