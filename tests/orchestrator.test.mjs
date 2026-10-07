import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, runDialogueTurn, runRevisionCheck } from '../orchestrator.mjs';
import { createMockProvider } from '../mock.mjs';
import { validateSelfAssessment } from '../core.mjs';
import { input, SOURCES } from './helpers.mjs';

const mock = createMockProvider();
const roleOf = messages => (/ROLE: Argument analyst/.test(messages[0].content) && !/Single-pass/.test(messages[0].content) ? 'analyst' : /ROLE: Socratic questioner/.test(messages[0].content) && !/Single-pass/.test(messages[0].content) ? 'socratic' : /ROLE: Language coach/.test(messages[0].content) && !/Single-pass/.test(messages[0].content) ? 'language' : /ROLE: Revision coordinator/.test(messages[0].content) && !/Single-pass/.test(messages[0].content) ? 'coordinator' : /You repair/.test(messages[0].content) ? 'repair' : 'other');

// Wraps the mock so individual roles can be made to misbehave.
function scripted(overrides) {
  const calls = [];
  const callModel = async args => {
    const role = roleOf(args.messages);
    calls.push({ role, attempt: args.attempt });
    const override = overrides[role];
    if (override) {
      const value = typeof override === 'function' ? override(calls.filter(call => call.role === role).length, args) : override;
      if (value instanceof Error) throw value;
      if (value !== undefined) return { content: typeof value === 'string' ? value : JSON.stringify(value), finishReason: 'stop', servedModel: 'stub', usage: { total: 10 }, ms: 1 };
    }
    return mock.complete(args);
  };
  return { callModel, calls };
}

test('the multi-agent review returns four guarded roles with stable ids and provenance', async () => {
  const { callModel, calls } = scripted({});
  const self = validateSelfAssessment({ element: 'arguments.0.warrant', reason: 'My warrant for reason one is empty.' }, input());
  const out = await runReview({ input: input(), task: { sources: SOURCES }, selfAssessment: self, callModel });
  assert.equal(out.complete, true);
  assert.deepEqual(Object.keys(out.results).sort(), ['analyst', 'coordinator', 'language', 'socratic']);
  assert.equal(calls.length, 4);
  assert.match(out.results.analyst.items[0].id, /^A\d$/);
  assert.match(out.results.socratic.questions[0].id, /^Q\d$/);
  assert.ok(out.results.coordinator.priorities[0].basedOn.every(id => /^[AQ]\d$/.test(id)));
  assert.match(out.meta.promptVersion, /^[0-9a-f]{12}$/);
});

test('a hard violation triggers one repair that sees the learner text', async () => {
  const bad = { focus: 'Fix Reason 1.', observations: [{ criterion: 'evidence', target: 'Reason 1', anchor: 'Constant monitoring makes workers feel stressed', text: 'According to Smith (2021), 70% of workers feel stressed.' }] };
  const good = { focus: 'Fix Reason 1.', observations: [{ criterion: 'evidence', target: 'Reason 1', anchor: 'Constant monitoring makes workers feel stressed', text: 'This reason rests on one personal story.' }] };
  let repairPayload = null;
  const { callModel, calls } = scripted({ analyst: bad, repair: (n, args) => { repairPayload = JSON.parse(args.messages[1].content); return good; } });
  const events = [];
  const out = await runReview({ input: input(), callModel, emit: event => events.push(event) });
  assert.equal(out.results.analyst.guard.repaired, true);
  assert.equal(out.results.analyst.items[0].text, 'This reason rests on one personal story.');
  assert.ok(events.some(event => event.type === 'repair' && event.problems.includes('CITATION')));
  assert.match(repairPayload.learnerText, /Constant monitoring/);
  assert.equal(calls.filter(call => call.role === 'repair').length, 1);
});

test('if the repair also fails, only the offending item is removed', async () => {
  const mixed = { focus: 'Two issues.', observations: [
    { criterion: 'warrant', target: 'Reason 1', anchor: 'Constant monitoring makes workers feel stressed', text: 'The warrant is missing.' },
    { criterion: 'evidence', target: 'Reason 2', anchor: '', text: 'See www.example.org for statistics.' }
  ] };
  const { callModel } = scripted({ analyst: mixed, repair: mixed });
  const out = await runReview({ input: input(), callModel });
  assert.equal(out.results.analyst.items.length, 1);
  assert.ok(out.results.analyst.guard.notes.includes('ITEM_REMOVED:A2'));
});

test('empty replies are regenerated, never repaired into invented feedback', async () => {
  const { callModel, calls } = scripted({ analyst: n => (n === 1 ? '' : undefined) });
  const out = await runReview({ input: input(), callModel });
  assert.equal(out.results.analyst.guard.regenerated, true);
  assert.equal(calls.filter(call => call.role === 'repair').length, 0);
  assert.equal(calls.filter(call => call.role === 'analyst').length, 2);
});

