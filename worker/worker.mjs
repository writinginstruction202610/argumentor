// worker/worker.mjs — optional hosted back end for ArguMentor (Cloudflare Workers).
//
// WHY THIS EXISTS: a static page cannot hold an API key. Anything in the page is readable by every
// visitor, and DeepSeek bills one shared prepaid balance with no per-key cap, so a leaked key means the
// whole balance. This Worker keeps the key as a platform secret: it is never sent to the browser, never
// in the repository, and you can rotate it in seconds without touching the site.
//
// It runs the SAME orchestrator, prompts and integrity guard as the local server, so hosted feedback is
// identical to what a learner gets from `npm start`.
//
// Protections, because this spends YOUR balance:
//   • ACCESS_CODE   — nobody without the code can call it at all.
//   • per-visitor rate limits, matching the local server.
//   • a hard daily call and token ceiling, after which it refuses until the next UTC day.
//   • ALLOWED_ORIGIN — only your site may call it from a browser.
// Rate and usage counters live in KV when a KV namespace is bound, which is what makes the daily cap
// reliable across the many isolates Cloudflare may run. Without KV they fall back to per-isolate memory,
// which still helps but can be exceeded; the deploy guide says so plainly.
import { CONSENT_VERSION, MAX_LEARNER_TURNS, QUESTION_TYPES, DECISIONS, isObject, str, integer, dropIfPII, englishIssue, validateInput, validateTask, validateLearnerText, validateSelfAssessment, validatePriorRounds, APP_VERSION, InputError } from '../core.mjs';
import { runReview, runDialogueTurn, runRevisionCheck, ReviewError } from '../orchestrator.mjs';
import { PROMPT_VERSION } from '../prompts.mjs';
import { createDeepSeekProvider, ProviderError } from '../provider.mjs';

const STATUS = {
  INVALID_INPUT: 400, INPUT_TOO_LONG: 413, MISSING_INPUT: 400, MISSING_REASON: 400, INVALID_ARGUMENTS: 400,
  ENGLISH_REQUIRED: 400, PII_DETECTED: 400, TOO_SHORT: 400, INVALID_TASK: 400, INVALID_REQUEST: 400,
  CONSENT_REQUIRED: 400, JSON_REQUIRED: 415, THREAD_LIMIT: 400, SELF_ASSESSMENT_REQUIRED: 400,
  NOT_CONFIGURED: 503, RATE_LIMIT: 429, BUDGET_LIMIT: 429, ACCESS_CODE_REQUIRED: 401,
  KEY_REJECTED: 502, NO_BALANCE: 502, MODEL_NOT_FOUND: 502, PROVIDER_LIMIT: 503, PROVIDER_ERROR: 502,
  PROVIDER_REJECTED_REQUEST: 502, MODEL_DECLINED: 422, INVALID_MODEL_OUTPUT: 502,
  TIMEOUT: 504, CANCELLED: 499, CONNECTION_ERROR: 502
};
const RATE = { review: 6, dialogue: 40, check: 10 };      // per visitor, per 10 minutes
const RESERVE = { review: 12, dialogue: 3, check: 3 };

const day = () => new Date().toISOString().slice(0, 10);
const memory = new Map(); // fallback when no KV namespace is bound

async function counter(env, key, add = 0) {
  if (env.ARGUMENTOR_KV) {
    const current = Number(await env.ARGUMENTOR_KV.get(key)) || 0;
    if (!add) return current;
    const next = current + add;
    await env.ARGUMENTOR_KV.put(key, String(next), { expirationTtl: 86400 * 2 });
    return next;
  }
  const current = memory.get(key) || 0;
  if (!add) return current;
  memory.set(key, current + add);
  return current + add;
}

const cors = (env, extra = {}) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
  ...extra
});
const json = (env, status, data) => new Response(JSON.stringify(data), { status, headers: cors(env, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }) });

