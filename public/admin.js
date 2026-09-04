(() => {
  const TOKEN_KEY = 'rc_admin_token';
  const PAGE_SIZE = 50;

  const $ = (id) => document.getElementById(id);
  const state = { token: '', offset: 0, total: 0, jobs: [], seniority: [] };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}), authorization: `Bearer ${state.token}` }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
    return body;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const round = (n, digits = 0) => (n == null || Number.isNaN(Number(n)) ? null : Number(Number(n).toFixed(digits)));
  const fmt = (n, digits = 0) => (round(n, digits) == null ? '—' : String(round(n, digits)));

  function scoreClass(score) {
    if (score == null) return '';
    if (score >= 75) return 'good';
    if (score >= 55) return 'ok';
    return 'bad';
  }

  function scorePill(score) {
    if (score == null) return '<span class="score-pill">—</span>';
    return `<span class="score-pill ${scoreClass(score)}">${Math.round(score)}</span>`;
  }

  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  // ---------- sign-in ----------

  function showGate(message) {
    $('gate').classList.remove('hidden');
    $('console').classList.add('hidden');
    $('signOut').classList.add('hidden');
    if (message) {
      $('gateError').textContent = message;
      $('gateError').classList.remove('hidden');
    }
  }

  function showConsole() {
    $('gate').classList.add('hidden');
    $('gateError').classList.add('hidden');
    $('console').classList.remove('hidden');
    $('signOut').classList.remove('hidden');
  }

  async function signIn(token) {
    state.token = token;
    await api('/api/admin/ping');
    sessionStorage.setItem(TOKEN_KEY, token);
    showConsole();
    await Promise.all([loadOptions(), loadStats(), loadSubmissions(), loadActivity()]);
  }

  $('gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('tokenInput').value.trim();
    if (!token) return;
    try {
      await signIn(token);
    } catch (err) {
      state.token = '';
      showGate(err.message);
    }
  });

  $('signOut').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = '';
    location.reload();
  });

  function fail(err) {
    if (err.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      showGate('Session rejected. Enter the admin token again.');
      return;
    }
    $('consoleError').textContent = err.message;
    $('consoleError').classList.remove('hidden');
  }

  // ---------- filters ----------

  async function loadOptions() {
    const { jobs, seniority } = await fetch('/api/options').then((r) => r.json());
    state.jobs = jobs;
    state.seniority = seniority;
    for (const job of jobs) {
      $('fRole').insertAdjacentHTML('beforeend', `<option value="${esc(job.id)}">${esc(job.label)}</option>`);
    }
    for (const level of seniority) {
      $('fSeniority').insertAdjacentHTML('beforeend', `<option value="${esc(level.id)}">${esc(level.label || level.id)}</option>`);
    }
  }

  function filterParams() {
    const params = new URLSearchParams();
    const map = { jobId: $('fRole').value, seniority: $('fSeniority').value, source: $('fSource').value, minScore: $('fMin').value, maxScore: $('fMax').value, q: $('fQuery').value.trim() };
    for (const [key, value] of Object.entries(map)) if (value) params.set(key, value);
    params.set('limit', PAGE_SIZE);
    params.set('offset', state.offset);
    return params;
  }

  // ---------- overview ----------

  function barRows(rows, { max, suffix = '' } = {}) {
    const ceiling = max ?? Math.max(1, ...rows.map((r) => r.value || 0));
    return rows
      .map((row) => {
        const value = row.value || 0;
        const width = ceiling === 0 ? 0 : (value / ceiling) * 100;
        return `
          <div class="bar-row" title="${esc(row.label)}: ${esc(row.display ?? value)}${esc(suffix)}">
            <div class="bar-label">${esc(row.label)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(1)}%"></div></div>
            <div class="bar-value">${esc(row.display ?? value)}${esc(suffix)}</div>
          </div>`;
      })
      .join('');
  }

  function renderTiles(t) {
    const tiles = [
      { label: 'Submissions', value: fmt(t.submissions), note: 'in window' },
      { label: 'Average score', value: fmt(t.avg_overall, 1), note: 'overall, 0–100' },
      { label: 'With job description', value: fmt(t.with_jd), note: `${t.submissions ? Math.round((t.with_jd / t.submissions) * 100) : 0}% of submissions` },
      { label: 'Deep analysis runs', value: fmt(t.deep_runs), note: `${fmt(t.deep_failures)} failed` },
      { label: 'Average length', value: fmt(t.avg_word_count), note: 'words' },
      { label: 'Quantified bullets', value: `${fmt(t.avg_quantified_pct)}%`, note: 'average share' }
    ];
    $('tiles').innerHTML = tiles
      .map((tile) => `
        <div class="tile">
          <div class="tile-label">${esc(tile.label)}</div>
          <div class="tile-value">${esc(tile.value)}</div>
          <div class="tile-note">${esc(tile.note)}</div>
        </div>`)
      .join('');
  }

  function renderBreakdown(el, rows, labelKey) {
    if (!rows.length) {
      el.innerHTML = '<p class="empty">No data yet.</p>';
      return;
    }
    el.innerHTML = `
      <table class="grid">
        <thead><tr><th>${labelKey === 'job_label' ? 'Role' : 'Level'}</th><th class="num">Submissions</th><th class="num">Avg score</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r[labelKey] ?? r.seniority)}</td>
              <td class="num">${esc(r.n)}</td>
              <td class="num">${scorePill(round(r.avg_overall, 0))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // --- activity: counters + unique visitors --------------------------------

  function renderActivity({ counters, visitors, unique }) {
    const tiles = counters.map((c) => ({
      label: c.label,
      value: fmt(c.count),
      note: c.resetAt ? `since reset ${when(c.resetAt)}` : c.updatedAt ? `last ${when(c.updatedAt)}` : 'never run'
    }));
    tiles.push({
      label: 'Unique visitors',
      value: fmt(unique),
      note: 'distinct addresses'
    });

    $('activityTiles').innerHTML = tiles
      .map((tile) => `
        <div class="tile">
          <div class="tile-label">${esc(tile.label)}</div>
          <div class="tile-value">${esc(tile.value)}</div>
          <div class="tile-note">${esc(tile.note)}</div>
        </div>`)
      .join('');

    if (!visitors.length) {
      $('visitorTable').innerHTML = '<p class="panel-note">No visitors recorded yet.</p>';
      return;
    }

    $('visitorTable').innerHTML = `
      <table class="grid">
        <thead><tr><th>Address</th><th class="num">Runs</th><th>First seen</th><th>Last seen</th></tr></thead>
        <tbody>
          ${visitors
            .map(
              (v) => `<tr>
                <td>${esc(v.ip)}</td>
                <td class="num">${esc(v.hits)}</td>
                <td>${esc(when(v.firstSeen))}</td>
                <td>${esc(when(v.lastSeen))}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  }

  async function loadActivity() {
    try {
      const [c, v] = await Promise.all([api('/api/admin/counters'), api('/api/admin/visitors?limit=200')]);
      renderActivity({ counters: c.counters, visitors: v.visitors, unique: v.unique });
    } catch (err) {
      $('activityTiles').innerHTML = `<p class="panel-note">${esc(err.message)}</p>`;
    }
  }

  // Two-step confirm rather than window.confirm: no modal, and the button says
  // what the second click will do.
  function arm(btn, label, action) {
    let armed = false;
    let timer = null;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Click again to confirm';
        btn.classList.add('danger');
        timer = setTimeout(() => {
          armed = false;
          btn.textContent = label;
          btn.classList.remove('danger');
        }, 4000);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.classList.remove('danger');
      btn.disabled = true;
      btn.textContent = 'Working…';
      try {
        await action();
        await loadActivity();
        $('activityNote').textContent = `${label} — done ${when(new Date().toISOString())}`;
      } catch (err) {
        $('activityNote').textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

  async function loadStats() {
    try {
      const days = $('statsRange').value;
      const stats = await api(`/api/admin/stats${days ? `?days=${days}` : ''}`);
      const t = stats.totals || {};

      renderTiles(t);

      $('distribution').innerHTML = stats.distribution.length
        ? barRows(stats.distribution.map((b) => ({ label: b.label, value: b.n })))
        : '<p class="empty">No data yet.</p>';

      const dims = [
        ['ATS parseability', t.avg_ats],
        ['Structure', t.avg_structure],
        ['Impact', t.avg_impact],
        ['Language', t.avg_language],
        ['Job fit', t.avg_job_fit],
        ['Length', t.avg_length]
      ].filter(([, v]) => v != null);
      $('dimensions').innerHTML = dims.length
        ? barRows(dims.map(([label, v]) => ({ label, value: round(v, 1), display: fmt(v, 1) })), { max: 100 })
        : '<p class="empty">No data yet.</p>';

      renderBreakdown($('byRole'), stats.byRole, 'job_label');
      renderBreakdown($('bySeniority'), stats.bySeniority, 'seniority');

      $('keywords').innerHTML = stats.topMissingKeywords.length
        ? stats.topMissingKeywords.map((k) => `<span class="chip"><b>${esc(k.term)}</b><span>${esc(k.n)}</span></span>`).join('')
        : '<p class="empty">No keyword gaps recorded yet.</p>';
    } catch (err) {
      fail(err);
    }
  }

  // ---------- submissions ----------

  async function loadSubmissions() {
    try {
      const data = await api(`/api/admin/submissions?${filterParams()}`);
      state.total = data.total;

      $('count').textContent = `${data.total} stored`;
      $('pageInfo').textContent = data.total
        ? `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} of ${data.total}`
        : 'No submissions yet';
      $('prevPage').disabled = data.offset === 0;
      $('nextPage').disabled = data.offset + data.limit >= data.total;

      if (!data.items.length) {
        $('tableWrap').innerHTML = '<p class="empty">No submissions match these filters.</p>';
        return;
      }

      $('tableWrap').innerHTML = `
        <table class="grid">
          <thead>
            <tr>
              <th>Received</th><th>Role</th><th>Level</th><th>Input</th>
              <th class="num">Overall</th><th class="num">Fit</th><th class="num">Impact</th>
              <th class="num">Words</th><th>Deep</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map((row) => `
              <tr class="clickable" data-id="${esc(row.id)}">
                <td>${esc(when(row.created_at))}</td>
                <td>${esc(row.job_label)}</td>
                <td>${esc(row.seniority)}</td>
                <td class="wrap-cell">${esc(row.filename || 'Pasted text')}</td>
                <td class="num">${scorePill(row.overall)}</td>
                <td class="num">${fmt(row.dim_job_fit)}</td>
                <td class="num">${fmt(row.dim_impact)}</td>
                <td class="num">${fmt(row.word_count)}</td>
                <td>${row.deep ? (row.analysis_ok ? 'Yes' : 'Failed') : 'No'}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      for (const tr of $('tableWrap').querySelectorAll('tr.clickable')) {
        tr.addEventListener('click', () => openDetail(tr.dataset.id));
      }
    } catch (err) {
      fail(err);
    }
  }

  // ---------- deep analysis rendering ----------

  const OUTCOME_LABELS = {
    likely_advance: ['Likely to advance', 'good'],
    borderline: ['Borderline', 'ok'],
    likely_rejected: ['Likely rejected', 'bad']
  };
  const STATUS_LABELS = { met: ['Met', 'good'], partial: ['Partial', 'ok'], missing: ['Missing', 'bad'], unclear: ['Unclear', 'ok'] };

  function tag(label, tone) {
    return `<span class="score-pill ${tone}">${esc(label)}</span>`;
  }

  function bulletList(items) {
    if (!items?.length) return '';
    return `<ul class="analysis-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  }

  function renderAnalysis(a) {
    const [outcomeLabel, outcomeTone] = OUTCOME_LABELS[a.verdict?.screenOutcome] || [a.verdict?.screenOutcome || '—', ''];

    const verdict = a.verdict
      ? `
        <div class="analysis-card">
          <div class="analysis-card-head">
            <b>${esc(a.verdict.headline)}</b>
            ${tag(outcomeLabel, outcomeTone)}
          </div>
          <p>${esc(a.verdict.recruiterFirstImpression)}</p>
          <dl class="analysis-dl">
            <dt>Strongest asset</dt><dd>${esc(a.verdict.strongestAsset)}</dd>
            <dt>Biggest risk</dt><dd>${esc(a.verdict.biggestRisk)}</dd>
          </dl>
        </div>`
      : '';

    const roleFit = a.roleFit
      ? `
        <h3>Role fit — ${esc(a.roleFit.score)}/100</h3>
        <p>${esc(a.roleFit.rationale)}</p>
        ${a.roleFit.seniorityRead ? `<p class="analysis-note">Seniority read: ${esc(a.roleFit.seniorityRead)}</p>` : ''}
        <div class="split">
          <div><b class="analysis-label">Evidence for</b>${bulletList(a.roleFit.evidenceFor)}</div>
          <div><b class="analysis-label">Evidence against</b>${bulletList(a.roleFit.evidenceAgainst)}</div>
        </div>`
      : '';

    const actionPlan = a.actionPlan?.length
      ? `
        <h3>Action plan</h3>
        <table class="grid">
          <thead><tr><th class="num">#</th><th>Action</th><th>Why</th><th>Effort</th></tr></thead>
          <tbody>
            ${[...a.actionPlan].sort((x, y) => x.priority - y.priority).map((s) => `
              <tr>
                <td class="num">${esc(s.priority)}</td>
                <td class="wrap-cell">${esc(s.action)}</td>
                <td class="wrap-cell">${esc(s.why)}</td>
                <td>${esc(s.effort)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
      : '';

    const criteria = a.criteriaCheck?.length
      ? `
        <h3>Requirement check</h3>
        <table class="grid">
          <thead><tr><th>Requirement</th><th>Kind</th><th>Status</th><th>Evidence</th><th>Gap</th></tr></thead>
          <tbody>
            ${a.criteriaCheck.map((c) => {
              const [label, tone] = STATUS_LABELS[c.status] || [c.status, ''];
              return `
                <tr>
                  <td class="wrap-cell">${esc(c.criterion)}</td>
                  <td>${c.kind === 'must' ? 'Must' : 'Nice'}</td>
                  <td>${tag(label, tone)}</td>
                  <td class="wrap-cell">${esc(c.evidence)}</td>
                  <td class="wrap-cell">${esc(c.gap)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`
      : '';

    const redFlags = a.redFlags?.length
      ? `<h3>Red flags</h3>${a.redFlags.map((f) => `
          <div class="analysis-card">
            <b>${esc(f.flag)}</b>
            <p>${esc(f.whyItMatters)}</p>
            <p class="analysis-note">Fix: ${esc(f.howToAddress)}</p>
          </div>`).join('')}`
      : '';

    const sections = a.sectionAnalysis?.length
      ? `<h3>Section review</h3>${a.sectionAnalysis.map((s) => `
          <div class="analysis-card">
            <b>${esc(s.section)}</b>
            <p>${esc(s.assessment)}</p>
            ${bulletList(s.issues)}
          </div>`).join('')}`
      : '';

    const rewrites = a.bulletRewrites?.length
      ? `<h3>Bullet rewrites</h3>${a.bulletRewrites.map((b) => `
          <div class="analysis-card">
            <p class="analysis-before">${esc(b.original)}</p>
            <p class="analysis-note">${esc(b.problem)}</p>
            <p class="analysis-after">${esc(b.rewrite)}</p>
            ${b.needsFromUser ? `<p class="analysis-note">Needs from candidate: ${esc(b.needsFromUser)}</p>` : ''}
          </div>`).join('')}`
      : '';

    const missing = a.missingContent?.length ? `<h3>Missing content</h3>${bulletList(a.missingContent)}` : '';
    const interview = a.interviewRisks?.length ? `<h3>Interview exposure</h3>${bulletList(a.interviewRisks)}` : '';

    return `
      <h3>Deep AI analysis</h3>
      ${verdict}${roleFit}${actionPlan}${criteria}${redFlags}${sections}${rewrites}${missing}${interview}
      <details class="analysis-raw">
        <summary>Raw analysis JSON</summary>
        <pre>${esc(JSON.stringify(a, null, 2))}</pre>
      </details>`;
  }

  // ---------- detail drawer ----------

  let openId = null;

  function closeDrawer() {
    openId = null;
    $('drawer').classList.add('hidden');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('scrim').classList.add('hidden');
  }

  async function openDetail(id) {
    try {
      const row = await api(`/api/admin/submissions/${id}`);
      openId = id;

      $('drawerTitle').textContent = row.filename || 'Pasted text';
      $('drawerSub').textContent = `${row.job_label} · ${row.seniority} · ${when(row.created_at)}`;

      const analysis = row.report?.analysis || null;
      const summary = [
        ['Overall', row.overall], ['ATS parseability', row.dim_ats_parseability], ['Structure', row.dim_structure],
        ['Impact', row.dim_impact], ['Language', row.dim_language], ['Job fit', row.dim_job_fit], ['Length', row.dim_length]
      ];

      $('drawerBody').innerHTML = `
        <h3>Scores</h3>
        <div class="bars">${barRows(summary.map(([label, v]) => ({ label, value: v ?? 0, display: fmt(v) })), { max: 100 })}</div>

        <h3>Facts</h3>
        <table class="grid">
          <tbody>
            <tr><td>Submission id</td><td>${esc(row.id)}</td></tr>
            <tr><td>Input</td><td>${esc(row.source)}${row.file_kind ? ` (${esc(row.file_kind)})` : ''}</td></tr>
            <tr><td>Pages</td><td>${esc(row.pages ?? '—')}</td></tr>
            <tr><td>Words</td><td>${esc(row.word_count ?? '—')}</td></tr>
            <tr><td>Job description</td><td>${row.has_job_description ? 'Supplied' : 'None'}</td></tr>
            <tr><td>Deep analysis</td><td>${row.deep ? (row.analysis_ok ? 'Completed' : `Failed: ${esc(row.analysis_error || 'unknown')}`) : 'Skipped'}</td></tr>
            <tr><td>Host</td><td>${esc(row.host)}</td></tr>
          </tbody>
        </table>

        ${row.missing_keywords.length ? `<h3>Missing keywords</h3><div class="chips">${row.missing_keywords.map((k) => `<span class="chip"><b>${esc(k)}</b></span>`).join('')}</div>` : ''}

        <h3>Resume text</h3>
        <pre>${esc(row.resume_text)}</pre>

        ${row.job_description_text ? `<h3>Job description</h3><pre>${esc(row.job_description_text)}</pre>` : ''}

        ${analysis ? renderAnalysis(analysis) : ''}
      `;

      $('drawer').classList.remove('hidden');
      $('drawer').setAttribute('aria-hidden', 'false');
      $('scrim').classList.remove('hidden');
    } catch (err) {
      fail(err);
    }
  }

  $('drawerClose').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  $('drawerDelete').addEventListener('click', async () => {
    if (!openId) return;
    if (!confirm('Delete this submission permanently? The stored resume text goes with it.')) return;
    try {
      await api(`/api/admin/submissions/${openId}`, { method: 'DELETE' });
      closeDrawer();
      await Promise.all([loadStats(), loadSubmissions(), loadActivity()]);
    } catch (err) {
      fail(err);
    }
  });

  // ---------- wiring ----------

  arm($('resetCounters'), 'Reset counters to zero', () => api('/api/admin/counters/reset', { method: 'POST' }));
  arm($('clearVisitors'), 'Clear visitor list', () => api('/api/admin/visitors', { method: 'DELETE' }));

  $('statsRange').addEventListener('change', loadStats);
  $('applyFilters').addEventListener('click', () => { state.offset = 0; loadSubmissions(); });
  $('fQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.offset = 0; loadSubmissions(); } });
  $('resetFilters').addEventListener('click', () => {
    for (const id of ['fRole', 'fSeniority', 'fSource', 'fMin', 'fMax', 'fQuery']) $(id).value = '';
    state.offset = 0;
    loadSubmissions();
  });
  $('prevPage').addEventListener('click', () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); loadSubmissions(); });
  $('nextPage').addEventListener('click', () => { state.offset += PAGE_SIZE; loadSubmissions(); });

  const saved = sessionStorage.getItem(TOKEN_KEY);
  if (saved) {
    signIn(saved).catch(() => {
      sessionStorage.removeItem(TOKEN_KEY);
      showGate('');
    });
  }
})();
