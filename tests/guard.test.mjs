import test from 'node:test';
import assert from 'node:assert/strict';
import { guardRole, guardDialogue, guardCheck, salvage, parseModelContent, looksLikeRefusal, citationIssue, rewriteIssue, questionFormIssue } from '../guard.mjs';
import { learnerFields, normalizeForMatch, ngrams } from '../core.mjs';
import { input } from './helpers.mjs';

function ctx(extra = {}) {
  const data = input();
  const fields = learnerFields(data);
  const rawLearner = fields.map(field => field.text).join('\n');
  return { input: data, fields, rawLearner, learnerNorm: normalizeForMatch(rawLearner), learnerGrams: ngrams(rawLearner, 4), ...extra };
}

test('model content parsing tolerates code fences and detects refusals', () => {
  assert.deepEqual(parseModelContent('```json\n{"focus":"x"}\n```').value, { focus: 'x' });
  assert.equal(parseModelContent('').empty, true);
  assert.ok(looksLikeRefusal("Sorry, I can't help with that topic."));
  assert.ok(looksLikeRefusal('抱歉，我无法回答这个问题。'));
  assert.ok(!looksLikeRefusal('{"focus":"Your evidence needs checking."}'));
});

test('anchors are verified against the learner text and replaced by the exact learner span', () => {
  const { result, hard, notes } = guardRole('analyst', {
    focus: 'Give Reason 1 a warrant.',
    observations: [
      { criterion: 'warrant', target: 'reason 1', anchor: 'constant monitoring makes workers feel stressed', text: 'The warrant is missing, so a manager cannot see why stress matters.' },
      { criterion: 'evidence', target: 'Reason 1', anchor: 'workers are always unhappy at work', text: 'Personal evidence is presented as general fact.' }
    ]
  }, ctx());
  assert.deepEqual(hard, []);
  assert.equal(result.items[0].anchor, 'Constant monitoring makes workers feel stressed');
  assert.equal(result.items[0].anchorField, 'arguments.0.reason');
  assert.equal(result.items[0].target, 'Reason 1');
  assert.equal(result.items[1].anchor, '');
  assert.ok(notes.includes('ANCHOR_UNVERIFIED:A2'));
});

test('invented sources, years, percentages and statistics are hard problems unless the learner wrote them', () => {
  const c = ctx();
  assert.ok(citationIssue('See https://example.org/report for data.', c));
  assert.ok(citationIssue('Smith (2021) found that monitoring lowers trust.', c));
  assert.ok(citationIssue('A survey shows 64% of workers dislike tracking.', c));
  assert.ok(citationIssue('In 2023, regulators acted.', c));
  assert.ok(citationIssue('Over 3,000 employees were surveyed.', c));
  assert.ok(!citationIssue('Your source S1 needs a clearer link to Reason 2.', c));
  const own = ctx();
  own.learnerNorm += ' 64% of workers';
  assert.ok(!citationIssue('You mention 64% of workers.', own));
});

test('ghost-writing is detected: phrases, long quoted replacements, and near-copies of learner sentences', () => {
  const c = ctx();
  assert.ok(rewriteIssue('Here is a revised version: Employers should limit monitoring.', c));
  assert.ok(rewriteIssue('You could write: "Employers should only use monitoring tools when workers agree to clear limits on data."', c));
  assert.ok(!rewriteIssue('You wrote "Constant monitoring makes workers feel stressed and distrusted" without a warrant.', c));
  assert.ok(rewriteIssue('Nowadays many companies use AI to monitor employees, and I think this is totally wrong in most cases.', c));
  assert.ok(!rewriteIssue('Your claim is broader than the evidence you give for it.', c));
});

test('non-English output is a hard problem unless it echoes the learner', () => {
  const { hard } = guardRole('analyst', { focus: '你的理由需要证据。', observations: [{ criterion: 'evidence', anchor: '', text: 'Add checkable evidence.' }] }, ctx());
  assert.ok(hard.includes('NON_ENGLISH:focus'));
});

test('Socratic questions must be open, single and non-leading', () => {
  assert.ok(questionFormIssue("Don't you think monitoring is harmful?", 'evidence'));
  assert.ok(questionFormIssue('What is your evidence? And who collected it?', 'evidence'));
  assert.ok(questionFormIssue('Why don\'t you add a statistic?', 'evidence'));
  assert.ok(!questionFormIssue('What would a manager need to see before accepting this reason?', 'evidence'));
  const { hard, notes } = guardRole('socratic', { focus: 'Test your reasons.', questions: [
    { type: 'evidence', target: 'Reason 1', anchor: 'tracking app makes everyone nervous', text: "Isn't one cousin's view too narrow?" },
    { type: 'assumption', target: 'Reason 2', anchor: 'AI systems can misjudge normal behaviour', text: 'Can the system be wrong?' }
  ] }, ctx());
  assert.ok(hard.includes('QUESTION_FORM:Q1'));
  assert.ok(notes.includes('CLOSED_QUESTION:Q2'));
});

