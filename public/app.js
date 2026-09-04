const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let mode = 'file';
let jdMode = 'text';
let lastReport = null;

const DIM_LABELS = {
  atsParseability: 'ATS parseability',
  structure: 'Structure & dates',
  impact: 'Quantified impact',
  language: 'Language quality',
  jobFit: 'Role / keyword fit',
  length: 'Length vs. level'
};

const DIM_HINTS = {
  atsParseability: 'Can a parser read the contact block, headings and dates?',
  structure: 'Standard sections present, employment dates complete.',
  impact: 'Share of bullets carrying a number and a strong opening verb.',
  language: 'Duty language, filler phrases and passive voice.',
  jobFit: 'Role vocabulary plus terms from the pasted job description.',
  length: 'Page count against what this level is expected to run.'
};

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function colourFor(score) {
  if (score >= 75) return 'var(--good)';
  if (score >= 50) return 'var(--ok)';
  return 'var(--bad)';
}

function bandFor(score) {
  if (score >= 85) return 'Interview ready';
  if (score >= 70) return 'Minor fixes';
  if (score >= 50) return 'Needs work';
  return 'Major rewrite';
}

async function loadOptions() {
  const res = await fetch('/api/options');
  const { jobs, seniority } = await res.json();
  $('jobId').innerHTML = jobs.map((j) => `<option value="${j.id}">${esc(j.label)}</option>`).join('');
  const names = { intern: 'Intern / Student', entry: 'Entry (0-2 yrs)', mid: 'Mid (3-6 yrs)', senior: 'Senior (7-12 yrs)', lead: 'Lead / Manager+' };
  $('seniority').innerHTML = seniority
    .map((s) => `<option value="${s.id}" ${s.id === 'mid' ? 'selected' : ''}>${esc(names[s.id] || s.id)}</option>`)
    .join('');
}

// Roving tabindex: only the selected tab is in the tab order, and arrow keys
// move between them. Required by the tablist pattern the markup declares.
function syncTabs(selector, key, next) {
  document.querySelectorAll(selector).forEach((t) => {
    const on = t.dataset[key] === next;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
}

function setMode(next) {
  mode = next;
  // Scoped to [data-mode]: querying '.tab' also matched the job-posting tabs and
  // silently cleared their selected state.
  syncTabs('[data-mode]', 'mode', next);
  $('mode-file').classList.toggle('hidden', next !== 'file');
  $('mode-text').classList.toggle('hidden', next !== 'text');
}

function setJdMode(next) {
  jdMode = next;
  syncTabs('[data-jd-mode]', 'jdMode', next);
  $('jd-mode-text').classList.toggle('hidden', next !== 'text');
  $('jd-mode-file').classList.toggle('hidden', next !== 'file');
}

// Left/Right/Home/End move between tabs and activate the one landed on, which is
// the expected behaviour for a tablist with immediate activation.
function wireTabKeys(selector, apply, key) {
  const tabs = [...document.querySelectorAll(selector)];
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => apply(tab.dataset[key]));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      let target = null;
      if (e.key === 'ArrowRight') target = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') target = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') target = tabs[0];
      else if (e.key === 'End') target = tabs[tabs.length - 1];
      if (!target) return;
      e.preventDefault();
      apply(target.dataset[key]);
      target.focus();
    });
  });
}

wireTabKeys('[data-mode]', setMode, 'mode');
wireTabKeys('[data-jd-mode]', setJdMode, 'jdMode');

// Wires a drop zone to its file input and filename label.
function wireDrop(dropId, inputId, labelId) {
  const zone = $(dropId);
  $(inputId).addEventListener('change', (e) => {
    const f = e.target.files[0];
    $(labelId).textContent = f ? f.name : '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); })
  );
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    $(inputId).files = dt.files;
    $(labelId).textContent = f.name;
  });
}

wireDrop('drop', 'resume', 'filename');
wireDrop('jd-drop', 'jdFile', 'jd-filename');

