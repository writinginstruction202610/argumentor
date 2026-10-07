// server.mjs — local HTTP server: static files, status, and the coaching endpoints.
// Privacy: learner text, provider bodies and credentials are never logged.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { APP_VERSION, CONSENT_VERSION, InputError, MAX_LEARNER_TURNS, QUESTION_TYPES, DECISIONS, englishIssue, isObject, str, integer, dropIfPII, validateInput, validateTask, validateLearnerText, validateSelfAssessment, validatePriorRounds } from './core.mjs';
import { runReview, runDialogueTurn, runRevisionCheck, ReviewError } from './orchestrator.mjs';
import { PROMPT_VERSION } from './prompts.mjs';
import { loadEnv, readConfig, configDir } from './env.mjs';
import { createDeepSeekProvider, ProviderError } from './provider.mjs';
import { createMockProvider } from './mock.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const JS = 'text/javascript; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
export const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ...['app.mjs', 'core.mjs', 'html.mjs', 'i18n.mjs', 'api.mjs', 'diff.mjs', 'report.mjs', 'teacher.mjs'].map(file => [`/${file}`, [file, JS]]),
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/demo/workplace-ai-monitoring.json', ['demo/workplace-ai-monitoring.json', JSON_TYPE]],
  ['/demo/task-workplace-ai.json', ['demo/task-workplace-ai.json', JSON_TYPE]]
]);

export const STATUS = {
  INVALID_INPUT: 400, INPUT_TOO_LONG: 413, MISSING_INPUT: 400, MISSING_REASON: 400, INVALID_ARGUMENTS: 400,
  ENGLISH_REQUIRED: 400, PII_DETECTED: 400, TOO_SHORT: 400, INVALID_TASK: 400, INVALID_REQUEST: 400,
  CONSENT_REQUIRED: 400, JSON_REQUIRED: 415, THREAD_LIMIT: 400, SELF_ASSESSMENT_REQUIRED: 400,
  NOT_CONFIGURED: 503, BUSY: 429, RATE_LIMIT: 429, BUDGET_LIMIT: 429, ACCESS_CODE_REQUIRED: 401,
  KEY_REJECTED: 502, NO_BALANCE: 502, MODEL_NOT_FOUND: 502, PROVIDER_LIMIT: 503, PROVIDER_ERROR: 502,
  PROVIDER_REJECTED_REQUEST: 502, MODEL_DECLINED: 422, INVALID_MODEL_OUTPUT: 502,
  TIMEOUT: 504, CANCELLED: 499, CONNECTION_ERROR: 502
};

const ROUTES = { '/api/review': 'review', '/api/dialogue': 'dialogue', '/api/revision-check': 'check', '/api/verify': 'verify' };
const RATE = { review: [6, 600000], dialogue: [40, 600000], check: [10, 600000], verify: [6, 600000] };
const RESERVE = { review: 12, dialogue: 3, check: 3, verify: 0 };
const BODY_LIMIT = { review: 200000, dialogue: 160000, check: 200000, verify: 2000 };

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'");
}

function sendJson(res, status, data) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': JSON_TYPE });
  res.end(JSON.stringify(data));
}

const decoder = new TextDecoder('utf-8', { fatal: true });
async function readJson(req, max) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new InputError('JSON_REQUIRED');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new InputError('INPUT_TOO_LONG');
    chunks.push(chunk);
  }
  // Decode once, after all chunks arrive, so multi-byte characters split across chunks stay intact.
  let text;
  try { text = decoder.decode(Buffer.concat(chunks)); } catch { throw new InputError('INVALID_INPUT'); }
  try { return JSON.parse(text); } catch { throw new InputError('INVALID_INPUT'); }
}

