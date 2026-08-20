import { JOB_PROFILES } from './jobs.js';
import { checkCriteria } from './criteria.js';

// Deterministic checks. These run on every resume and produce the same result for
// the same input, so the numeric scores are reproducible and auditable. The model
// layer reads these findings rather than re-deriving them.

const WEAK_VERBS = [
  'responsible for', 'worked on', 'helped', 'assisted', 'involved in', 'participated in',
  'tasked with', 'duties included', 'handled', 'dealt with', 'in charge of', 'familiar with',
  'exposure to', 'contributed to'
];

const FLUFF = [
  'team player', 'hard worker', 'hard-working', 'go-getter', 'self-starter', 'detail oriented',
  'detail-oriented', 'results-driven', 'think outside the box', 'synergy', 'dynamic professional',
  'proven track record', 'excellent communication skills', 'passionate about', 'wear many hats',
  'ninja', 'rockstar', 'guru'
];

const STRONG_VERBS = [
  'led', 'built', 'shipped', 'launched', 'designed', 'architected', 'reduced', 'increased',
  'grew', 'cut', 'automated', 'migrated', 'scaled', 'negotiated', 'closed', 'delivered',
  'owned', 'drove', 'improved', 'optimised', 'optimized', 'created', 'implemented', 'founded',
  'mentored', 'recovered', 'eliminated', 'streamlined', 'secured', 'won', 'saved', 'generated'
];

const PERSONAL_INFO = [
  { re: /\b(date of birth|d\.o\.b\.?|birthdate)\b/i, label: 'date of birth' },
  { re: /\b(marital status|married|single)\b\s*[:\-]/i, label: 'marital status' },
  { re: /\bnationality\s*[:\-]/i, label: 'nationality' },
  { re: /\b(gender|sex)\s*[:\-]/i, label: 'gender' },
  { re: /\b(religion)\s*[:\-]/i, label: 'religion' }
];

const SECTION_PATTERNS = {
  summary: /^\s*(professional\s+)?(summary|profile|objective|about me)\b/im,
  experience: /^\s*(work\s+|professional\s+|relevant\s+)?(experience|employment|work history|career history)\b/im,
  education: /^\s*(education|academic background|qualifications)\b/im,
  skills: /^\s*(technical\s+)?(skills|competencies|technologies|tech stack)\b/im,
  projects: /^\s*(projects|selected projects|personal projects|portfolio)\b/im,
  certifications: /^\s*(certifications?|licen[cs]es?|awards|honou?rs)\b/im
};

const BULLET_RE = /^\s*(?:[-*•▪◦‣·–—]|\d+[.)])\s+/;
const SECTION_HEAD_RE = new RegExp(
  Object.values(SECTION_PATTERNS)
    .map((r) => r.source)
    .join('|'),
  'i'
);

function words(text) {
  return text.split(/\s+/).filter(Boolean);
}

