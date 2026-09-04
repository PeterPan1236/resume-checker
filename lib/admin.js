// Shared admin API. Both hosts hand it a D1-shaped binding, the request method,
// a URL, and the Authorization header; it returns { status, body } and never
// touches host-specific types.
import { listSubmissions, getSubmission, deleteSubmission, submissionStats } from './store.js';
import { listCounters, resetCounters, listVisitors, clearVisitors } from './metrics.js';

/**
 * Fails closed: with no ADMIN_TOKEN configured the admin surface stays shut
 * rather than serving stored resumes to anyone who finds the URL.
 */
export function checkAdminAuth(authorization, adminToken) {
  if (!adminToken) {
    return { ok: false, status: 503, error: 'Admin API is disabled: ADMIN_TOKEN is not configured.' };
  }
  const supplied = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!supplied || !timingSafeEqual(supplied, adminToken)) {
    return { ok: false, status: 401, error: 'Invalid or missing admin token.' };
  }
  return { ok: true };
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function num(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function isAdminPath(pathname) {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export async function handleAdmin({ db, method, url, authorization, adminToken }) {
  const auth = checkAdminAuth(authorization, adminToken);
  if (!auth.ok) return { status: auth.status, body: { error: auth.error } };

  if (!db) {
    return { status: 503, body: { error: 'No database is bound. Submissions are not being stored.' } };
  }

  const { pathname, searchParams } = url;

  if (pathname === '/api/admin/ping' && method === 'GET') {
    return { status: 200, body: { ok: true } };
  }

  if (pathname === '/api/admin/submissions' && method === 'GET') {
    const data = await listSubmissions(db, {
      jobId: searchParams.get('jobId') || undefined,
      seniority: searchParams.get('seniority') || undefined,
      source: searchParams.get('source') || undefined,
      minScore: num(searchParams.get('minScore')),
      maxScore: num(searchParams.get('maxScore')),
      search: searchParams.get('q') || undefined,
      sort: searchParams.get('sort') || undefined,
      dir: searchParams.get('dir') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined
    });
    return { status: 200, body: data };
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    const data = await submissionStats(db, { days: num(searchParams.get('days')) });
    return { status: 200, body: data };
  }

  if (pathname === '/api/admin/counters' && method === 'GET') {
    return { status: 200, body: { counters: await listCounters(db) } };
  }

  // POST rather than GET: this mutates. An optional ?name= zeroes one counter,
  // otherwise every counter resets.
  if (pathname === '/api/admin/counters/reset' && method === 'POST') {
    const name = searchParams.get('name') || undefined;
    const out = await resetCounters(db, name);
    if (name && !out.reset.length) {
      return { status: 400, body: { error: `No counter named "${name}".` } };
    }
    return { status: 200, body: out };
  }

  if (pathname === '/api/admin/visitors' && method === 'GET') {
    const data = await listVisitors(db, {
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined
    });
    return { status: 200, body: data };
  }

  if (pathname === '/api/admin/visitors' && method === 'DELETE') {
    return { status: 200, body: await clearVisitors(db) };
  }

  const detail = pathname.match(/^\/api\/admin\/submissions\/([\w-]+)$/);
  if (detail) {
    const id = detail[1];
    if (method === 'GET') {
      const row = await getSubmission(db, id);
      if (!row) return { status: 404, body: { error: 'No submission with that id.' } };
      return { status: 200, body: row };
    }
    if (method === 'DELETE') {
      const changes = await deleteSubmission(db, id);
      if (!changes) return { status: 404, body: { error: 'No submission with that id.' } };
      return { status: 200, body: { deleted: id } };
    }
  }

  return { status: 404, body: { error: 'Unknown admin endpoint.' } };
}
