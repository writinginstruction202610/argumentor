import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, createLimiter, createUsageStore, ASSETS } from '../server.mjs';
import { readConfig } from '../env.mjs';
import { createMockProvider } from '../mock.mjs';
import { CONSENT_VERSION } from '../core.mjs';
import { MAP } from './helpers.mjs';

const freePort = () => new Promise(resolve => { const server = netServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

async function start(overrides = {}) {
  const port = await freePort();
  const config = { ...readConfig({}), port, provider: 'mock', ...overrides };
  const app = createApp({ config, provider: createMockProvider(), usageFile: null });
  await new Promise(resolve => app.listen(port, '127.0.0.1', resolve));
  return { app, port, base: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => app.close(resolve)) };
}

function raw(port, { method = 'GET', path = '/', headers = {}, chunks = [] }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const parts = [];
      res.on('data', chunk => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

const reviewBody = extra => ({ input: MAP, consent: true, consentVersion: CONSENT_VERSION, self: { element: 'arguments.0.warrant', reason: 'My first reason has no warrant yet.' }, round: 1, ...extra });
const post = (base, path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('status, static files and the asset allow-list', async () => {
  const server = await start();
  try {
    const status = await (await fetch(`${server.base}/api/status`)).json();
    assert.equal(status.configured, true);
    assert.equal(status.live, false);
    assert.equal(status.consentVersion, CONSENT_VERSION);
    const page = await fetch(`${server.base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
    for (const path of ['/.env', '/../.env', '/server.mjs', '/package.json']) assert.equal((await raw(server.port, { path })).status, 404, path);
  } finally { await server.close(); }
});

test('every whitelisted asset exists on disk', async () => {
  for (const [, [file]] of ASSETS) await readFile(new URL(`../${file}`, import.meta.url));
});

test('host and origin checks block DNS rebinding and cross-site requests', async () => {
  const server = await start();
  try {
    assert.equal((await raw(server.port, { headers: { Host: 'evil.example' } })).status, 403);
    const body = JSON.stringify(reviewBody());
    const crossSite = await raw(server.port, { method: 'POST', path: '/api/review', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example', Host: `127.0.0.1:${server.port}` }, chunks: [body] });
    assert.equal(crossSite.status, 403);
  } finally { await server.close(); }
});

test('review requests are validated before any model call', async () => {
  const server = await start();
  try {
    const cases = [
      [reviewBody({ consent: false }), 'CONSENT_REQUIRED'],
      [reviewBody({ consentVersion: 'old' }), 'CONSENT_REQUIRED'],
      [reviewBody({ self: null }), 'SELF_ASSESSMENT_REQUIRED'],
      [reviewBody({ input: { ...MAP, claim: '我认为不应该使用人工智能监控员工。' } }), 'ENGLISH_REQUIRED'],
      [reviewBody({ input: { ...MAP, draft: 'Mail me: someone@example.com' } }), 'PII_DETECTED']
    ];
    for (const [body, code] of cases) {
      const response = await post(server.base, '/api/review', body);
      assert.equal((await response.json()).error, code);
    }
    const typed = await fetch(`${server.base}/api/review`, { method: 'POST', body: '{}' });
    assert.equal(typed.status, 415);
    assert.equal(server.app.usage.get().calls, 0, 'invalid requests never reach the model');
  } finally { await server.close(); }
});

test('a full review streams begin, role results and done', async () => {
  const server = await start();
  try {
    const response = await post(server.base, '/api/review', reviewBody());
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].type, 'begin');
    assert.ok(events[0].runId);
    assert.deepEqual(events.filter(event => event.type === 'result').map(event => event.role).sort(), ['analyst', 'coordinator', 'language', 'socratic']);
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.complete, true);
    assert.equal(done.meta.calls, 4);
    assert.equal(done.meta.live, false);
  } finally { await server.close(); }
});

test('dialogue and revision-check endpoints validate threads and priorities', async () => {
  const server = await start();
  try {
    const base = { input: MAP, consent: true, consentVersion: CONSENT_VERSION };
    const question = { id: 'Q1', kind: 'question', type: 'evidence', target: 'Reason 1', text: 'What would a manager need to see?' };
    const ok = await (await post(server.base, '/api/dialogue', { ...base, question, thread: [{ from: 'learner', text: 'Numbers about stress at work.' }] })).json();
    assert.equal(ok.move, 'probe');
    const long = Array.from({ length: 7 }, (_, index) => ({ from: index % 2 ? 'coach' : 'learner', text: 'Some words here.' }));
    assert.equal((await (await post(server.base, '/api/dialogue', { ...base, question, thread: long })).json()).error, 'THREAD_LIMIT');
    assert.equal((await (await post(server.base, '/api/dialogue', { ...base, question: { ...question, id: 'X9' }, thread: [{ from: 'learner', text: 'Some words here.' }] })).json()).error, 'INVALID_REQUEST');
    const check = await (await post(server.base, '/api/revision-check', { ...base, priorities: [{ id: 'R1', target: 'Reason 1', text: 'Add a warrant.' }], decisions: { R1: { decision: 'accept', reason: 'It is missing.' } }, revised: 'Employers should limit AI monitoring because constant tracking lowers trust, and lower trust harms the cooperation that logistics teams need.' })).json();
    assert.equal(check.result.checks[0].priorityId, 'R1');
    const short = await (await post(server.base, '/api/revision-check', { ...base, priorities: [{ id: 'R1', target: 'Reason 1', text: 'Add a warrant.' }], revised: 'Too short.' })).json();
    assert.equal(short.error, 'TOO_SHORT');
  } finally { await server.close(); }
});

test('UTF-8 characters split across request chunks are decoded intact', async () => {
  const server = await start();
  try {
    const body = Buffer.from(JSON.stringify({ input: { ...MAP, claim: 'Employers shouldn’t rely on AI monitoring — at least not by default.' }, consent: false }), 'utf8');
    const split = body.indexOf(Buffer.from('’')) + 1; // inside the 3-byte character
    const response = await raw(server.port, { method: 'POST', path: '/api/review', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }, chunks: [body.subarray(0, split), body.subarray(split)] });
    assert.equal(JSON.parse(response.body).error, 'CONSENT_REQUIRED', 'the body parsed correctly and validation reached the consent check');
  } finally { await server.close(); }
});

test('classroom access code and daily budget', async () => {
  const locked = await start({ accessCode: 'class-42' });
  try {
    assert.equal((await post(locked.base, '/api/review', reviewBody())).status, 401);
    assert.equal((await (await post(locked.base, '/api/review', reviewBody({ consent: false }), { 'X-Access-Code': 'class-42' })).json()).error, 'CONSENT_REQUIRED');
  } finally { await locked.close(); }
  const poor = await start({ budget: 5 });
  try {
    assert.equal((await (await post(poor.base, '/api/review', reviewBody())).json()).error, 'BUDGET_LIMIT');
  } finally { await poor.close(); }
});

test('the limiter queues requests in order and reports positions', async () => {
  const limiter = createLimiter(1, 5, 2000);
  await limiter.acquire();
  const positions = [];
  const second = limiter.acquire(undefined, position => positions.push(position));
  assert.equal(limiter.queued, 1);
  limiter.release();
  await second;
  assert.deepEqual(positions, [1]);
  assert.equal(limiter.active, 1);
  limiter.release();
  assert.equal(limiter.active, 0);
  const full = createLimiter(1, 0, 2000);
  await full.acquire();
  await assert.rejects(full.acquire(), /BUSY/);
});

test('usage persists across restarts within the same day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'argumentor-'));
  const file = join(dir, 'usage.json');
  const first = createUsageStore(file);
  first.addCall();
  first.addTokens(1234);
  await first.flush();
  const second = createUsageStore(file);
  assert.deepEqual({ calls: second.get().calls, tokens: second.get().tokens }, { calls: 1, tokens: 1234 });
});