test('sentence frames are normalised; long frames and frames copying the learner are removed', () => {
  const { result, notes } = guardRole('language', {
    focus: 'Match stance to evidence.',
    observations: [{ criterion: 'stance', target: 'Draft', anchor: 'I think this is totally wrong', text: 'The booster "totally" claims more than your evidence shows.' }],
    frames: [
      { move: 'limit a claim', text: 'In most cases, ... although ___' },
      { move: 'copy', text: 'AI systems can misjudge normal behaviour as …' },
      'This frame has far too many fixed words to be a short reusable frame for learners to adapt …'
    ]
  }, ctx());
  assert.deepEqual(result.frames, [{ move: 'limit a claim', text: 'In most cases, … although …' }]);
  assert.equal(notes.filter(note => note === 'FRAME_REMOVED').length, 2);
});

test('coordinator references are filtered to known ids', () => {
  const { result, notes } = guardRole('coordinator', { focus: 'Two priorities.', priorities: [{ target: 'Reason 1', type: 'argument', basedOn: ['A1', 'Z9'], text: 'Explain why stress matters to managers.', successCheck: 'Can a manager see the link?' }] }, ctx({ knownIds: ['A1', 'Q1'] }));
  assert.deepEqual(result.priorities[0].basedOn, ['A1']);
  assert.ok(notes.includes('BASEDON_INVALID:R1'));
});

test('salvage removes only offending items and keeps a usable role', () => {
  const outcome = guardRole('analyst', { focus: 'Two issues.', observations: [
    { criterion: 'warrant', anchor: 'Constant monitoring makes workers feel stressed', text: 'The warrant is missing.' },
    { criterion: 'evidence', anchor: '', text: 'Smith (2020) shows monitoring works.' }
  ] }, ctx());
  assert.ok(outcome.hard.includes('CITATION:A2'));
  const rescued = salvage('analyst', outcome);
  assert.equal(rescued.result.items.length, 1);
  assert.ok(rescued.notes.includes('ITEM_REMOVED:A2'));
});

test('dialogue guard forces a close on the final turn and verifies insights', () => {
  const replyFields = [{ path: 'reply.0', text: 'Maybe the problem is how long the data is stored, not the monitoring itself.' }];
  const c = ctx({ replyFields, finalTurn: true, kind: 'question' });
  const { result, notes } = guardDialogue({ move: 'probe', reply: 'You noticed that storage time matters.', insight: 'the problem is how long the data is stored' }, c);
  assert.equal(result.move, 'close');
  assert.equal(result.insight, 'the problem is how long the data is stored');
  assert.ok(notes.includes('MOVE_FORCED_CLOSE'));
  const bad = guardDialogue({ move: 'clarify', reply: 'What do you mean? And why?', insight: 'invented words never written' }, ctx({ replyFields, kind: 'question' }));
  assert.equal(bad.result.move, 'probe');
  assert.ok(bad.hard.includes('QUESTION_FORM:reply'));
});

test('revision-check guard respects declined priorities and anchors only to the revised text', () => {
  const revised = 'Employers should limit AI monitoring to safety tasks, because constant tracking lowers trust.';
  const c = ctx({ revisedFields: [{ path: 'revised', text: revised }], priorityIds: ['R1', 'R2'], declined: ['R2'] });
  const { result, notes } = guardCheck({ focus: 'The claim is now limited.', checks: [
    { priorityId: 'R1', status: 'visible', anchor: 'limit AI monitoring to safety tasks', note: 'The claim now has a scope.' },
    { priorityId: 'R2', status: 'partly', anchor: 'Constant monitoring makes workers feel stressed', note: 'Still missing.' }
  ], question: 'Which other claim could you limit in the same way?' }, c);
  assert.equal(result.checks[0].anchor, 'limit AI monitoring to safety tasks');
  assert.equal(result.checks[1].status, 'declined');
  assert.equal(result.checks[1].anchor, '');
  assert.deepEqual(notes, []);
});

test('dialogue summaries may restate the learner\'s own reply; unquoted "your claim could be:" is still blocked', () => {
  const reply = 'Monitoring that warns workers about danger is acceptable, but AI that scores how hard each person works should not be used to judge people.';
  const c = ctx({ replyFields: [{ path: 'reply.0', text: reply }], finalTurn: true, kind: 'question', paraphraseCheck: false });
  c.fields = [...c.fields, ...c.replyFields];
  c.rawLearner += `\n${reply}`;
  c.learnerNorm = normalizeForMatch(c.rawLearner);
  c.learnerGrams = ngrams(c.rawLearner, 4);
  const ok = guardDialogue({ move: 'close', reply: 'You drew your line: monitoring that warns workers about danger is acceptable, but AI that scores how hard each person works should not be used to judge people. Carry this into your claim.', insight: 'Monitoring that warns workers about danger is acceptable' }, c);
  assert.deepEqual(ok.hard, []);
  const blocked = guardDialogue({ move: 'close', reply: 'Your claim could be: employers may use safety alerts but not productivity scores.', insight: '' }, c);
  assert.ok(blocked.hard.includes('REWRITE:reply'));
});