// Constant-time-ish comparison; the code is short and low-value, but there is no reason to leak its length.
function codeMatches(env, given) {
  const expected = env.ACCESS_CODE || '';
  if (!expected) return true;
  const a = String(given || '');
  if (a.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= a.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function validateQuestion(raw) {
  if (!isObject(raw)) throw new InputError('INVALID_REQUEST', 'question');
  const kind = raw.kind === 'feedback' ? 'feedback' : 'question';
  const id = str(raw.id, 8);
  const text = str(raw.text, 600);
  const ok = kind === 'question' ? /^Q[1-3]$/.test(id) : /^(A[1-3]|L[1-2]|R[1-2])$/.test(id);
  if (!ok || !text) throw new InputError('INVALID_REQUEST', 'question');
  return { id, kind, type: kind === 'feedback' ? 'feedback' : (QUESTION_TYPES[raw.type] ? raw.type : 'other'), target: str(raw.target, 40), text };
}

function validateThread(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2 * MAX_LEARNER_TURNS - 1) throw new InputError('THREAD_LIMIT', 'thread');
  const thread = raw.map((turn, index) => {
    const from = index % 2 === 0 ? 'learner' : 'coach';
    if (!isObject(turn) || turn.from !== from) throw new InputError('INVALID_REQUEST', 'thread');
    const text = from === 'learner' ? validateLearnerText(turn.text, 'reply', { minWords: 2 }) : str(turn.text, 800);
    if (!text) throw new InputError('INVALID_REQUEST', 'thread');
    return { from, text };
  });
  if (thread.at(-1).from !== 'learner') throw new InputError('INVALID_REQUEST', 'thread');
  return thread;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    const budget = integer(env.MAX_DAILY_CALLS, 400, 12, 1000000);
    const tokenBudget = integer(env.MAX_DAILY_TOKENS, 3000000, 20000, 1000000000);

    if (path === '/api/status') {
      const used = await counter(env, `calls:${day()}`);
      return json(env, 200, {
        configured: Boolean(env.DEEPSEEK_API_KEY), provider: 'DeepSeek', live: true,
        model: env.DEEPSEEK_MODEL || 'deepseek-flash', mode: 'multi',
        remainingCalls: Math.max(0, budget - used), remainingTokens: Math.max(0, tokenBudget - (await counter(env, `tokens:${day()}`))),
        active: 0, queued: 0, appVersion: APP_VERSION, promptVersion: PROMPT_VERSION, consentVersion: CONSENT_VERSION,
        accessCodeRequired: Boolean(env.ACCESS_CODE), maxLearnerTurns: MAX_LEARNER_TURNS, keyInProjectFolder: false, hosted: true
      });
    }

    const kind = { '/api/review': 'review', '/api/dialogue': 'dialogue', '/api/revision-check': 'check' }[path];
    if (request.method !== 'POST' || !kind) return json(env, 404, { error: 'NOT_FOUND' });
    if (!env.DEEPSEEK_API_KEY) return json(env, 503, { error: 'NOT_CONFIGURED' });
    if (!codeMatches(env, request.headers.get('X-Access-Code'))) return json(env, 401, { error: 'ACCESS_CODE_REQUIRED' });

    const origin = request.headers.get('Origin');
    if (origin && env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return json(env, 403, { error: 'ORIGIN_NOT_ALLOWED' });

    const visitor = request.headers.get('CF-Connecting-IP') || 'unknown';
    const window = Math.floor(Date.now() / 600000);
    const used = await counter(env, `calls:${day()}`);
    const tokensUsed = await counter(env, `tokens:${day()}`);
    if (used + RESERVE[kind] > budget || tokensUsed >= tokenBudget) return json(env, 429, { error: 'BUDGET_LIMIT' });
    if ((await counter(env, `rate:${kind}:${visitor}:${window}`, 1)) > RATE[kind]) return json(env, 429, { error: 'RATE_LIMIT' });

    const provider = createDeepSeekProvider({
      key: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || 'deepseek-flash',
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      thinking: env.DEEPSEEK_THINKING || 'disabled'
    });

    let spentCalls = 0;
    let spentTokens = 0;
    const callModel = async ({ messages, temperature, maxTokens }) => {
      if (used + spentCalls >= budget) throw new ReviewError('BUDGET_LIMIT');
      spentCalls += 1;
      const response = await provider.complete({ messages, temperature, maxTokens, signal: AbortSignal.timeout(60000) });
      spentTokens += response.usage?.total || 0;
      return response;
    };
    const settle = () => ctx.waitUntil(Promise.all([
      counter(env, `calls:${day()}`, spentCalls),
      counter(env, `tokens:${day()}`, spentTokens)
    ]));

    const runId = crypto.randomUUID();
    const stamp = meta => ({ ...meta, runId, provider: 'DeepSeek', model: provider.model, live: true, appVersion: APP_VERSION, promptVersion: PROMPT_VERSION, at: new Date().toISOString() });

    try {
      if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) throw new InputError('JSON_REQUIRED');
      const body = await request.json().catch(() => { throw new InputError('INVALID_INPUT'); });
      if (!isObject(body)) throw new InputError('INVALID_INPUT');
      const input = validateInput(body.input);
      const task = body.task ? validateTask(body.task) : null;
      if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) throw new InputError('CONSENT_REQUIRED');

      if (kind === 'review') {
        const self = validateSelfAssessment(body.self, input);
        const priorRounds = validatePriorRounds(body.priorRounds);
        const goal = dropIfPII(body.learnerGoal, 300);
        const stream = new TransformStream();
        const writer = stream.writable.getWriter();
        const encoder = new TextEncoder();
        const emit = event => writer.write(encoder.encode(`${JSON.stringify(event)}\n`));

        ctx.waitUntil((async () => {
          try {
            await emit({ type: 'begin', runId, provider: 'DeepSeek', model: provider.model, live: true, mode: 'multi', promptVersion: PROMPT_VERSION, appVersion: APP_VERSION });
            const outcome = await runReview({
              input, task, mode: 'multi', round: integer(body.round, 1, 1, 99), selfAssessment: self, priorRounds,
              learnerGoal: goal && !englishIssue(goal) ? goal : '', framesRequested: body.framesRequested === true, callModel, emit
            });
            await emit({ type: 'done', complete: outcome.complete, errors: outcome.errors, meta: stamp(outcome.meta) });
          } catch (error) {
            const code = STATUS[error?.message] ? error.message : 'CONNECTION_ERROR';
            await emit({ type: 'error', error: code, runId });
          } finally {
            settle();
            await writer.close();
          }
        })());

        return new Response(stream.readable, { headers: cors(env, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' }) });
      }

      if (kind === 'dialogue') {
        const turn = await runDialogueTurn({ input, task, question: validateQuestion(body.question), thread: validateThread(body.thread), callModel });
        settle();
        return json(env, 200, { ...turn, meta: stamp(turn.meta) });
      }

      const list = body.priorities;
      if (!Array.isArray(list) || list.length < 1 || list.length > 3) throw new InputError('INVALID_REQUEST', 'priorities');
      const priorities = list.map(item => {
        const id = str(item?.id, 8);
        const text = str(item?.text, 600);
        if (!/^[RA][1-3]$/.test(id) || !text) throw new InputError('INVALID_REQUEST', 'priorities');
        return { id, target: str(item.target, 40), text, successCheck: str(item.successCheck, 300) };
      });
      const allowChinese = task?.reflectionLanguage !== 'english';
      const decisions = {};
      if (isObject(body.decisions)) {
        for (const { id } of priorities) {
          const item = body.decisions[id];
          if (isObject(item) && DECISIONS[item.decision]) decisions[id] = { decision: item.decision, reason: item.reason ? validateLearnerText(item.reason, 'decisionReason', { required: false, allowChinese }) : '' };
        }
      }
      const insights = (Array.isArray(body.insights) ? body.insights : []).slice(0, 6).map(item => dropIfPII(item, 400)).filter(Boolean);
      const revised = validateLearnerText(body.revised, 'revised', { minWords: 20 });
      const check = await runRevisionCheck({ input, task, priorities, decisions, insights, revised, callModel });
      settle();
      return json(env, 200, { ...check, meta: stamp(check.meta) });
    } catch (error) {
      settle();
      const code = STATUS[error?.message] ? error.message : (error instanceof ProviderError ? error.message : 'CONNECTION_ERROR');
      const extra = error instanceof InputError ? { field: error.field || undefined, detail: error.detail || undefined } : {};
      return json(env, STATUS[code] || 500, { error: code, ...extra });
    }
  }
};
