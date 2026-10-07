// engine.mjs — runs the coaching pipeline inside the browser, for the static (serverless) build.
// It is loaded only when no local server and no hosted proxy is reachable, and it uses the offline
// template provider, so it needs no API key and makes no network request of any kind.
//
// It deliberately reuses the same orchestrator, the same prompts and the same integrity guard as the
// local server, and repeats server.mjs's request validation, so behaviour and error codes match. What it
// cannot do is real AI feedback: for that a visitor runs the app locally (npm start) with their own key.
import { CONSENT_VERSION, MAX_LEARNER_TURNS, QUESTION_TYPES, DECISIONS, InputError, isObject, str, integer, dropIfPII, validateInput, validateTask, validateLearnerText, validateSelfAssessment, validatePriorRounds, englishIssue } from './core.mjs';
import { runReview, runDialogueTurn, runRevisionCheck } from './orchestrator.mjs';
import { PROMPT_VERSION } from './prompts.mjs';
import { createMockProvider } from './mock.mjs';
import { APP_VERSION } from './core.mjs';

const provider = createMockProvider();
const callModel = request => provider.complete(request);
const runId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `offline-${Date.now()}`);

const fail = (code, field = '', detail = '') => { throw Object.assign(new Error(code), { field, detail }); };

function checkConsent(body) {
  if (!isObject(body)) fail('INVALID_INPUT');
  if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) fail('CONSENT_REQUIRED');
}

// The same shape the real server reports, so the interface renders identically.
export async function status() {
  return {
    configured: true, provider: 'Offline template', live: false, model: 'offline-template',
    mode: 'multi', remainingCalls: Infinity, remainingTokens: Infinity, active: 0, queued: 0,
    appVersion: APP_VERSION, promptVersion: PROMPT_VERSION, consentVersion: CONSENT_VERSION,
    accessCodeRequired: false, maxLearnerTurns: MAX_LEARNER_TURNS, keyInProjectFolder: false, offline: true
  };
}

export async function verify() {
  return { ok: true, models: ['offline-template'], modelAvailable: true };
}

export async function review(body, { signal, onEvent }) {
  checkConsent(body);
  const input = validateInput(body.input);
  const task = body.task ? validateTask(body.task) : null;
  const self = validateSelfAssessment(body.self, input);
  const priorRounds = validatePriorRounds(body.priorRounds);
  const goal = dropIfPII(body.learnerGoal, 300);
  const id = runId();
  onEvent({ type: 'begin', runId: id, provider: 'Offline template', model: 'offline-template', live: false, mode: 'multi', promptVersion: PROMPT_VERSION, appVersion: APP_VERSION });
  const outcome = await runReview({
    input, task, mode: 'multi', round: integer(body.round, 1, 1, 99), selfAssessment: self, priorRounds,
    learnerGoal: goal && !englishIssue(goal) ? goal : '', framesRequested: body.framesRequested === true,
    callModel, emit: onEvent
  });
  if (signal?.aborted) throw new Error('CANCELLED');
  onEvent({ type: 'done', complete: outcome.complete, errors: outcome.errors, meta: { ...outcome.meta, runId: id, provider: 'Offline template', model: 'offline-template', live: false, appVersion: APP_VERSION, at: new Date().toISOString() } });
}

export async function dialogue(body) {
  checkConsent(body);
  const input = validateInput(body.input);
  const raw = body.question;
  if (!isObject(raw)) fail('INVALID_REQUEST', 'question');
  const kind = raw.kind === 'feedback' ? 'feedback' : 'question';
  const id = str(raw.id, 8);
  const text = str(raw.text, 600);
  if (!(kind === 'question' ? /^Q[1-3]$/ : /^(A[1-3]|L[1-2]|R[1-2])$/).test(id) || !text) fail('INVALID_REQUEST', 'question');
  const question = { id, kind, type: kind === 'feedback' ? 'feedback' : (QUESTION_TYPES[raw.type] ? raw.type : 'other'), target: str(raw.target, 40), text };

  const list = body.thread;
  if (!Array.isArray(list) || list.length < 1 || list.length > 2 * MAX_LEARNER_TURNS - 1) fail('THREAD_LIMIT', 'thread');
  const thread = list.map((turn, index) => {
    const from = index % 2 === 0 ? 'learner' : 'coach';
    if (!isObject(turn) || turn.from !== from) fail('INVALID_REQUEST', 'thread');
    const value = from === 'learner' ? validateLearnerText(turn.text, 'reply', { minWords: 2 }) : str(turn.text, 800);
    if (!value) fail('INVALID_REQUEST', 'thread');
    return { from, text: value };
  });
  if (thread.at(-1).from !== 'learner') fail('INVALID_REQUEST', 'thread');

  const turn = await runDialogueTurn({ input, task: body.task ? validateTask(body.task) : null, question, thread, callModel });
  return { ...turn, meta: { ...turn.meta, runId: runId(), provider: 'Offline template', model: 'offline-template', live: false, appVersion: APP_VERSION, at: new Date().toISOString() } };
}

export async function revisionCheck(body) {
  checkConsent(body);
  const input = validateInput(body.input);
  const task = body.task ? validateTask(body.task) : null;
  const list = body.priorities;
  if (!Array.isArray(list) || list.length < 1 || list.length > 3) fail('INVALID_REQUEST', 'priorities');
  const priorities = list.map(item => {
    const id = str(item?.id, 8);
    const text = str(item?.text, 600);
    if (!/^[RA][1-3]$/.test(id) || !text) fail('INVALID_REQUEST', 'priorities');
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
  return { ...check, meta: { ...check.meta, runId: runId(), provider: 'Offline template', model: 'offline-template', live: false, appVersion: APP_VERSION, at: new Date().toISOString() } };
}

export { InputError };
