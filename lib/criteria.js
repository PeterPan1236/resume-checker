// Pulls the individual requirements out of a job description and checks each one
// against the resume text. Deterministic: no model involved, so the same posting
// always yields the same criteria list in the same order.

const STOP = new Set(
  ('a an the and or of to in on at for with from by as is are be been being that this these those you your our we us they their it its will would should could can may must have has had not but if then than so such other others including etc via using use used able across within per over under about into more most new strong excellent good great proven solid track record ability abilities experience experienced experiences work working works team teams role roles job jobs position candidate candidates company companies year years plus bonus nice preferred required requirement requirements qualification qualifications responsibility responsibilities skills skill knowledge understanding familiarity demonstrated hands-on hands on well highly very both all any each e.g i.e ideally similar related relevant equivalent degree field who whom whose want wants welcome willing looking able another practical strong solid great etc join joining help helping ensure ensuring drive driving deliver delivering partner partnering various several').split(
    /\s+/
  )
);

const SECTION_MUST = /\b(requirement|qualification|must have|minimum|basic qualification|what you.{0,6}ll need|who you are|about you|we.{0,3}re looking for|skills? (?:and|&) experience)\b/i;
const SECTION_NICE = /\b(nice to have|preferred|bonus|plus(?:es)?|desirable|good to have|extra credit)\b/i;
const SECTION_SKIP = /\b(benefit|perk|compensation|salary|equal opportunit|about (?:us|the company|the team|the role)|our (?:mission|values|team)|how to apply|why join|what we offer|what you.{0,6}ll do|responsibilit|day[- ]to[- ]day|the opportunity)\b/i;

// Only a trailing hedge downgrades a line to nice-to-have; "PostgreSQL preferred"
// inside a minimum-qualifications bullet is still a must.
const LINE_NICE = /\b(is a plus|a plus\b|nice to have|bonus points|would be a bonus)\b/i;

const CUE = /\b(experience|proficien|familiar|knowledge|degree|bachelor|master|phd|certif|licen[cs]|fluent|years?\b|must|require|expect|able to|ability to|comfortable|track record|background in|strong|demonstrated|understanding of|hands[- ]on|willing|expertise)\b/i;
const BULLET = /^\s*(?:[-–—•*·▪◦‣]|\(?\d{1,2}[).]|[a-z][).])\s+/i;

function looksLikeHeading(line) {
  const w = line.split(/\s+/).length;
  return w <= 6 && (/[:：]$/.test(line) || line === line.toUpperCase()) && !/\d{4}/.test(line);
}

