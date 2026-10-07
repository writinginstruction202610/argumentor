import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildRecord, verifyRecord, reportHTML, recordStats, fileName, sha256Fallback, stableStringify } from '../report.mjs';
import { defaultState, newRound, validateInput } from '../core.mjs';
import { html, raw, esc } from '../html.mjs';
import { wordDiff, diffStats } from '../diff.mjs';
import { MAP } from './helpers.mjs';

function sampleState() {
  const state = defaultState();
  state.data = validateInput(MAP);
  state.learnerCode = 'S07';
  const round = newRound(1, validateInput(MAP));
  round.results.analyst = { role: 'analyst', focus: 'F', items: [{ id: 'A1', criterion: 'warrant', target: 'Reason 1', anchor: '', anchorField: '', text: '<script>alert(1)</script>' }], questions: [], frames: [], schemes: [], priorities: [], guard: { notes: [] } };
  round.dialogue.Q1 = { kind: 'question', closed: true, takeaway: 'Evidence must be checkable.', turns: [{ from: 'learner', text: 'Numbers.' }, { from: 'coach', text: 'Which numbers?', move: 'probe', insight: '' }] };
  round.decisions.R1 = { decision: 'adapt', reason: 'Partly.' };
  round.revised = 'A revised text.';
  state.rounds = [round];
  state.events = [{ t: '2026-10-02T10:00:00Z', type: 'paste', round: 1, detail: 'draft 230 chars' }, { t: '2026-10-02T10:25:00Z', type: 'export', round: 1, detail: 'json' }];
  return state;
}

test('records carry a checksum that detects edits', async () => {
  const record = await buildRecord(sampleState(), { service: { provider: 'Mock' } });
  assert.match(record.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.equal(await verifyRecord(record), true);
  assert.equal(await verifyRecord({ ...record, learnerCode: 'S08' }), false);
  assert.equal(await verifyRecord(JSON.parse(JSON.stringify(record))), true, 'a JSON round trip keeps the checksum valid');
  assert.match(fileName(record, 'json'), /^ArguMentor_should-employers-be-allowed-[a-z-]+_s07_\d{8}\.json$/);
});

test('the pure-JS SHA-256 fallback matches Node crypto', () => {
  for (const text of ['', 'abc', 'é'.repeat(70), stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })]) assert.equal(sha256Fallback(text), createHash('sha256').update(text).digest('hex'));
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('the HTML report escapes learner and model text', async () => {
  const record = await buildRecord(sampleState());
  const page = reportHTML(record, 'en');
  assert.ok(!page.includes('<script>alert(1)</script>'));
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(page.includes('Self-reported record'));
});

test('record statistics summarise dialogue, decisions and pastes', async () => {
  const stats = recordStats(await buildRecord(sampleState()));
  assert.equal(stats.replies, 1);
  assert.equal(stats.decisions.adapt, 1);
  assert.equal(stats.pastes, 1);
  assert.equal(stats.pastedChars, 230);
  assert.equal(stats.minutes, 25);
  assert.equal(stats.insights[0].insight, 'Evidence must be checkable.');
});

test('html templates escape by default', () => {
  const value = '<b>"x"</b>';
  assert.equal(String(html`<p>${value}</p>`), '<p>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</p>');
  assert.equal(String(html`<p>${raw('<i>ok</i>')}${[html`<a>${'&'}</a>`]}</p>`), '<p><i>ok</i><a>&amp;</a></p>');
  assert.equal(esc(null), '');
});

test('word diff marks additions and deletions', () => {
  const parts = wordDiff('Employers should never monitor workers.', 'Employers should rarely monitor workers.');
  assert.deepEqual(diffStats(parts), { same: 4, add: 1, del: 1 });
  assert.ok(parts.some(part => part.type === 'add' && part.text.includes('rarely')));
});
