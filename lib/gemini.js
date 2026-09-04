// Shared Gemini client. Both lib/analyze.js and lib/cover-letter.js need the same
// timeout ceiling, retry policy and JSON salvage, so that logic lives here once.
//
// Called over plain fetch rather than @google/generative-ai: the SDK pulls in Node
// internals that hang the Workers runtime, and fetch behaves the same on both hosts.

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Without a ceiling a stalled model call holds the request open until the host
// kills it, which on Workers costs the whole invocation.
export const DEEP_TIMEOUT_MS = Number(process.env.DEEP_TIMEOUT_MS) || 45000;

/**
 * The REST API wants schema types as uppercase enum names, while the schemas are
 * written in the lowercase form the SDK used.
 */
export function toRestSchema(node) {
  if (Array.isArray(node)) return node.map(toRestSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && typeof value === 'string') out[key] = value.toUpperCase();
    else out[key] = toRestSchema(value);
  }
  return out;
}

async function callOnce(apiKey, prompt, restSchema, { temperature, timeoutMs }) {
  const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema: restSchema
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}). ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  const candidate = payload?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    const reason = candidate?.finishReason || payload?.promptFeedback?.blockReason || 'no content';
    throw new Error(`Gemini returned no usable content (${reason}).`);
  }
  return text;
}

/**
 * Runs a prompt and returns parsed JSON matching `schema`.
 * 503/429 from the model API are routinely transient, so those retry with backoff
 * before the caller falls back.
 */
export async function generateJson({
  prompt,
  schema,
  temperature = 0.3,
  timeoutMs = DEEP_TIMEOUT_MS,
  label = 'Model call'
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const restSchema = toRestSchema(schema);

  let raw;
  for (let attempt = 0; ; attempt++) {
    try {
      raw = await callOnce(apiKey, prompt, restSchema, { temperature, timeoutMs });
      break;
    } catch (err) {
      const message =
        err.name === 'TimeoutError' ? `${label} timed out after ${timeoutMs}ms.` : err.message || '';
      const retryable = /(429|500|503|504)|overloaded|high demand/i.test(message);
      if (!retryable || attempt >= 2) throw new Error(message || `${label} failed.`);
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    const salvaged = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.parse(salvaged);
  }
}