function cleanCriterion(line) {
  return line
    .replace(BULLET, '')
    .replace(/^[\s"'(]+/, '')
    .replace(/[;,.\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 240);
}

function termsOf(criterion) {
  const raw = criterion.toLowerCase().match(/[a-z][a-z0-9+#./-]{1,}/g) || [];
  const out = [];
  for (const t of raw) {
    const w = t.replace(/[.\-/]+$/, '');
    if (w.length < 3 || STOP.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, 14);
}

// Crude suffix stripping so "mentoring" in a posting matches "mentored" in a resume.
function stem(word) {
  let w = word;
  for (const suffix of ['ations', 'ation', 'ing', 'ers', 'er', 'ies', 'ed', 'es', 's']) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w.endsWith('i') ? `${w.slice(0, -1)}y` : w;
}

function resumeIndex(resumeText) {
  const lower = resumeText.toLowerCase();
  const stems = new Set((lower.match(/[a-z][a-z0-9+#./-]{1,}/g) || []).map((t) => stem(t.replace(/[.\-/]+$/, ''))));
  return { lower, stems };
}

function yearsRequired(criterion) {
  const m = criterion.match(/(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(\d{1,2})?\s*(?:\+)?\s*(?:years?|yrs?)/i);
  if (!m) return null;
  return Number(m[1]);
}

// Rough span of the career the resume describes: earliest four-digit year that
// reads as a work/education date through to the latest (or now, if "Present").
export function estimateYearsOfExperience(resumeText) {
  const years = (resumeText.match(/\b(19[89]\d|20[0-4]\d)\b/g) || []).map(Number);
  if (!years.length) return null;
  const now = new Date().getFullYear();
  const valid = years.filter((y) => y >= 1985 && y <= now);
  if (!valid.length) return null;
  const earliest = Math.min(...valid);
  const latest = /\b(present|current|now)\b/i.test(resumeText) ? now : Math.max(...valid);
  return Math.max(0, latest - earliest);
}

export function extractCriteria(jobDescription) {
  if (!jobDescription || jobDescription.trim().length < 40) return [];

  const lines = jobDescription.split('\n').map((l) => l.trim());
  const items = [];
  const seen = new Set();
  let kindFromSection = null;
  let skipping = false;

  let lastBulletIndex = -1;

  for (const line of lines) {
    if (!line) { lastBulletIndex = -1; continue; }

    if (looksLikeHeading(line) || line.length < 60) {
      if (SECTION_SKIP.test(line)) { skipping = true; kindFromSection = null; }
      else if (SECTION_NICE.test(line)) { skipping = false; kindFromSection = 'nice'; }
      else if (SECTION_MUST.test(line)) { skipping = false; kindFromSection = 'must'; }
    }
    if (skipping) continue;

    const isBullet = BULLET.test(line);

    // A wrapped bullet continues on the next line: fold it back into the item it
    // belongs to instead of dropping half the requirement.
    if (!isBullet && lastBulletIndex >= 0 && !looksLikeHeading(line) && /^[a-z(]/.test(line)) {
      const merged = `${items[lastBulletIndex].text} ${line}`.replace(/\s{2,}/g, ' ').trim();
      items[lastBulletIndex].text = merged.slice(0, 240);
      continue;
    }

    if (!isBullet && !CUE.test(line)) { lastBulletIndex = -1; continue; }
    if (looksLikeHeading(line)) { lastBulletIndex = -1; continue; }

    const text = cleanCriterion(line);
    if (text.length < 12 || text.length > 240) continue;
    if (!/[a-z]/i.test(text)) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const nice = LINE_NICE.test(text) || (kindFromSection === 'nice' && !/\bmust\b|\brequired\b/i.test(text));
    items.push({ text, kind: nice ? 'nice' : 'must' });
    lastBulletIndex = isBullet ? items.length - 1 : -1;
    if (items.length >= 24) break;
  }

  return items;
}

export function checkCriteria(resumeText, jobDescription) {
  const extracted = extractCriteria(jobDescription);
  if (!extracted.length) return null;

  const { lower, stems } = resumeIndex(resumeText);
  const resumeYears = estimateYearsOfExperience(resumeText);

  const items = extracted.map((item) => {
    const terms = termsOf(item.text);
    const matched = terms.filter((t) => lower.includes(t) || stems.has(stem(t)));
    const missing = terms.filter((t) => !matched.includes(t));
    const coverage = terms.length ? matched.length / terms.length : 0;

    // A posting sentence carries plenty of connective vocabulary, so full coverage is
    // not the bar: a couple of the distinctive terms landing is real evidence.
    let status = coverage >= 0.6 ? 'met' : coverage >= 0.2 || matched.length >= 2 ? 'partial' : 'missing';

    const needYears = yearsRequired(item.text);
    let note = null;
    if (needYears !== null) {
      if (resumeYears === null) {
        note = `Asks for ${needYears}+ years; the resume has no datable history to prove it.`;
        status = status === 'met' ? 'partial' : status;
      } else if (resumeYears + 1 < needYears) {
        note = `Asks for ${needYears}+ years; the resume evidences roughly ${resumeYears}.`;
        status = 'missing';
      } else {
        note = `Asks for ${needYears}+ years; the resume evidences roughly ${resumeYears}.`;
      }
    }

    return {
      text: item.text,
      kind: item.kind,
      status,
      coverage: Math.round(coverage * 100),
      matchedTerms: matched.slice(0, 8),
      missingTerms: missing.slice(0, 8),
      note
    };
  });

  const must = items.filter((i) => i.kind === 'must');
  const nice = items.filter((i) => i.kind === 'nice');
  const tally = (list, status) => list.filter((i) => i.status === status).length;

  return {
    resumeYears,
    items,
    summary: {
      total: items.length,
      mustTotal: must.length,
      mustMet: tally(must, 'met'),
      mustPartial: tally(must, 'partial'),
      mustMissing: tally(must, 'missing'),
      niceTotal: nice.length,
      niceMet: tally(nice, 'met'),
      score: items.length
        ? Math.round(
            ((tally(items, 'met') + tally(items, 'partial') * 0.5) / items.length) * 100
          )
        : 0
    }
  };
}
