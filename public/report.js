/* Report rendering: the results are presented as a consulting deliverable —
   numbered sections, numbered exhibits, tables rather than loose cards. */

const RATING = (score) =>
  score >= 85 ? 'Strong' : score >= 70 ? 'Adequate' : score >= 50 ? 'Developing' : 'Deficient';

const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Moderate', low: 'Low' };

const DIM_WEIGHTS = {
  impact: '28%',
  atsParseability: '20%',
  jobFit: '18%',
  structure: '15%',
  language: '14%',
  length: '5%'
};

const OUTCOME_LABEL = {
  likely_advance: 'Likely to advance',
  borderline: 'Borderline',
  likely_rejected: 'Likely to be screened out'
};

let exhibitNo = 0;
let sectionNo = 0;
const contents = [];

function resetCounters() {
  exhibitNo = 0;
  sectionNo = 0;
  contents.length = 0;
}

function section(title, inner, note) {
  sectionNo += 1;
  const id = `sec-${sectionNo}`;
  const num = String(sectionNo).padStart(2, '0');
  contents.push({ num, title, id });
  return `<section class="rsection" id="${id}">
    <div class="rsection-head">
      <span class="rsection-num">${num}</span>
      <h2>${esc(title)}</h2>
    </div>
    ${note ? `<p class="rsection-note">${esc(note)}</p>` : ''}
    ${inner}
  </section>`;
}

function exhibit(title, inner, footnote) {
  exhibitNo += 1;
  return `<figure class="exhibit">
    <figcaption><span class="exhibit-num">Exhibit ${exhibitNo}</span>${esc(title)}</figcaption>
    ${inner}
    ${footnote ? `<p class="exhibit-note">${esc(footnote)}</p>` : ''}
  </figure>`;
}