$('load-sample').addEventListener('click', async () => {
  const btn = $('load-sample');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const res = await fetch('/api/sample');
    const { text, jobDescription, jobId, seniority } = await res.json();
    $('text').value = text;
    if (jobDescription) $('jobDescription').value = jobDescription;
    if (jobId) $('jobId').value = jobId;
    if (seniority) $('seniority').value = seniority;
    setMode('text');
    setJdMode('text');
    $('text').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    showError('Could not load the sample resume.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load the sample resume';
  }
});

$('check-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('error').classList.add('hidden');
  $('results').classList.add('hidden');

  const fd = new FormData();
  fd.append('jobId', $('jobId').value);
  fd.append('seniority', $('seniority').value);
  fd.append('deep', $('deep').checked ? 'true' : 'false');

  if (jdMode === 'file' && $('jdFile').files[0]) {
    fd.append('jobDescriptionFile', $('jdFile').files[0]);
  } else {
    fd.append('jobDescription', $('jobDescription').value);
  }

  if (mode === 'file') {
    const f = $('resume').files[0];
    if (!f) return showError('Choose a resume file first, or load the sample.');
    fd.append('resume', f);
  } else {
    if ($('text').value.trim().length < 80) return showError('Paste at least a few lines of resume text.');
    fd.append('text', $('text').value);
  }

  $('submit').disabled = true;
  $('loading').classList.remove('hidden');
  $('loading-text').textContent = 'Extracting text and running checks…';
  $('loading-sub').textContent = 'Rule engine first, then the hiring-manager review.';
  const timer = setTimeout(() => {
    $('loading-text').textContent = 'Running the deep analysis…';
    $('loading-sub').textContent = 'Reading section by section. This takes 15–30 seconds.';
  }, 2500);

  try {
    const res = await fetch('/api/check', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Check failed.');
    render(data);
  } catch (err) {
    showError(err.message);
  } finally {
    clearTimeout(timer);
    $('loading').classList.add('hidden');
    $('submit').disabled = false;
  }
});

function showError(msg) {
  $('error').textContent = msg;
  $('error').classList.remove('hidden');
  $('loading').classList.add('hidden');
  $('submit').disabled = false;
}