// ---------- request validation ----------
function validateQuestion(raw) {
  if (!isObject(raw)) throw new InputError('INVALID_REQUEST', 'question');
  const kind = raw.kind === 'feedback' ? 'feedback' : 'question';
  const id = str(raw.id, 8);
  const text = str(raw.text, 600);
  const idOk = kind === 'question' ? /^Q[1-3]$/.test(id) : /^(A[1-3]|L[1-2]|R[1-2])$/.test(id);
  if (!idOk || !text) throw new InputError('INVALID_REQUEST', 'question');
  return { id, kind, type: kind === 'feedback' ? 'feedback' : (QUESTION_TYPES[raw.type] ? raw.type : 'other'), target: str(raw.target, 40), text };
}

function validateThread(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2 * MAX_LEARNER_TURNS - 1) throw new InputError('THREAD_LIMIT', 'thread');
  const thread = raw.map((turn, index) => {
    if (!isObject(turn)) throw new InputError('INVALID_REQUEST', 'thread');
    const from = index % 2 === 0 ? 'learner' : 'coach';
    if (turn.from !== from) throw new InputError('INVALID_REQUEST', 'thread');
    const text = from === 'learner' ? validateLearnerText(turn.text, 'reply', { minWords: 2 }) : str(turn.text, 800);
    if (!text) throw new InputError('INVALID_REQUEST', 'thread');
    return { from, text };
  });
  if (thread.at(-1).from !== 'learner') throw new InputError('INVALID_REQUEST', 'thread');
  return thread;
}

function validatePriorities(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw new InputError('INVALID_REQUEST', 'priorities');
  return raw.map(item => {
    const id = str(item?.id, 8);
    const text = str(item?.text, 600);
    if (!/^[RA][1-3]$/.test(id) || !text) throw new InputError('INVALID_REQUEST', 'priorities');
    return { id, target: str(item.target, 40), text, successCheck: str(item.successCheck, 300) };
  });
}

function validateDecisions(raw, priorities, allowChinese) {
  const decisions = {};
  if (!isObject(raw)) return decisions;
  for (const { id } of priorities) {
    const item = raw[id];
    if (isObject(item) && DECISIONS[item.decision]) decisions[id] = { decision: item.decision, reason: item.reason ? validateLearnerText(item.reason, 'decisionReason', { required: false, allowChinese }) : '' };
  }
  return decisions;
}

// Learner takeaways; screened for personal information before they reach the provider (see dropIfPII).
const validateInsights = raw => (Array.isArray(raw) ? raw : []).slice(0, 6).map(item => dropIfPII(item, 400)).filter(Boolean);

// ---------- concurrency: a FIFO queue so one teacher server can serve a class ----------
export function createLimiter(max, maxQueue, waitMs = 120000) {
  let active = 0;
  const waiting = [];
  const notify = () => waiting.forEach((entry, index) => entry.onPosition?.(index + 1));
  const drop = entry => {
    const index = waiting.indexOf(entry);
    if (index < 0) return false;
    waiting.splice(index, 1);
    clearTimeout(entry.timer);
    notify();
    return true;
  };
  return {
    get active() { return active; },
    get queued() { return waiting.length; },
    acquire(signal, onPosition) {
      if (active < max) { active += 1; return Promise.resolve(); }
      if (waiting.length >= maxQueue) return Promise.reject(new ReviewError('BUSY'));
      return new Promise((resolve, reject) => {
        const entry = { resolve, onPosition };
        entry.timer = setTimeout(() => { if (drop(entry)) reject(new ReviewError('BUSY')); }, waitMs);
        signal?.addEventListener('abort', () => { if (drop(entry)) reject(new ReviewError(signal.reason === 'client' ? 'CANCELLED' : 'TIMEOUT')); }, { once: true });
        waiting.push(entry);
        onPosition?.(waiting.length);
      });
    },
    release() {
      const next = waiting.shift();
      if (next) { clearTimeout(next.timer); next.resolve(); notify(); } else active -= 1;
    }
  };
}

