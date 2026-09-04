// Cover letter generation. Deliberately brief: a screener spends seconds on a
// letter, and a short one that names two concrete proof points outperforms a
// page of restated resume. The schema enforces that shape rather than trusting
// the prompt alone.
import { JOB_PROFILES, SENIORITY } from './jobs.js';
import { generateJson } from './gemini.js';

// Hard ceiling on length. The model is told this and the result is checked
// against it, because "be brief" alone reliably produces three paragraphs of filler.
export const MAX_WORDS = 180;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    greeting: { type: 'string', description: 'e.g. "Dear Hiring Manager," — no invented names.' },
    opening: { type: 'string', description: 'One or two sentences: the role, and the single strongest reason to keep reading.' },
    body: {
      type: 'array',
      description: 'One or two short paragraphs, each built on a specific, quantified achievement from the resume.',
      items: { type: 'string' }
    },
    closing: { type: 'string', description: 'One or two sentences: what the candidate wants next.' },
    signoff: { type: 'string', description: 'The valediction only, e.g. "Sincerely," — do not include the name here.' },
    name: { type: 'string', description: "The candidate's name exactly as it appears on the resume." },
    proofPoints: {
      type: 'array',
      description: 'The resume achievements the letter leans on, quoted from the resume.',
      items: { type: 'string' }
    },
    assumptions: {
      type: 'array',
      description: 'Anything stated in the letter that the resume does not directly support, so the user can check it.',
      items: { type: 'string' }
    }
  },
  required: ['greeting', 'opening', 'body', 'closing', 'signoff', 'name', 'proofPoints', 'assumptions']
};

function buildPrompt({ text, jobId, seniority, jobDescription, evidence }) {
  const profile = JOB_PROFILES[jobId] || JOB_PROFILES.general;
  const seniorityHint = SENIORITY[seniority] || SENIORITY.mid;

  return `You are writing a cover letter for a ${profile.label} application. Write the letter the candidate would send, not advice about writing one.

TARGET ROLE: ${profile.label}
TARGET LEVEL: ${seniorityHint}
WHAT MATTERS FOR THIS ROLE: ${profile.focus}

${
    jobDescription?.trim()
      ? `JOB DESCRIPTION — mirror its language and address its stated requirements:\n"""\n${jobDescription.trim().slice(0, 6000)}\n"""\n`
      : 'No job description was supplied. Write against the general bar for this role and level, and keep claims non-specific to any one employer.\n'
  }
${
    evidence?.length
      ? `THE SCREEN ALREADY IDENTIFIED THESE AS THE CANDIDATE'S STRONGEST EVIDENCE — build the letter on them:\n${evidence
          .map((e) => `- ${e}`)
          .join('\n')}\n`
      : ''
  }
RESUME (extracted text; formatting is lost):
"""
${text.slice(0, 12000)}
"""

RULES:
1. HARD LIMIT: ${MAX_WORDS} words total across greeting, opening, body, closing and signoff. Shorter is better. This is the most important rule.
2. body holds ONE or TWO short paragraphs. Never three. Two or three sentences each.
3. Every claim must trace to something in the resume. Invent nothing — no employers, no metrics, no dates, no enthusiasm the resume cannot support.
4. Use the resume's own numbers. "Cut API latency from 800ms to 120ms" beats "improved performance significantly".
5. No filler openings. Never "I am writing to express my interest in" or "I was excited to see". Open with the strongest fact.
6. Do not restate the resume in order. Pick the two things that matter for THIS role and leave the rest.
7. Address it to "Dear Hiring Manager," unless the job description names a person.
8. signoff is the valediction alone ("Sincerely,"). Put the candidate's name in name, taken verbatim from the resume. Never combine them.
9. proofPoints lists the resume lines you built on, quoted. assumptions lists anything a reader might take as fact that the resume does not actually prove — leave it empty if there is nothing.
10. Plain text only. No markdown, no bullet characters, no placeholders like [Company] or [X]%. If you do not know something, write around it.`;
}

function countWords(letter) {
  const parts = [letter.greeting, letter.opening, ...(letter.body || []), letter.closing, letter.signoff, letter.name];
  return parts
    .filter(Boolean)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Returns the letter plus its measured length. Throws on failure so the caller
 * can report it without the rest of the report being affected.
 */
export async function generateCoverLetter({ text, jobId, seniority, jobDescription, evidence }) {
  const letter = await generateJson({
    prompt: buildPrompt({ text, jobId, seniority, jobDescription, evidence }),
    schema: RESPONSE_SCHEMA,
    temperature: 0.4,
    label: 'Cover letter'
  });

  // Trust but verify: the word ceiling is the whole point of the feature, so it
  // is reported rather than assumed.
  const words = countWords(letter);
  return {
    ...letter,
    body: Array.isArray(letter.body) ? letter.body.slice(0, 2) : [],
    words,
    overLimit: words > MAX_WORDS,
    usedJobDescription: Boolean(jobDescription?.trim()),
    maxWords: MAX_WORDS
  };
}