function table(headers, rows, className = '') {
  return `<div class="table-wrap"><table class="dtable ${className}">
    <thead><tr>${headers.map((h) => `<th${h.width ? ` style="width:${h.width}"` : ''}${h.align ? ` class="ta-${h.align}"` : ''}>${esc(h.label ?? h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function statusTag(status) {
  return `<span class="tag-status ${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function sevTag(sev) {
  return `<span class="tag-sev ${esc(sev)}">${esc(SEV_LABEL[sev] || sev)}</span>`;
}

function scoreBar(score) {
  return `<span class="sbar"><i style="width:${score}%;background:${colourFor(score)}"></i></span>`;
}

// The model is asked for 0-100 but has historically answered on a 0-10 scale,
// which rendered as "6.5/100". Treat anything at or below 10 as that older scale.
function fitScore(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n > 0 && n <= 10 ? n * 10 : n)));
}

function dial(score) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  return `<div class="dial">
    <svg width="112" height="112" aria-hidden="true">
      <circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--rule)" stroke-width="7"/>
      <circle cx="56" cy="56" r="${r}" fill="none" stroke="${colourFor(score)}" stroke-width="7"
        stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
    </svg>
    <div class="dial-num">${score}<small>/ 100</small></div>
  </div>`;
}

function today() {
  return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function coverBlock(meta, rules, v) {
  const benchmark = meta.hasJobDescription
    ? meta.jobDescriptionSource && meta.jobDescriptionSource !== 'text'
      ? meta.jobDescriptionSource
      : 'Supplied job description'
    : 'Role profile benchmark (no posting supplied)';

  const facts = [
    ['Subject document', meta.filename || 'Pasted resume text'],
    ['Target role', meta.jobLabel],
    ['Seniority assessed', `${meta.seniority.charAt(0).toUpperCase()}${meta.seniority.slice(1)}`],
    ['Benchmark', benchmark],
    ['Date of assessment', today()],
    ['Basis', v ? 'Deterministic rule engine and hiring-manager review' : 'Deterministic rule engine']
  ];

  return `<header class="cover">
    <div class="cover-top">
      <span class="cover-firm">Resume Checker</span>
      <span class="cover-conf">Confidential — prepared for the candidate</span>
    </div>
    <h1 class="cover-title">Resume Screening Assessment</h1>
    <p class="cover-sub">An evaluation of screening readiness for a ${esc(meta.jobLabel)} application at ${esc(meta.seniority)} level, against applicant-tracking parsing, evidence of impact, and the requirements stated in the posting.</p>
    <dl class="cover-facts">
      ${facts.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}
    </dl>
  </header>`;
}

function contentsBlock() {
  return `<nav class="contents">
    <h3>Contents</h3>
    <ol>${contents.map((c) => `<li><a href="#${c.id}"><span>${c.num}</span>${esc(c.title)}</a></li>`).join('')}</ol>
  </nav>`;
}

function renderReport(data) {
  const { meta, rules, analysis, analysisError } = data;
  const v = analysis?.verdict;
  const criteria = mergeCriteria(rules, analysis);
  const recs = buildRecommendations(rules, analysis, criteria);
  const body = [];

  resetCounters();

  /* --- 01 Executive summary --- */
  const summaryRows = [
    ['Overall screening score', `<b>${rules.overall} / 100</b>`, RATING(rules.overall)],
    [
      'Screen outcome',
      v ? esc(OUTCOME_LABEL[v.screenOutcome] || v.screenOutcome) : '—',
      v ? 'Hiring-manager judgement' : 'Requires deep analysis'
    ],
    [
      'Stated must-have coverage',
      criteria ? `<b>${criteria.summary.mustMet} of ${criteria.summary.mustTotal}</b> evidenced` : 'No posting supplied',
      criteria ? `${criteria.summary.coverage}% weighted coverage` : '—'
    ],
    [
      'Issues raised',
      `<b>${recs.length}</b> total`,
      `${recs.filter((r) => r.severity === 'critical').length} critical · ${recs.filter((r) => r.severity === 'high').length} high`
    ]
  ];

  const judgements = v
    ? [
        ['Recruiter’s first pass', v.recruiterFirstImpression],
        ['Strongest asset', v.strongestAsset],
        ['Principal risk', v.biggestRisk]
      ]
    : [];

  const topThree = recs.slice(0, 3);

  body.push(section(
    'Executive summary',
    `<div class="lede">
      ${dial(rules.overall)}
      <div>
        <p class="verdict-statement">${esc(v?.headline || `${bandFor(rules.overall)}: the document scores ${rules.overall} of 100 against a ${meta.jobLabel} screen at ${meta.seniority} level.`)}</p>
        ${criteria ? `<p class="lede-note">Of the ${criteria.summary.mustTotal} must-have requirements stated in the posting, ${criteria.summary.mustMet} are evidenced, ${criteria.summary.mustPartial} are partly evidenced and ${criteria.summary.mustMissing} are not supported by anything in the resume.</p>` : ''}
      </div>
    </div>
    ${(meta.warnings || []).map((w) => `<div class="callout">${esc(w)}</div>`).join('')}
    ${analysisError ? `<div class="callout">Hiring-manager review unavailable (${esc(analysisError)}). All deterministic findings in this report are complete.</div>` : ''}
    ${exhibit('Assessment at a glance', table(
      [{ label: 'Measure', width: '30%' }, { label: 'Result', width: '32%' }, { label: 'Read', width: '38%' }],
      summaryRows.map(([a, b, c]) => [esc(a), b, esc(c)])
    ))}
    ${judgements.length ? `<h4 class="subhead">Key judgements</h4>
      <dl class="keypoints">${judgements.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('')}</dl>` : ''}
    ${topThree.length ? exhibit('Priority actions', table(
      [{ label: '#', width: '4%' }, { label: 'Action', width: '46%' }, { label: 'Severity', width: '12%' }, { label: 'Rationale', width: '38%' }],
      topThree.map((r, i) => [
        String(i + 1),
        `<b>${esc(r.title)}</b>${r.fix ? `<span class="cell-sub">${esc(r.fix)}</span>` : ''}`,
        sevTag(r.severity),
        esc(r.why || r.source)
      ])
    ), 'Ordered by effect on the screening outcome, not by effort.') : ''}`
  ));

  /* --- 02 Scorecard --- */
  body.push(section(
    'Assessment scorecard',
    exhibit('Dimension scores and weights', table(
      [{ label: 'Dimension', width: '22%' }, { label: 'Score', width: '22%' }, { label: 'Rating', width: '13%' }, { label: 'Weight', width: '9%' }, { label: 'What it measures', width: '34%' }],
      Object.entries(rules.dimensions).map(([k, s]) => [
        `<b>${esc(DIM_LABELS[k] || k)}</b>`,
        `${scoreBar(s)}<span class="sbar-val">${s}</span>`,
        `<span class="rating ${RATING(s).toLowerCase()}">${RATING(s)}</span>`,
        DIM_WEIGHTS[k] || '—',
        esc(DIM_HINTS[k] || '')
      ])
    ), 'Weighted composite produces the overall screening score.'),
    'Six weighted dimensions, each computed deterministically from the document text.'
  ));

  /* --- 03 Requirement compliance --- */
  if (criteria) {
    const s = criteria.summary;
    const complianceRows = (list, prefix) =>
      list.map((c, i) => [
        `<span class="ref">${prefix}${i + 1}</span>`,
        `<b>${esc(c.text)}</b>${
          c.evidence && c.status !== 'missing' ? `<span class="cell-sub"><em>Evidence:</em> ${esc(c.evidence)}</span>` : ''
        }${c.gap ? `<span class="cell-sub"><em>Gap:</em> ${esc(c.gap)}</span>` : ''}${
          // The reviewer's read supersedes the arithmetic estimate; showing both invites a contradiction.
          c.note && !c.judged ? `<span class="cell-sub"><em>Note:</em> ${esc(c.note)}</span>` : ''
        }${
          !c.judged && c.missingTerms?.length ? `<span class="cell-sub"><em>Terms not found:</em> ${esc(c.missingTerms.join(', '))}</span>` : ''
        }`,
        statusTag(c.status),
        esc(c.howToAddress || (c.status === 'met' ? 'No action required.' : 'Add applied evidence using the posting’s wording.'))
      ]);

    const headers = [
      { label: 'Ref', width: '6%' },
      { label: 'Requirement as stated', width: '46%' },
      { label: 'Status', width: '13%' },
      { label: 'Recommended action', width: '35%' }
    ];

    body.push(section(
      'Requirement compliance',
      `${exhibit('Coverage of stated requirements', table(
        [{ label: 'Requirement class', width: '30%' }, { label: 'Met', width: '13%' }, { label: 'Partial', width: '13%' }, { label: 'Not evidenced', width: '18%' }, { label: 'Coverage', width: '26%' }],
        [
          ['Must-have', String(s.mustMet), String(s.mustPartial), String(s.mustMissing), `${scoreBar(s.mustTotal ? Math.round((s.mustMet / s.mustTotal) * 100) : 0)}<span class="sbar-val">${s.mustTotal ? Math.round((s.mustMet / s.mustTotal) * 100) : 0}%</span>`],
          ['Nice to have', String(s.niceMet), String(criteria.nice.filter((c) => c.status === 'partial').length), String(criteria.nice.filter((c) => c.status === 'missing' || c.status === 'unclear').length), `${scoreBar(s.niceTotal ? Math.round((s.niceMet / s.niceTotal) * 100) : 0)}<span class="sbar-val">${s.niceTotal ? Math.round((s.niceMet / s.niceTotal) * 100) : 0}%</span>`]
        ]
      ))}
      ${criteria.must.length ? `<h4 class="subhead">Must-have requirements</h4>${exhibit('Must-have requirements, assessed individually', table(headers, complianceRows(criteria.must, 'M')))}` : ''}
      ${criteria.nice.length ? `<h4 class="subhead">Preferred requirements</h4>${exhibit('Preferred requirements, assessed individually', table(headers, complianceRows(criteria.nice, 'P')))}` : ''}`,
      criteria.judged
        ? 'Requirements parsed from the posting, each judged against evidence in the resume.'
        : 'Requirements parsed from the posting and matched by term coverage. Enable the hiring-manager review for evidence-level judgements.'
    ));
  }

  /* --- 04 Recommendations --- */
  if (recs.length) {
    body.push(section(
      'Prioritized recommendations',
      exhibit('Full remediation list', table(
        [{ label: '#', width: '4%' }, { label: 'Finding and action', width: '52%' }, { label: 'Severity', width: '11%' }, { label: 'Basis', width: '33%' }],
        recs.map((r, i) => [
          String(i + 1),
          `<b>${esc(r.title)}</b>${r.why ? `<span class="cell-sub"><em>Why it matters:</em> ${esc(r.why)}</span>` : ''}${r.fix ? `<span class="cell-sub"><em>Action:</em> ${esc(r.fix)}</span>` : ''}`,
          sevTag(r.severity),
          `${esc(r.source)}${r.effort ? `<span class="cell-sub">Effort: ${esc(r.effort)}</span>` : ''}`
        ])
      ), 'Critical items block the screen; high items cost interviews.'),
      'Deterministic findings, stated-requirement gaps and reviewer judgements, merged and ranked by effect on the outcome.'
    ));
  }

  /* --- 05 Role fit --- */
  if (analysis) {
    const rf = analysis.roleFit;
    body.push(section(
      'Role fit assessment',
      `<p class="stat-line"><span class="stat-big">${fitScore(rf.score)}<small>/100</small></span> ${esc(rf.rationale)}</p>
      <p class="para"><b>Level read:</b> ${esc(rf.seniorityRead)}</p>
      ${exhibit('Evidence for and against the target level', `<div class="two-col">
        <div><h5>Supports the level</h5><ul class="plain">${rf.evidenceFor.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><h5>Argues against</h5><ul class="plain">${rf.evidenceAgainst.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>`)}`
    ));
  }

  /* --- 06 Keyword alignment --- */
  const kw = rules.keywords;
  const chipRow = (list, cls, empty) =>
    `<div class="chips">${list.map((k) => `<span class="chip ${cls}">${esc(k)}</span>`).join('') || `<span class="chip miss">${esc(empty)}</span>`}</div>`;
  body.push(section(
    'Vocabulary alignment',
    `${exhibit(`Role vocabulary — ${kw.profileLabel}`, `
      <p class="label">Present in the resume (${kw.matched.length})</p>${chipRow(kw.matched, 'hit', 'none')}
      <p class="label">Expected for this role, absent</p>${chipRow(kw.missing, 'miss', 'nothing missing')}`)}
    ${kw.jd ? exhibit('Posting vocabulary', `
      <p class="label">Matched (${kw.jd.matched.length})</p>${chipRow(kw.jd.matched, 'hit', 'none')}
      <p class="label">Absent (${kw.jd.missing.length})</p>${chipRow(kw.jd.missing, 'miss', 'nothing missing')}`) : ''}`,
    'Terms should only be added where the underlying experience is genuine; keyword padding is visible to a reader.'
  ));

  /* --- 07 Section review --- */
  if (analysis?.sectionAnalysis?.length) {
    body.push(section(
      'Section-level review',
      exhibit('Assessment by resume section', table(
        [{ label: 'Section', width: '18%' }, { label: 'Assessment', width: '46%' }, { label: 'Issues identified', width: '36%' }],
        analysis.sectionAnalysis.map((s) => [
          `<b>${esc(s.section)}</b>`,
          esc(s.assessment),
          s.issues.length ? `<ul class="cell-list">${s.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<span class="muted-cell">None raised</span>'
        ])
      ))
    ));
  }

  /* --- 08 Bullet remediation --- */
  if (analysis?.bulletRewrites?.length) {
    body.push(section(
      'Bullet remediation',
      analysis.bulletRewrites.map((b, i) => `<div class="rewrite">
        <div class="rw-index">${String(i + 1).padStart(2, '0')}</div>
        <div class="rw-body">
          <div class="rw-label">As written</div>
          <p class="before">${esc(b.original)}</p>
          <div class="rw-label">Proposed</div>
          <p class="after">${esc(b.rewrite)}</p>
          <p class="why"><b>Problem:</b> ${esc(b.problem)}</p>
          ${b.needsFromUser ? `<p class="need"><b>Candidate must supply:</b> ${esc(b.needsFromUser)}</p>` : ''}
        </div>
      </div>`).join(''),
      'Rewrites are truthful to the original claim. Bracketed placeholders mark facts only the candidate can supply.'
    ));
  }

  /* --- 09 Gaps --- */
  if (analysis?.missingContent?.length) {
    body.push(section(
      'Content gaps for this role',
      `<ul class="plain">${analysis.missingContent.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    ));
  }

  /* --- 10 Interview exposure --- */
  if (analysis?.interviewRisks?.length) {
    body.push(section(
      'Interview exposure',
      `<ul class="plain">${analysis.interviewRisks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`,
      'Questions this document invites. Each should have a prepared answer before a screen call.'
    ));
  }

  /* --- Appendix: metrics --- */
  const m = rules.metrics;
  body.push(section(
    'Appendix — document metrics',
    exhibit('Raw counts underlying the scores', table(
      [{ label: 'Metric', width: '40%' }, { label: 'Value', width: '20%' }, { label: 'Benchmark', width: '40%' }],
      [
        ['Word count', String(m.wordCount), '450–800 for most single-page resumes'],
        ['Estimated pages', String(m.estPages), 'One page to mid level, two at senior and above'],
        ['Bullet points', String(m.bulletCount), '3–5 per recent role'],
        ['Bullets containing a number', `${m.quantifiedPct}%`, '60% or higher'],
        ['Bullets opening on a strong verb', `${m.strongVerbPct}%`, '70% or higher'],
        ['Date ranges detected', String(m.dateRanges), 'One per role, month and year'],
        ['First-person pronouns', String(m.firstPerson), 'Zero'],
        ['Passive constructions', String(m.passive), 'Minimal']
      ].map((r) => [`<b>${esc(r[0])}</b>`, esc(r[1]), esc(r[2])])
    ))
  ));

  const footer = `<footer class="report-footer">
    <p><b>Method.</b> Every submission is scored twice. A deterministic rule engine measures parseability, structure, quantification, language and length, and extracts the stated requirements from the posting; scores from it are reproducible. Where the hiring-manager review is enabled, a language model reads the document with those findings in hand and supplies the judgements, evidence quotes and rewrites.</p>
    <p><b>Limitations.</b> Formatting is not observable once text is extracted, so visual design is out of scope. Model judgements are a screener's opinion and are not a hiring decision. Nothing in this report is retained after the session.</p>
    <p class="colophon">Resume Checker · Screening assessment · ${esc(today())}</p>
  </footer>`;

  return `<article class="report">
    ${coverBlock(meta, rules, v)}
    ${contentsBlock()}
    ${body.join('')}
    ${footer}
  </article>`;
}