// ---------- daily usage ceiling, persisted so a restart does not reset it ----------
const today = time => { const date = new Date(time); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
export function createUsageStore(file, clock = () => Date.now()) {
  let usage = { day: today(clock()), calls: 0, tokens: 0 };
  if (file && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.day === usage.day) usage = { day: saved.day, calls: integer(saved.calls, 0, 0, 1e9), tokens: integer(saved.tokens, 0, 0, 1e12) };
    } catch { /* a damaged usage file starts a fresh count */ }
  }
  let writing = Promise.resolve();
  const roll = () => { const day = today(clock()); if (day !== usage.day) usage = { day, calls: 0, tokens: 0 }; };
  const persist = () => {
    if (!file) return;
    const snapshot = JSON.stringify(usage);
    writing = writing.then(() => mkdir(dirname(file), { recursive: true, mode: 0o700 })).then(() => writeFile(file, snapshot, { mode: 0o600 })).catch(() => {});
  };
  return {
    get() { roll(); return { ...usage }; },
    addCall() { roll(); usage.calls += 1; persist(); },
    addTokens(count) { roll(); usage.tokens += count; persist(); },
    flush: () => writing
  };
}

export function createApp({ config, provider, root = ROOT, clock = () => Date.now(), usageFile = null, warnings = {} }) {
  const hosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`, `[::1]:${config.port}`]);
  for (const host of config.allowedHosts) hosts.add(/:\d+$/.test(host) ? host : `${host}:${config.port}`);
  const codeDigest = config.accessCode ? createHash('sha256').update(config.accessCode).digest() : null;
  const limiter = createLimiter(config.maxConcurrent, config.maxQueue);
  const usage = createUsageStore(usageFile, clock);
  const rates = new Map();

  const remaining = () => {
    const used = usage.get();
    return { calls: Math.max(0, config.budget - used.calls), tokens: Math.max(0, config.tokenBudget - used.tokens) };
  };
  const status = () => ({
    configured: Boolean(provider),
    provider: provider?.name || 'DeepSeek',
    live: provider ? provider.live : true,
    model: provider?.model || config.model,
    mode: config.reviewMode,
    remainingCalls: remaining().calls,
    remainingTokens: remaining().tokens,
    active: limiter.active,
    queued: limiter.queued,
    appVersion: APP_VERSION,
    promptVersion: PROMPT_VERSION,
    consentVersion: CONSENT_VERSION,
    accessCodeRequired: Boolean(codeDigest),
    maxLearnerTurns: MAX_LEARNER_TURNS,
    keyInProjectFolder: Boolean(warnings.legacyFile)
  });

  const recentFor = (kind, ip) => (rates.get(`${kind}:${ip}`) || []).filter(time => clock() - time < RATE[kind][1]);
  const rateAvailable = (kind, ip) => recentFor(kind, ip).length < RATE[kind][0];
  const recordRate = (kind, ip) => {
    rates.set(`${kind}:${ip}`, [...recentFor(kind, ip), clock()]);
    if (rates.size > 2000) for (const [key, times] of rates) if (!times.some(time => clock() - time < 600000)) rates.delete(key);
  };
  const codeMatches = value => {
    if (!codeDigest) return true;
    return timingSafeEqual(createHash('sha256').update(String(value || '')).digest(), codeDigest);
  };
  const originAllowed = origin => {
    try {
      const url = new URL(origin);
      return (url.protocol === 'http:' || url.protocol === 'https:') && hosts.has(url.host.toLowerCase());
    } catch { return false; }
  };

  function modelCaller(signal) {
    return async ({ messages, temperature, maxTokens }) => {
      if (signal.aborted) throw new ReviewError(signal.reason === 'client' ? 'CANCELLED' : 'TIMEOUT');
      const left = remaining();
      if (left.calls < 1 || left.tokens < 1) throw new ReviewError('BUDGET_LIMIT');
      usage.addCall();
      try {
        const response = await provider.complete({ messages, temperature, maxTokens, signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
        usage.addTokens(response.usage?.total || 0);
        return response;
      } catch (error) {
        if (error instanceof ProviderError || error instanceof ReviewError) throw error;
        if (signal.aborted) throw new ReviewError(signal.reason === 'client' ? 'CANCELLED' : 'TIMEOUT');
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ReviewError('TIMEOUT');
        throw new ReviewError('CONNECTION_ERROR');
      }
    };
  }

  const stamp = (meta, runId) => ({ ...meta, runId, provider: provider.name, model: provider.model, live: provider.live, thinking: config.thinking, appVersion: APP_VERSION, promptVersion: PROMPT_VERSION, at: new Date().toISOString() });

  async function handleModelRoute(kind, req, res) {
    if (!provider) return sendJson(res, STATUS.NOT_CONFIGURED, { error: 'NOT_CONFIGURED' });
    const left = remaining();
    if (left.calls < RESERVE[kind] || left.tokens < 20000) return sendJson(res, 429, { error: 'BUDGET_LIMIT' });
    const ip = req.socket.remoteAddress || 'local';
    if (!rateAvailable(kind, ip)) return sendJson(res, 429, { error: 'RATE_LIMIT' });

    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort('client'); });
    let streaming = false;
    let holding = false;
    let timer = null;
    const emit = event => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
    const runId = randomUUID();
    try {
      const body = await readJson(req, BODY_LIMIT[kind]);
      if (!isObject(body)) throw new InputError('INVALID_INPUT');
      const acquire = async onPosition => {
        await limiter.acquire(controller.signal, onPosition);
        holding = true;
        timer = setTimeout(() => controller.abort('timeout'), kind === 'review' ? 170000 : 90000);
      };
      if (kind === 'verify') {
        recordRate(kind, ip);
        const models = await provider.listModels({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        return sendJson(res, 200, { ok: true, models, modelAvailable: models.includes(provider.model) });
      }
      const input = validateInput(body.input);
      const task = body.task ? validateTask(body.task) : null;
      if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) throw new InputError('CONSENT_REQUIRED');
      const callModel = modelCaller(controller.signal);

      if (kind === 'review') {
        const self = validateSelfAssessment(body.self, input);
        const priorRounds = validatePriorRounds(body.priorRounds);
        const goal = dropIfPII(body.learnerGoal, 300);
        const learnerGoal = goal && !englishIssue(goal) ? goal : '';
        const round = integer(body.round, 1, 1, 99);
        recordRate(kind, ip);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
        streaming = true;
        emit({ type: 'begin', runId, provider: provider.name, model: provider.model, live: provider.live, mode: config.reviewMode, promptVersion: PROMPT_VERSION, appVersion: APP_VERSION });
        await acquire(position => emit({ type: 'queued', position }));
        const outcome = await runReview({ input, task, mode: config.reviewMode, round, selfAssessment: self, priorRounds, learnerGoal, framesRequested: body.framesRequested === true, callModel, emit });
        emit({ type: 'done', complete: outcome.complete, errors: outcome.errors, meta: stamp(outcome.meta, runId) });
        return;
      }
      if (kind === 'dialogue') {
        const question = validateQuestion(body.question);
        const thread = validateThread(body.thread);
        recordRate(kind, ip);
        await acquire();
        const turn = await runDialogueTurn({ input, task, question, thread, callModel });
        return sendJson(res, 200, { ...turn, meta: stamp(turn.meta, runId) });
      }
      const allowChinese = task?.reflectionLanguage !== 'english';
      const priorities = validatePriorities(body.priorities);
      const decisions = validateDecisions(body.decisions, priorities, allowChinese);
      const insights = validateInsights(body.insights);
      const revised = validateLearnerText(body.revised, 'revised', { minWords: 20 });
      recordRate(kind, ip);
      await acquire();
      const check = await runRevisionCheck({ input, task, priorities, decisions, insights, revised, callModel });
      return sendJson(res, 200, { ...check, meta: stamp(check.meta, runId) });
    } catch (error) {
      let code = STATUS[error?.message] ? error.message : 'CONNECTION_ERROR';
      if (!STATUS[error?.message] && controller.signal.aborted) code = controller.signal.reason === 'client' ? 'CANCELLED' : 'TIMEOUT';
      const extra = error instanceof InputError ? { field: error.field || undefined, detail: error.detail || undefined } : {};
      if (streaming) emit({ type: 'error', error: code, runId, ...extra });
      else sendJson(res, STATUS[code] || 500, { error: code, ...extra });
    } finally {
      clearTimeout(timer);
      if (holding) limiter.release();
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const host = String(req.headers.host || '').toLowerCase();
    if (!hosts.has(host)) return sendJson(res, 403, { error: 'HOST_NOT_ALLOWED' });
    let path;
    try { path = new URL(req.url, `http://${host}`).pathname; } catch { return sendJson(res, 400, { error: 'INVALID_REQUEST' }); }
    if (req.method === 'GET' && path === '/api/status') return sendJson(res, 200, status());
    if (req.method === 'GET' && ASSETS.has(path)) {
      const [file, type] = ASSETS.get(path);
      try {
        const content = await readFile(join(root, file));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(content);
      } catch { return sendJson(res, 404, { error: 'NOT_FOUND' }); }
    }
    const kind = ROUTES[path];
    if (req.method !== 'POST' || !kind) return sendJson(res, 404, { error: 'NOT_FOUND' });
    if (req.headers.origin && !originAllowed(req.headers.origin)) return sendJson(res, 403, { error: 'ORIGIN_NOT_ALLOWED' });
    if (!codeMatches(req.headers['x-access-code'])) return sendJson(res, 401, { error: 'ACCESS_CODE_REQUIRED' });
    return handleModelRoute(kind, req, res);
  });
  server.usage = usage;
  server.limiter = limiter;
  return server;
}