/* ---- requirement check: deterministic extraction, model verdict where available ---- */
const STATUS_LABEL = { met: 'Met', partial: 'Partial', missing: 'Not evidenced', unclear: 'Unclear' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function mergeCriteria(rules, analysis) {
  const base = rules.criteria?.items || [];
  if (!base.length) return null;

  const ai = analysis?.criteriaCheck || [];
  const byText = new Map(ai.map((c) => [norm(c.criterion), c]));

  const items = base.map((item, i) => {
    const m = byText.get(norm(item.text)) || (ai[i] && norm(ai[i].criterion).startsWith(norm(item.text).slice(0, 30)) ? ai[i] : null);
    return {
      text: item.text,
      kind: item.kind,
      status: m?.status || item.status,
      judged: Boolean(m),
      evidence: m?.evidence || null,
      gap: m?.gap || null,
      howToAddress: m?.howToAddress || null,
      note: item.note,
      coverage: item.coverage,
      missingTerms: item.missingTerms
    };
  });

  const must = items.filter((i) => i.kind === 'must');
  const nice = items.filter((i) => i.kind === 'nice');
  const count = (list, s) => list.filter((i) => i.status === s).length;

  return {
    items,
    must,
    nice,
    judged: ai.length > 0,
    summary: {
      mustTotal: must.length,
      mustMet: count(must, 'met'),
      mustPartial: count(must, 'partial'),
      mustMissing: count(must, 'missing') + count(must, 'unclear'),
      niceTotal: nice.length,
      niceMet: count(nice, 'met'),
      coverage: items.length
        ? Math.round(((count(items, 'met') + count(items, 'partial') * 0.5) / items.length) * 100)
        : 0
    }
  };
}

/* ---- one prioritized list, rule findings and model advice merged ---- */
function buildRecommendations(rules, analysis, criteria) {
  const recs = [];

  (criteria?.must || []).forEach((c) => {
    if (c.status === 'met') return;
    const severity = c.status === 'partial' ? 'high' : 'critical';
    recs.push({
      severity,
      source: 'Stated requirement',
      title: `${STATUS_LABEL[c.status]}: ${c.text}`,
      why: c.gap || c.note || 'The posting lists this as a must-have and the resume does not prove it.',
      fix: c.howToAddress || 'Add a bullet that shows this in applied work, using the posting’s own wording.',
      order: (severity === 'critical' ? SEV_RANK.critical : SEV_RANK.high) - 0.1
    });
  });

  (rules.findings || []).forEach((f) => {
    // The per-requirement cards above already say this, item by item.
    if (criteria && f.area === 'Stated requirements') return;
    recs.push({
      severity: f.severity,
      source: `ATS rule · ${f.area}`,
      title: f.message,
      fix: f.fix,
      why: null,
      order: SEV_RANK[f.severity] ?? 3
    });
  });

  (analysis?.actionPlan || []).forEach((a) => {
    const severity = a.priority <= 2 ? 'high' : a.priority <= 4 ? 'medium' : 'low';
    recs.push({
      severity,
      source: 'Hiring-manager review',
      effort: a.effort,
      title: a.action,
      fix: null,
      why: a.why,
      order: (SEV_RANK[severity] ?? 3) + 0.5
    });
  });

  (analysis?.redFlags || []).forEach((r) => {
    recs.push({
      severity: 'high',
      source: 'Red flag',
      title: r.flag,
      fix: r.howToAddress,
      why: r.whyItMatters,
      order: SEV_RANK.high + 0.2
    });
  });

  // Rank first so that when the same problem arrives from two feeds, the survivor
  // is the higher-priority one — a deterministic rule finding beats the model
  // restating it in its own words.
  const ranked = recs.sort(
    (a, b) => a.order - b.order || SEV_RANK[a.severity] - SEV_RANK[b.severity]
  );

  const kept = [];
  const keptTerms = [];
  for (const r of ranked) {
    const terms = new Set(
      norm(`${r.title} ${r.fix || ''}`)
        .split(' ')
        .filter((w) => w.length > 3)
    );
    if (!terms.size) {
      kept.push(r);
      continue;
    }
    const echo = keptTerms.some((prev) => {
      const overlap = [...terms].filter((t) => prev.has(t)).length;
      return overlap / Math.min(terms.size, prev.size) >= 0.6;
    });
    if (echo) continue;
    keptTerms.push(terms);
    kept.push(r);
  }

  return kept;
}

function plainTextReport(data) {
  const { meta, rules, analysis } = data;
  const criteria = mergeCriteria(rules, analysis);
  const lines = [];
  lines.push('RESUME SCREENING ASSESSMENT');
  lines.push(`${meta.jobLabel} · ${meta.seniority} level · ${new Date().toLocaleDateString()}`);
  lines.push(`Overall: ${rules.overall}/100 — ${bandFor(rules.overall)}`);
  if (criteria) {
    const s = criteria.summary;
    lines.push(`Stated requirements: ${s.mustMet}/${s.mustTotal} must-haves evidenced, ${s.niceMet}/${s.niceTotal} nice-to-haves.`);
  }
  if (analysis?.verdict) {
    lines.push(`Verdict: ${analysis.verdict.screenOutcome.replace(/_/g, ' ')} — ${analysis.verdict.headline}`);
  }
  lines.push('');
  lines.push('ASSESSMENT SCORECARD');
  Object.entries(rules.dimensions).forEach(([k, s]) => lines.push(`  ${DIM_LABELS[k] || k}: ${s}`));
  if (criteria) {
    lines.push('');
    lines.push('REQUIREMENT COMPLIANCE');
    criteria.items.forEach((c) => {
      lines.push(`  [${(STATUS_LABEL[c.status] || c.status).toUpperCase()}] (${c.kind}) ${c.text}`);
    });
  }
  lines.push('');
  lines.push('PRIORITIZED RECOMMENDATIONS');
  buildRecommendations(rules, analysis, criteria).forEach((r, i) => {
    lines.push(`  ${i + 1}. [${r.severity.toUpperCase()}] ${r.title}`);
    if (r.why) lines.push(`     Why: ${r.why}`);
    if (r.fix) lines.push(`     Do this: ${r.fix}`);
  });
  return lines.join('\n');
}

function render(data) {
  lastReport = data;

  $('results').innerHTML = `<div class="report-tools">
      <button type="button" class="ghost" id="copy-report">Copy summary</button>
      <button type="button" class="ghost" id="print-report">Print / PDF</button>
      <button type="button" class="primary" id="cover-letter">Write a cover letter</button>
    </div>
    <div id="cover-letter-panel" class="hidden"></div>` + renderReport(data);
  $('results').classList.remove('hidden');

  $('print-report').addEventListener('click', () => window.print());
  $('copy-report').addEventListener('click', async () => {
    const btn = $('copy-report');
    try {
      await navigator.clipboard.writeText(plainTextReport(lastReport));
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy summary'; }, 1800);
    } catch {
      btn.textContent = 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy summary'; }, 1800);
    }
  });

  $('cover-letter').addEventListener('click', requestCoverLetter);

  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- cover letter -----------------------------------------------------------

function coverLetterText(l) {
  return [l.greeting, '', l.opening, '', ...(l.body || []).flatMap((p) => [p, '']), l.closing, '', l.signoff, l.name]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderCoverLetter(l) {
  const panel = $('cover-letter-panel');
  const paras = [l.opening, ...(l.body || []), l.closing].filter(Boolean);

  panel.innerHTML = `
    <div class="letter-head">
      <h3>Cover letter</h3>
      <span class="letter-count${l.overLimit ? ' over' : ''}">${l.words} words</span>
      ${l.usedJobDescription ? '' : '<span class="letter-warn">No job description — written to the role profile only</span>'}
    </div>
    <div class="letter-body">
      <p class="letter-greeting">${esc(l.greeting)}</p>
      ${paras.map((p) => `<p>${esc(p)}</p>`).join('')}
      <p class="letter-signoff">${esc(l.signoff)}<br>${esc(l.name || '')}</p>
    </div>
    ${
      (l.assumptions || []).length
        ? `<div class="letter-check">
             <strong>Check before sending</strong>
             <ul>${l.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
           </div>`
        : ''
    }
    <div class="letter-tools">
      <button type="button" class="ghost" id="copy-letter">Copy letter</button>
      <button type="button" class="ghost" id="regen-letter">Write another</button>
    </div>`;

  panel.classList.remove('hidden');

  $('copy-letter').addEventListener('click', async () => {
    const btn = $('copy-letter');
    try {
      await navigator.clipboard.writeText(coverLetterText(l));
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => { btn.textContent = 'Copy letter'; }, 1800);
  });
  $('regen-letter').addEventListener('click', requestCoverLetter);
}

async function requestCoverLetter() {
  if (!lastReport) return;
  const btn = $('cover-letter');
  const panel = $('cover-letter-panel');

  btn.disabled = true;
  btn.textContent = 'Writing…';
  panel.classList.remove('hidden');
  panel.innerHTML = '<p class="letter-loading">Drafting a short letter from your resume…</p>';

  // Lean on the strongest evidence the screen already found, so the letter
  // argues the same things the report told the user were working.
  const a = lastReport.analysis;
  const evidence = [a?.verdict?.strongestAsset, ...(a?.roleFit?.evidenceFor || [])].filter(Boolean).slice(0, 6);

  try {
    const res = await fetch('/api/cover-letter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: lastReport.resumeText || '',
        jobId: $('jobId').value,
        seniority: $('seniority').value,
        jobDescription: jdMode === 'file' ? '' : $('jobDescription').value,
        evidence
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cover letter generation failed.');
    renderCoverLetter(data.letter);
  } catch (err) {
    panel.innerHTML = `<p class="letter-error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Write a cover letter';
  }
}

loadOptions();
