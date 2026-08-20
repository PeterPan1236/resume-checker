import { GoogleGenerativeAI } from '@google/generative-ai';
import { JOB_PROFILES, SENIORITY } from './jobs.js';

const MODEL = 'gemini-2.5-flash';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        recruiterFirstImpression: { type: 'string' },
        strongestAsset: { type: 'string' },
        biggestRisk: { type: 'string' },
        screenOutcome: { type: 'string', enum: ['likely_advance', 'borderline', 'likely_rejected'] }
      },
      required: ['headline', 'recruiterFirstImpression', 'strongestAsset', 'biggestRisk', 'screenOutcome']
    },
    roleFit: {
      type: 'object',
      properties: {
        score: { type: 'number', description: 'Role fit on a 0-100 scale, matching the deterministic overall score.' },
        rationale: { type: 'string' },
        evidenceFor: { type: 'array', items: { type: 'string' } },
        evidenceAgainst: { type: 'array', items: { type: 'string' } },
        seniorityRead: { type: 'string' }
      },
      required: ['score', 'rationale', 'evidenceFor', 'evidenceAgainst', 'seniorityRead']
    },
    sectionAnalysis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' },
          assessment: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } }
        },
        required: ['section', 'assessment', 'issues']
      }
    },
    bulletRewrites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          problem: { type: 'string' },
          rewrite: { type: 'string' },
          needsFromUser: { type: 'string' }
        },
        required: ['original', 'problem', 'rewrite', 'needsFromUser']
      }
    },
    redFlags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          flag: { type: 'string' },
          whyItMatters: { type: 'string' },
          howToAddress: { type: 'string' }
        },
        required: ['flag', 'whyItMatters', 'howToAddress']
      }
    },
    criteriaCheck: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterion: { type: 'string' },
          kind: { type: 'string', enum: ['must', 'nice'] },
          status: { type: 'string', enum: ['met', 'partial', 'missing', 'unclear'] },
          evidence: { type: 'string' },
          gap: { type: 'string' },
          howToAddress: { type: 'string' }
        },
        required: ['criterion', 'kind', 'status', 'evidence', 'gap', 'howToAddress']
      }
    },
    missingContent: { type: 'array', items: { type: 'string' } },
    actionPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priority: { type: 'number' },
          action: { type: 'string' },
          why: { type: 'string' },
          effort: { type: 'string', enum: ['5 min', '30 min', '2 hrs'] }
        },
        required: ['priority', 'action', 'why', 'effort']
      }
    },
    interviewRisks: { type: 'array', items: { type: 'string' } }
  },
  required: ['verdict', 'roleFit', 'sectionAnalysis', 'bulletRewrites', 'redFlags', 'criteriaCheck', 'missingContent', 'actionPlan', 'interviewRisks']
};

function buildPrompt({ text, jobId, seniority, jobDescription, rules }) {
  const profile = JOB_PROFILES[jobId] || JOB_PROFILES.general;
  const seniorityHint = SENIORITY[seniority] || SENIORITY.mid;

  return `You are a hiring manager and technical recruiter who has screened thousands of resumes for ${profile.label} roles. Review the resume below the way you would in a real screen: fast, specific, and unsentimental. No praise that is not earned.

TARGET ROLE: ${profile.label}
TARGET LEVEL: ${seniorityHint}
WHAT MATTERS FOR THIS ROLE: ${profile.focus}
SIGNALS YOU SPECIFICALLY LOOK FOR:
${profile.signals.map((s) => `- ${s}`).join('\n')}

${jobDescription?.trim() ? `JOB DESCRIPTION THE CANDIDATE IS TARGETING:\n"""\n${jobDescription.trim().slice(0, 6000)}\n"""\n` : 'No specific job description was supplied; judge against the general bar for this role and level.\n'}
DETERMINISTIC SCAN ALREADY RUN (do not repeat these mechanical findings; build on them and explain what they mean for this specific candidate):
${JSON.stringify(
    {
      overall: rules.overall,
      dimensions: rules.dimensions,
      metrics: rules.metrics,
      sectionsPresent: rules.sections,
      contactFound: rules.contact,
      keywordsMatched: rules.keywords.matched,
      keywordsMissing: rules.keywords.missing,
      jdTermGap: rules.keywords.jd?.missing ?? null,
      ruleFindings: rules.findings.map((f) => `${f.severity}: ${f.message}`),
      statedRequirementsCoverage: rules.criteria?.summary ?? null
    },
    null,
    1
  )}

${
    rules.criteria?.items?.length
      ? `REQUIREMENTS EXTRACTED FROM THAT POSTING — judge every one of these, in this order, in criteriaCheck:\n${rules.criteria.items
          .map((c, i) => `${i + 1}. [${c.kind}] ${c.text}`)
          .join('\n')}\n`
      : 'No job description was supplied, so return an empty criteriaCheck array.\n'
  }
RESUME TEXT (extracted; formatting is lost, so do not comment on fonts, colours, or visual layout):
"""
${text}
"""

Rules for your analysis:
1. Quote the resume. Every criticism must name the specific line, role, or bullet it refers to. Generic advice is worthless.
2. Judge against the target level. A missing team size matters for a Director and not for an intern.
3. For bulletRewrites, pick the 5-8 weakest high-value bullets. Keep the rewrite truthful: never invent numbers. Where a number is needed, use a clear placeholder like [X%] or [N users] and state in needsFromUser exactly what fact the candidate must supply.
4. redFlags covers what a recruiter would pause on: unexplained gaps, short tenures, backwards titles, career pivots not bridged, dated tech, inflated claims, missing licence or credential.
5. criteriaCheck answers one question per extracted requirement: does this resume prove it? Keep the criterion text verbatim and keep the supplied order. "met" needs a quotable line from the resume — put that quote in evidence. "partial" means adjacent or unquantified evidence; say what is thin in gap. "missing" means nothing in the resume supports it. "unclear" only when the requirement itself is too vague to judge. A keyword appearing in a skills list is partial, not met — met requires applied experience. howToAddress is the concrete edit, or "cannot be fixed by editing" when the candidate genuinely lacks it.
6. missingContent lists things absent that this role expects to see.
7. actionPlan is ordered by score impact, most impactful first, maximum 7 items, each with a realistic effort tag.
8. interviewRisks lists questions this resume invites that the candidate should prepare for.
9. screenOutcome is your honest call on a first-pass screen for the target role.
10. Be concrete and terse. No filler, no encouragement padding.
11. roleFit.score is an integer from 0 to 100, on the same scale as the deterministic overall score above. Do not use a 0-10 scale: a mid-level candidate who is a reasonable but imperfect fit scores around 65, not 6.5.`;
}

export async function deepAnalyze({ text, jobId, seniority, jobDescription, rules }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    }
  });

  const prompt = buildPrompt({ text, jobId, seniority, jobDescription, rules });

  // 503/429 from the model API are routinely transient; retry with backoff before
  // falling back to rules-only output.
  let result;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (err) {
      const retryable = /\b(429|500|503|504)\b|overloaded|high demand/i.test(err.message || '');
      if (!retryable || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }

  const raw = result.response.text();
  try {
    return JSON.parse(raw);
  } catch {
    const salvaged = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.parse(salvaged);
  }
}