// Extracted text wraps long bullets across several lines. Join a line back onto the
// previous bullet when it is a continuation rather than a new bullet or heading.
export function getBullets(text) {
  const out = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (BULLET_RE.test(line)) {
      if (current) out.push(current);
      current = line.replace(BULLET_RE, '').trim();
      continue;
    }
    const trimmed = line.trim();
    const isContinuation =
      current &&
      trimmed.length > 0 &&
      !/^[A-Z][A-Za-z ]{0,30}:?$/.test(trimmed) &&
      !SECTION_HEAD_RE.test(trimmed) &&
      /^[a-z(",]|^\d/.test(trimmed);
    if (isContinuation) {
      current += ' ' + trimmed;
    } else if (current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out.filter((b) => b.length > 12);
}

function findContact(text) {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/)?.[0] || null;
  const phone =
    text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d[\d\s.-]{7,}\d/)?.[0]?.trim() || null;
  const linkedin = text.match(/linkedin\.com\/[\w\-/%]+/i)?.[0] || null;
  const github = text.match(/github\.com\/[\w\-/%]+/i)?.[0] || null;
  const site =
    text.match(/\b(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|dev|io|me|net|org|design|xyz)(?:\/[\w\-/%.]*)?/i)?.[0] ||
    null;
  const location =
    text.match(/^[^\n]{0,80}?\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*(?:[A-Z]{2}|[A-Z][a-z]+)\b/m)?.[0]?.trim() ||
    null;
  return { email, phone, linkedin, github, site, location };
}

function findDates(text) {
  const month =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/gi;
  const numeric = /\b(0?[1-9]|1[0-2])[/-](19|20)\d{2}\b/g;
  const yearOnly = /\b(19|20)\d{2}\b/g;
  const ranges = text.match(
    /\b(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)?\d{2}\s*(?:-|–|—|to)\s*(?:present|current|now|(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)?\d{2})\b/gi
  ) || [];
  return {
    monthYear: (text.match(month) || []).length,
    numeric: (text.match(numeric) || []).length,
    years: (text.match(yearOnly) || []).length,
    ranges: ranges.length,
    hasPresent: /\b(present|current)\b/i.test(text)
  };
}

function countMatches(text, list) {
  const lower = text.toLowerCase();
  return list.filter((term) => lower.includes(term.toLowerCase()));
}

function keywordCoverage(text, jobId, jobDescription) {
  const profile = JOB_PROFILES[jobId] || JOB_PROFILES.general;
  const lower = text.toLowerCase();
  const hardHit = profile.hardSkills.filter((k) => lower.includes(k));
  const hardMiss = profile.hardSkills.filter((k) => !lower.includes(k));
  const softHit = profile.softSkills.filter((k) => lower.includes(k));

  let jdTerms = null;
  if (jobDescription && jobDescription.trim().length > 40) {
    const stop = new Set(
      ('the and for with you our are that this will have has your from they their about a an of to in on as be or we us if it not but can may all who whom which when what where why how more most other such into than then them these those job role work team years experience required requirements responsibilities preferred qualifications ability strong excellent good great new including etc per via also within across using use used able across plus bonus nice must should would could company candidate candidates position opportunity benefits salary apply please').split(
        /\s+/
      )
    );
    const freq = new Map();
    for (const raw of jobDescription.toLowerCase().match(/[a-z][a-z+#./-]{2,}/g) || []) {
      const w = raw.replace(/[.\-/]+$/, '');
      if (w.length < 3 || stop.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    const ranked = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([w]) => w);
    jdTerms = {
      matched: ranked.filter((w) => lower.includes(w)),
      missing: ranked.filter((w) => !lower.includes(w))
    };
  }

  return { profile, hardHit, hardMiss, softHit, jdTerms };
}

function pct(part, whole) {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function runRules(text, { jobId, seniority, jobDescription, pages, fileKind }) {
  const allWords = words(text);
  const wordCount = allWords.length;
  const bullets = getBullets(text);
  const contact = findContact(text);
  const dates = findDates(text);

  const sections = {};
  for (const [name, re] of Object.entries(SECTION_PATTERNS)) sections[name] = re.test(text);

  const quantified = bullets.filter((b) =>
    /(\$|€|£|¥|NT\$)?\s?\d[\d,.]*\s?(%|percent|x\b|k\b|m\b|bn\b|million|billion|hours?|days?|weeks?|months?|users?|customers?|clients?|people|engineers?|reps?|accounts?|tickets?|requests?|qps|rps|ms\b|seconds?)/i.test(
      b
    ) || /\b\d[\d,.]*%|\$\s?\d|\b\d{3,}\b/.test(b)
  );
  const startsStrong = bullets.filter((b) =>
    STRONG_VERBS.some((v) => new RegExp(`^${v}\\b`, 'i').test(b.replace(/^["'(]+/, '')))
  );
  const longBullets = bullets.filter((b) => words(b).length > 32);
  const shortBullets = bullets.filter((b) => words(b).length < 6);

  const weakFound = countMatches(text, WEAK_VERBS);
  const fluffFound = countMatches(text, FLUFF);
  const firstPerson = (text.match(/\b(I|I'm|I've|my|me)\b/g) || []).length;
  const passive = (text.match(/\b(was|were|been|being)\s+\w+(ed|en)\b/gi) || []).length;
  const personal = PERSONAL_INFO.filter((p) => p.re.test(text)).map((p) => p.label);

  const estPages = pages || Math.max(1, Math.round(wordCount / 500));
  const kw = keywordCoverage(text, jobId, jobDescription);

  const findings = [];
  const add = (severity, area, message, fix) => findings.push({ severity, area, message, fix });

  // --- Contact / ATS parseability ---
  if (!contact.email) {
    add('critical', 'Contact', 'No email address found.', 'Put a plain-text email in the header — not inside an image, text box, or header/footer region.');
  }
  if (!contact.phone) {
    add('high', 'Contact', 'No phone number found.', 'Add a phone number with country code in the header line.');
  }
  if (!contact.linkedin) {
    add('medium', 'Contact', 'No LinkedIn URL found.', 'Add your LinkedIn URL; most recruiters check it before replying.');
  }
  if (jobId === 'software_engineer' && !contact.github) {
    add('medium', 'Contact', 'No GitHub link for an engineering resume.', 'Add a GitHub (or equivalent) link with pinned, non-tutorial repos.');
  }
  if (jobId === 'design' && !contact.site) {
    add('critical', 'Contact', 'No portfolio URL on a design resume.', 'A design resume without a portfolio link is usually rejected outright. Add the URL to the header.');
  }
  if (fileKind === 'doc') {
    add('high', 'Format', 'Submitted as legacy .doc.', 'Export to PDF (text-based) or .docx. Many ATS parse .doc poorly.');
  }

  // --- Sections ---
  if (!sections.experience) {
    add('critical', 'Structure', 'No recognisable Experience section heading.', 'Use a plain heading such as "Experience" or "Work Experience". ATS keys off standard headings.');
  }
  if (!sections.education) {
    add('high', 'Structure', 'No Education section found.', 'Add an Education section, even if brief — many filters require it.');
  }
  if (!sections.skills) {
    add('high', 'Structure', 'No Skills section found.', 'Add a Skills section listing concrete tools and technologies; it is the main keyword-match surface.');
  }
  if (!sections.summary) {
    add('medium', 'Structure', 'No summary or profile at the top.', 'Add a 2-3 line summary naming the target role, years of experience, and your strongest quantified result.');
  }
  if ((jobId === 'software_engineer' || jobId === 'data_scientist') && !sections.projects && ['intern', 'entry'].includes(seniority)) {
    add('high', 'Structure', 'Junior technical resume with no Projects section.', 'Add 2-3 projects with stack, your specific role, and outcome — this is what replaces work history early on.');
  }

  // --- Dates ---
  if (dates.ranges < 2) {
    add('high', 'Dates', `Only ${dates.ranges} date range detected across the resume.`, 'Give every role and degree a "Mon YYYY – Mon YYYY" range. Missing dates read as a hidden gap.');
  }
  if (dates.monthYear < 2 && dates.years >= 2) {
    add('medium', 'Dates', 'Dates use years only, without months.', 'Use month + year. Year-only dates make recruiters assume you are hiding short stints.');
  }

  // --- Bullets and impact ---
  if (bullets.length === 0) {
    add('critical', 'Impact', 'No bullet points detected — the resume appears to be written as prose blocks.', 'Rewrite experience as 3-6 bullets per role. Prose paragraphs do not get read.');
  } else {
    const quantPct = pct(quantified.length, bullets.length);
    if (quantPct < 40) {
      add(
        quantPct < 20 ? 'critical' : 'high',
        'Impact',
        `Only ${quantPct}% of bullets (${quantified.length} of ${bullets.length}) contain a number.`,
        'Target 60%+. Add scale (users, revenue, volume), delta (from X to Y), or time saved to each bullet.'
      );
    }
    const verbPct = pct(startsStrong.length, bullets.length);
    if (verbPct < 50) {
      add('high', 'Language', `${100 - verbPct}% of bullets do not start with a strong action verb.`, 'Start every bullet with a past-tense action verb: Led, Built, Cut, Grew, Shipped, Negotiated.');
    }
    if (longBullets.length > 0) {
      add('medium', 'Language', `${longBullets.length} bullet(s) run longer than 32 words.`, 'Cap bullets at ~2 lines. Split or cut the setup and keep the outcome.');
    }
    if (shortBullets.length > 2) {
      add('low', 'Language', `${shortBullets.length} bullets are under 6 words and carry no context.`, 'Merge stub bullets into fuller ones with an outcome attached.');
    }
  }

  if (weakFound.length) {
    add('high', 'Language', `Duty-language phrases found: ${weakFound.slice(0, 6).join(', ')}.`, 'Replace "responsible for X" with what changed because of you: "Cut X from A to B by doing Y".');
  }
  if (fluffFound.length) {
    add('medium', 'Language', `Filler phrases found: ${fluffFound.slice(0, 6).join(', ')}.`, 'Delete unprovable adjectives. Replace with an example that demonstrates the trait.');
  }
  if (firstPerson > 3) {
    add('medium', 'Language', `First-person pronouns used ${firstPerson} times.`, 'Drop "I/my". Resume convention is implied first person.');
  }
  if (passive > 4) {
    add('medium', 'Language', `${passive} passive constructions detected.`, 'Rewrite in active voice so ownership is unambiguous.');
  }
  if (personal.length) {
    add('high', 'Compliance', `Personal details present: ${personal.join(', ')}.`, 'Remove for US/UK/EU applications — it invites bias screening and adds no value.');
  }

  // --- Length ---
  const lengthTargets = { intern: 1, entry: 1, mid: 2, senior: 2, lead: 3 };
  const maxPages = lengthTargets[seniority] ?? 2;
  if (estPages > maxPages) {
    add('high', 'Length', `About ${estPages} pages (${wordCount} words) for a ${seniority}-level resume; target is ${maxPages}.`, 'Cut roles older than 10-12 years to one line each and drop bullets that do not support the target role.');
  }
  if (wordCount < 250) {
    add('high', 'Length', `Only ${wordCount} words — the resume is too thin to evaluate properly.`, 'Expand each recent role to 3-5 outcome bullets.');
  }

  // --- Keyword fit ---
  const hardPct = pct(kw.hardHit.length, kw.profile.hardSkills.length);
  if (hardPct < 25) {
    add('high', 'Job fit', `Only ${kw.hardHit.length} of ${kw.profile.hardSkills.length} common ${kw.profile.label} terms appear.`, `Weave in the tools you actually use from: ${kw.hardMiss.slice(0, 10).join(', ')}.`);
  }
  if (kw.jdTerms && kw.jdTerms.missing.length) {
    const missCount = kw.jdTerms.missing.length;
    const total = kw.jdTerms.matched.length + missCount;
    add(
      missCount / total > 0.6 ? 'critical' : 'high',
      'Job fit',
      `${missCount} of the ${total} highest-frequency terms in the job description do not appear in the resume.`,
      `Missing: ${kw.jdTerms.missing.slice(0, 12).join(', ')}. Only add terms that are genuinely true of you.`
    );
  }

  // --- Stated requirements from the posting ---
  const criteria = checkCriteria(text, jobDescription);
  if (criteria) {
    const { mustTotal, mustMissing, mustPartial, mustMet } = criteria.summary;
    const unmet = criteria.items.filter((i) => i.kind === 'must' && i.status === 'missing');
    if (mustTotal && mustMissing) {
      add(
        mustMissing / mustTotal > 0.4 ? 'critical' : 'high',
        'Stated requirements',
        `${mustMissing} of ${mustTotal} stated must-have requirements have no supporting evidence in the resume.`,
        `Unevidenced: ${unmet.slice(0, 4).map((i) => `"${i.text.slice(0, 70)}"`).join('; ')}. Add a bullet for each one you can genuinely claim, using the posting's own wording.`
      );
    }
    if (mustTotal && mustPartial && !mustMissing) {
      add(
        'medium',
        'Stated requirements',
        `${mustPartial} of ${mustTotal} must-have requirements are only partly evidenced (${mustMet} fully met).`,
        'Name the specific tool, scale, or outcome the posting asks for rather than the general area.'
      );
    }
  }

  // --- Scores ---
  const sectionScore = pct(
    ['experience', 'education', 'skills', 'summary'].filter((s) => sections[s]).length,
    4
  );
  const contactScore = pct(
    [contact.email, contact.phone, contact.linkedin, contact.location].filter(Boolean).length,
    4
  );
  const quantScore = bullets.length ? clamp((pct(quantified.length, bullets.length) / 60) * 100) : 0;
  const verbScore = bullets.length ? clamp((pct(startsStrong.length, bullets.length) / 70) * 100) : 0;
  const langPenalty = clamp(weakFound.length * 8 + fluffFound.length * 6 + Math.max(0, firstPerson - 3) * 3 + Math.max(0, passive - 4) * 2, 0, 60);
  const dateScore = clamp(dates.ranges >= 3 ? 100 : dates.ranges * 30 + (dates.monthYear >= 2 ? 10 : 0));
  const lengthScore = estPages > maxPages ? clamp(100 - (estPages - maxPages) * 35) : wordCount < 250 ? 45 : 100;
  const jdScore = kw.jdTerms
    ? pct(kw.jdTerms.matched.length, kw.jdTerms.matched.length + kw.jdTerms.missing.length)
    : null;
  // With a posting in hand, coverage of its stated requirements outweighs raw term
  // frequency; without one, role vocabulary is all there is to go on.
  const fitScore = criteria
    ? clamp(criteria.summary.score * 0.5 + (jdScore ?? 0) * 0.3 + hardPct * 0.4)
    : jdScore === null
      ? clamp(hardPct * 2.2)
      : clamp(jdScore * 0.7 + hardPct * 0.6);

  const dimensions = {
    atsParseability: clamp(contactScore * 0.4 + sectionScore * 0.4 + (fileKind === 'doc' ? 40 : 100) * 0.2),
    structure: clamp(sectionScore * 0.6 + dateScore * 0.4),
    impact: clamp(quantScore * 0.65 + verbScore * 0.35),
    language: clamp(100 - langPenalty),
    jobFit: fitScore,
    length: lengthScore
  };

  const WEIGHTS = { atsParseability: 0.2, structure: 0.15, impact: 0.28, language: 0.14, jobFit: 0.18, length: 0.05 };
  const overall = clamp(
    Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + dimensions[k] * w, 0)
  );

  return {
    overall,
    dimensions,
    metrics: {
      wordCount,
      estPages,
      bulletCount: bullets.length,
      quantifiedBullets: quantified.length,
      quantifiedPct: pct(quantified.length, bullets.length),
      strongVerbPct: pct(startsStrong.length, bullets.length),
      longBullets: longBullets.length,
      firstPerson,
      passive,
      dateRanges: dates.ranges
    },
    contact,
    sections,
    keywords: {
      profileLabel: kw.profile.label,
      matched: kw.hardHit,
      missing: kw.hardMiss.slice(0, 20),
      softMatched: kw.softHit,
      jd: kw.jdTerms
    },
    criteria,
    weakPhrases: weakFound,
    fluffPhrases: fluffFound,
    findings: findings.sort(
      (a, b) =>
        ['critical', 'high', 'medium', 'low'].indexOf(a.severity) -
        ['critical', 'high', 'medium', 'low'].indexOf(b.severity)
    ),
    bullets
  };
}