test('a refusal fails closed with MODEL_DECLINED', async () => {
  const { callModel } = scripted({ analyst: "I'm sorry, I can't help with that." });
  await assert.rejects(runReview({ input: input(), callModel }), /MODEL_DECLINED/);
});

test('an optional role failure degrades the round instead of failing it', async () => {
  const { callModel } = scripted({ language: 'not json', repair: n => ({ empty: true }) });
  const out = await runReview({ input: input(), callModel });
  assert.equal(out.complete, false);
  assert.equal(out.errors.language, 'INVALID_MODEL_OUTPUT');
  assert.ok(out.results.coordinator);
  assert.ok(out.results.socratic);
});

test('a coordinator failure falls back to deterministic priorities from the analyst', async () => {
  const { callModel } = scripted({ coordinator: 'nonsense', repair: { empty: true } });
  const out = await runReview({ input: input(), callModel });
  assert.equal(out.errors.coordinator, 'INVALID_MODEL_OUTPUT');
  assert.equal(out.results.coordinator.priorities[0].fallback, true);
  assert.ok(out.results.coordinator.guard.notes.includes('COORDINATOR_FALLBACK'));
});

test('fatal provider errors stop the whole review', async () => {
  const { callModel } = scripted({ socratic: new Error('KEY_REJECTED') });
  await assert.rejects(runReview({ input: input(), callModel }), /KEY_REJECTED/);
});

test('research ablation modes run through the same guard', async () => {
  const single = await runReview({ input: input(), callModel: args => mock.complete(args), mode: 'single' });
  assert.equal(single.meta.calls, 1);
  assert.ok(single.results.coordinator.priorities.length);
  const nocoord = await runReview({ input: input(), callModel: args => mock.complete(args), mode: 'multi-nocoord' });
  assert.equal(nocoord.meta.calls, 3);
  assert.ok(nocoord.results.coordinator.guard.notes.includes('DETERMINISTIC_ASSEMBLY'));
});

test('later rounds receive prior rounds, fade frames and ask a self-question', async () => {
  const payloads = {};
  const callModel = async args => { payloads[roleOf(args.messages)] = JSON.parse(args.messages[1].content); return mock.complete(args); };
  const priorRounds = [{ round: 1, priorities: [{ id: 'R1', target: 'Reason 1', text: 'Add a warrant.', decision: 'reject', reason: 'I prefer my wording.', status: 'declined' }], insights: [], questionsAsked: ['What would a manager need to see?'] }];
  await runReview({ input: input(), callModel, round: 3, priorRounds });
  assert.equal(payloads.language.framesWanted, false);
  assert.equal(payloads.socratic.selfQuestion, true);
  assert.equal(payloads.analyst.priorRounds[0].priorities[0].status, 'declined');
  assert.equal(payloads.analyst.learnerData.level, undefined, 'the analyst is level-blind');
});

test('dialogue turns close at the turn limit and clarifications use the clarify move', async () => {
  const question = { id: 'Q1', kind: 'question', type: 'evidence', target: 'Reason 1', text: 'What would a manager need to see?' };
  const thread = [
    { from: 'learner', text: 'They would need numbers about stress levels.' }, { from: 'coach', text: 'Where could such numbers come from?' },
    { from: 'learner', text: 'Maybe from an anonymous staff survey.' }, { from: 'coach', text: 'What would make that survey fair?' },
    { from: 'learner', text: 'If workers could answer without their names.' }
  ];
  const turn = await runDialogueTurn({ input: input(), question, thread, callModel: args => mock.complete(args) });
  assert.equal(turn.move, 'close');
  assert.equal(turn.final, true);
  const clarify = await runDialogueTurn({ input: input(), question: { id: 'A1', kind: 'feedback', type: 'feedback', target: 'Reason 1', text: 'The warrant is missing.' }, thread: [{ from: 'learner', text: 'What is a warrant here?' }], callModel: args => mock.complete(args) });
  assert.equal(clarify.move, 'clarify');
});

test('the revision check marks declined priorities as declined', async () => {
  const priorities = [{ id: 'R1', target: 'Reason 1', text: 'Add a warrant.' }, { id: 'R2', target: 'Claim', text: 'Limit the claim.' }];
  const out = await runRevisionCheck({ input: input(), priorities, decisions: { R2: { decision: 'reject', reason: 'I want a strong claim.' } }, insights: [], revised: 'Employers should not use constant AI monitoring, because stress lowers trust and performance in most teams I have read about.', callModel: args => mock.complete(args) });
  assert.equal(out.result.checks.find(item => item.priorityId === 'R2').status, 'declined');
});