// ---------- command-line entry ----------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes('--offline')) process.env.PROVIDER = 'mock';
  const warnings = await loadEnv(ROOT);
  const config = readConfig();
  let provider = null;
  if (config.provider === 'mock') provider = createMockProvider();
  else if (config.key) provider = createDeepSeekProvider(config);
  const server = createApp({ config, provider, usageFile: config.provider === 'mock' ? null : join(configDir(), 'usage.json'), warnings });
  server.requestTimeout = 300000;
  server.headersTimeout = 15000;
  server.listen(config.port, config.host, () => {
    const lines = [`论证工坊 / ArguMentor v${APP_VERSION}: http://localhost:${config.port}`];
    if (config.provider === 'mock') lines.push('离线模板模式（非 AI 反馈） / Offline template mode (not AI feedback)');
    else lines.push(provider ? `DeepSeek 已配置 / configured · model ${config.model} · mode ${config.reviewMode} · 免费自检 / free self-test: npm run check` : 'DeepSeek 尚未配置，请运行 npm run setup / not configured: run npm run setup');
    if (warnings.legacyFile) lines.push('⚠ 项目文件夹内有 .env：复制或压缩此文件夹会泄露密钥。请运行 npm run setup 迁移。/ A .env file is inside the project folder; copying or zipping the folder would leak the key. Run npm run setup to move it.');
    if (warnings.warnings.length) lines.push(`⚠ 配置文件中有无法识别的行 / Unrecognised config lines: ${warnings.warnings.join(', ')}`);
    if (config.host !== '127.0.0.1' && config.host !== 'localhost') lines.push(`⚠ 局域网模式 / LAN mode on ${config.host}:${config.port}. ${config.accessCode ? '已启用访问码 / access code on.' : '未设置 ACCESS_CODE！/ No ACCESS_CODE set!'}`);
    else lines.push('仅本机访问 / local access only');
    console.log(lines.join('\n'));
  });
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${config.port} 已占用，请修改 PORT。 / Port ${config.port} is in use; change PORT.` : `启动失败 / Start failed: ${error.code || error.message}`);
    process.exitCode = 1;
  });
}
