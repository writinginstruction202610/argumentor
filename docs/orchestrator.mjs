// orchestrator.mjs — the coaching pipelines.
//   runReview:        analyst → (socratic ∥ language) → coordinator, each passing through the integrity guard
//   runDialogueTurn:  one Socratic dialogue move (or a clarification of a feedback item)
//   runRevisionCheck: describes which revision priorities are visible in the learner's revised text
// callModel is injected (DeepSeek in production, mock or stubs in tests), so every pipeline is testable.
// Review modes: "multi" (default), "multi-nocoord" (deterministic priorities; ablation) and "single" (one call; ablation).
import { ROLES, SCHEMES, MAX_LEARNER_TURNS, learnerFields, checkSourceQuotes, normalizeForMatch, ngrams, mapSummary, languageSignals } from './core.mjs';
import { reviewMessages, singleMessages, dialogueMessages, checkMessages, repairMessages, PROMPT_VERSION } from './prompts.mjs';
import { parseModelContent, looksLikeRefusal, guardRole, guardDialogue, guardCheck, salvage, finalizeRole, finalizeCheck, fallbackPriorities } from './guard.mjs';

export class ReviewError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReviewError';
  }
}

export const REVIEW_MODES = ['multi', 'multi-nocoord', 'single'];
export const PARAMS = { review: { temperature: 0.3, maxTokens: 1800 }, single: { temperature: 0.3, maxTokens: 4500 }, dialogue: { temperature: 0.5, maxTokens: 700 }, check: { temperature: 0.2, maxTokens: 1200 }, repair: { temperature: 0.1 } };

// Errors that make every later call fail too; anything else only removes the affected role.
const FATAL = new Set(['KEY_REJECTED', 'NO_BALANCE', 'MODEL_NOT_FOUND', 'PROVIDER_LIMIT', 'PROVIDER_ERROR', 'PROVIDER_REJECTED_REQUEST', 'BUDGET_LIMIT', 'TIMEOUT', 'CANCELLED', 'CONNECTION_ERROR', 'NOT_CONFIGURED']);
export const isFatal = error => FATAL.has(error?.message) || error?.name === 'AbortError' || error?.name === 'TimeoutError';

// Optional diagnostic, enabled with ARGUMENTOR_DEBUG_GUARD=1. It logs problem CODES only, never learner or
// model text. `process` is absent in a browser and in a Worker, so it is looked up defensively.
const debugGuard = () => { try { return Boolean(globalThis.process?.env?.ARGUMENTOR_DEBUG_GUARD); } catch { return false; } };

function baseContext(input, task, extraFields = []) {
  const fields = [...learnerFields(input), ...extraFields];
  const rawLearner = fields.map(field => field.text).join('\n');
  const sources = task?.sources || [];
  return {
    input, task, sources, fields, rawLearner,
    sourceChecks: checkSourceQuotes(input, sources),
    learnerNorm: normalizeForMatch(rawLearner),
    learnerGrams: ngrams(rawLearner, 4)
  };
}

function tally(usage) {
  return {
    calls: usage.length,
    repairs: usage.filter(item => item.attempt === 'repair').length,
    regenerations: usage.filter(item => item.attempt === 'regenerate').length,
    tokens: usage.reduce((sum, item) => sum + (item.usage?.total || 0), 0),
    ms: usage.reduce((sum, item) => sum + (item.ms || 0), 0),
    servedModel: usage.map(item => item.servedModel).filter(Boolean).at(-1) || ''
  };
}

// One model call plus guard. Empty or truncated replies are regenerated once (never "repaired" into invented
// feedback); replies with hard problems get one repair that sees the learner's text; a second failure keeps
// only the items that are safe.
async function callAndGuard({ kind, label, messages, ctx, guard, callModel, params, emit }) {
  const usage = [];
  const attempt = async (msgs, temperature, maxTokens, type) => {
    const response = await callModel({ role: label, messages: msgs, temperature, maxTokens, attempt: type });
    usage.push({ ...response, attempt: type });
    const parsed = parseModelContent(response.content);
    if (!parsed.ok && looksLikeRefusal(response.content)) throw new ReviewError('MODEL_DECLINED');
    const outcome = parsed.ok ? guard(parsed.value) : { result: null, hard: ['FORMAT'], notes: [] };
    if (response.finishReason === 'length') outcome.hard.push('TRUNCATED');
    return { response, parsed, outcome };
  };
  let { response, parsed, outcome } = await attempt(messages, params.temperature, params.maxTokens, 'primary');
  if (debugGuard() && outcome.hard.length) console.log(`[guard] ${label}: ${outcome.hard.join(', ')}`); // problem codes only, never text
  let regenerated = false;
  let repaired = false;
  if (parsed.empty || response.finishReason === 'length') {
    emit?.({ type: 'regenerate', role: label });
    regenerated = true;
    ({ response, parsed, outcome } = await attempt(messages, params.temperature, Math.round(params.maxTokens * 1.5), 'regenerate'));
  }
  if (outcome.hard.length) {
    emit?.({ type: 'repair', role: label, problems: [...new Set(outcome.hard.map(code => code.split(/[:@]/)[0]))] });
    repaired = true;
    const candidate = parsed.ok ? parsed.value : parsed.raw;
    ({ outcome } = await attempt(repairMessages(kind, candidate, outcome.hard, { learnerText: ctx.rawLearner }), PARAMS.repair.temperature, params.maxTokens, 'repair'));
    if (debugGuard() && outcome.hard.length) console.log(`[guard] ${label} after repair: ${outcome.hard.join(', ')}`);
    if (outcome.hard.length) {
      const rescued = salvage(kind, outcome);
      if (!rescued) throw new ReviewError('INVALID_MODEL_OUTPUT');
      outcome = rescued;
    }
  }
  return { result: outcome.result, notes: outcome.notes, repaired, regenerated, usage };
}

const brief = result => ({
  focus: result.focus,
  checks: result.checks || undefined,
  schemes: result.schemes?.length ? result.schemes : undefined,
  observations: result.items.map(({ id, criterion, target, anchor, text }) => ({ id, criterion, target, anchor, text })),
  questions: result.questions.map(({ id, type, target, text }) => ({ id, type, target, text })),
  frames: result.frames?.length ? result.frames : undefined
});

function schemeQuestions(analyst) {
  return (analyst?.schemes || []).map(item => ({ target: item.target, scheme: item.scheme, criticalQuestions: SCHEMES[item.scheme]?.cq || SCHEMES.other.cq }));
}

function knownIds(results) {
  return ['analyst', 'socratic', 'language'].flatMap(role => [...(results[role]?.items || []), ...(results[role]?.questions || [])].map(item => item.id));
}

export async function runReview({ input, task = null, mode = 'multi', round = 1, selfAssessment = null, priorRounds = [], learnerGoal = '', framesRequested = false, callModel, emit = () => {} }) {
  const ctx = {
    ...baseContext(input, task),
    mapSummary: mapSummary(input),
    languageSignals: languageSignals(input),
    selfAssessment, priorRounds, learnerGoal, round,
    framesWanted: round <= 1 || input.level === 'B1' || Boolean(framesRequested),
    selfQuestion: round >= 3
  };
  const results = {};
  const errors = {};
  const allUsage = [];
  const started = Date.now();

  const runRole = async (role, extra = {}) => {
    emit({ type: 'start', role });
    const roleCtx = { ...ctx, ...extra };
    const out = await callAndGuard({ kind: role, label: role, ctx: roleCtx, callModel, emit, params: PARAMS.review, messages: reviewMessages(role, roleCtx), guard: value => guardRole(role, value, roleCtx) });
    allUsage.push(...out.usage);
    const meta = tally(out.usage);
    results[role] = finalizeRole(out.result, { guard: { repaired: out.repaired, regenerated: out.regenerated, notes: out.notes }, meta: { servedModel: meta.servedModel, ms: meta.ms, tokens: meta.tokens, calls: meta.calls } });
    emit({ type: 'result', role, result: results[role] });
  };

  // A fatal error still ends the round, but if the analyst already succeeded we assemble deterministic
  // priorities first and emit them, so the learner keeps a usable (partial) round instead of a dead end.
  const fail = (role, error) => {
    if (isFatal(error) || role === 'analyst') {
      if (role !== 'analyst' && results.analyst && !results.coordinator) fallbackCoordinator('COORDINATOR_FALLBACK');
      throw error;
    }
    errors[role] = error.message || 'INVALID_MODEL_OUTPUT';
    emit({ type: 'role-error', role, error: errors[role] });
  };

  const fallbackCoordinator = note => {
    results.coordinator = finalizeRole({ role: 'coordinator', focus: results.analyst.focus, items: [], questions: [], frames: [], schemes: [], checks: null, strength: null, selfAssessment: null, priorities: fallbackPriorities(results.analyst), tension: '', nextStep: results.socratic?.questions?.length ? 'Answer question Q1 in the dialogue panel, then revise in Step 4.' : 'Revise in Step 4.' }, { guard: { repaired: false, regenerated: false, notes: [note] }, meta: { servedModel: '', ms: 0, tokens: 0, calls: 0 } });
    emit({ type: 'result', role: 'coordinator', result: results.coordinator });
  };

  if (mode === 'single') {
    await runSingle({ ctx, results, errors, allUsage, callModel, emit });
  } else {
    try { await runRole('analyst'); } catch (error) { fail('analyst', error); }
    const handoff = { analyst: brief(results.analyst) };
    const settled = await Promise.allSettled([
      runRole('socratic', { handoff, schemeQuestions: schemeQuestions(results.analyst) }),
      runRole('language', { handoff })
    ]);
    settled.forEach((item, index) => {
      if (item.status !== 'rejected') return;
      const error = item.reason;
      // A per-call timeout on one specialist should not end the whole round; the other roles may be fine.
      if (error?.message === 'TIMEOUT') {
        const role = index ? 'language' : 'socratic';
        errors[role] = 'TIMEOUT';
        emit({ type: 'role-error', role, error: 'TIMEOUT' });
        return;
      }
      fail(index ? 'language' : 'socratic', error);
    });
    if (mode === 'multi-nocoord') {
      fallbackCoordinator('DETERMINISTIC_ASSEMBLY');
    } else {
      const coordinatorHandoff = Object.fromEntries(['analyst', 'socratic', 'language'].filter(role => results[role]).map(role => [role, brief(results[role])]));
      try {
        await runRole('coordinator', { handoff: coordinatorHandoff, knownIds: knownIds(results) });
      } catch (error) {
        fail('coordinator', error);
        fallbackCoordinator('COORDINATOR_FALLBACK');
      }
    }
  }

  const totals = tally(allUsage);
  return {
    results,
    errors,
    complete: ROLES.every(role => results[role]) && !Object.keys(errors).length,
    meta: { promptVersion: PROMPT_VERSION, mode, calls: totals.calls, repairs: totals.repairs, regenerations: totals.regenerations, tokens: totals.tokens, ms: Date.now() - started, servedModel: totals.servedModel, params: PARAMS[mode === 'single' ? 'single' : 'review'] }
  };
}

// Research ablation: the same four outputs from one model call, checked by the same guard.
async function runSingle({ ctx, results, errors, allUsage, callModel, emit }) {
  for (const role of ROLES) emit({ type: 'start', role });
  const guardAll = value => {
    if (!value || typeof value !== 'object' || value.empty === true) return { result: null, hard: ['FORMAT'], notes: [] };
    const outcomes = {};
    const hard = [];
    const known = [];
    for (const role of ROLES) {
      const roleCtx = { ...ctx, knownIds: role === 'coordinator' ? known : [] };
      outcomes[role] = guardRole(role, value[role], roleCtx);
      if (role !== 'coordinator' && outcomes[role].result) known.push(...outcomes[role].result.items.map(item => item.id), ...outcomes[role].result.questions.map(item => item.id));
      outcomes[role].hard.forEach(code => hard.push(`${code}@${role}`));
    }
    return { result: outcomes, hard, notes: [] };
  };
  const usage = [];
  const attempt = async (messages, maxTokens, type) => {
    const response = await callModel({ role: 'single', messages, temperature: PARAMS.single.temperature, maxTokens, attempt: type });
    usage.push({ ...response, attempt: type });
    const parsed = parseModelContent(response.content);
    if (!parsed.ok && looksLikeRefusal(response.content)) throw new ReviewError('MODEL_DECLINED');
    const outcome = parsed.ok ? guardAll(parsed.value) : { result: null, hard: ['FORMAT'], notes: [] };
    if (response.finishReason === 'length') outcome.hard.push('TRUNCATED');
    return { response, parsed, outcome };
  };
  let { response, parsed, outcome } = await attempt(singleMessages(ctx), PARAMS.single.maxTokens, 'primary');
  let repaired = false;
  if (parsed.empty || response.finishReason === 'length') ({ response, parsed, outcome } = await attempt(singleMessages(ctx), Math.round(PARAMS.single.maxTokens * 1.4), 'regenerate'));
  if (outcome.hard.length && (!outcome.result || Object.values(outcome.result).some(item => item.hard.length))) {
    repaired = true;
    emit({ type: 'repair', role: 'single', problems: [...new Set(outcome.hard.map(code => code.split(/[:@]/)[0]))] });
    ({ outcome } = await attempt(repairMessages('single', parsed.ok ? parsed.value : parsed.raw, outcome.hard, { learnerText: ctx.rawLearner }), PARAMS.single.maxTokens, 'repair'));
  }
  allUsage.push(...usage);
  if (!outcome.result) throw new ReviewError('INVALID_MODEL_OUTPUT');
  const meta = tally(usage);
  for (const role of ROLES) {
    const roleOutcome = outcome.result[role];
    let safeOutcome = roleOutcome && !roleOutcome.hard.length ? roleOutcome : null;
    if (!safeOutcome && roleOutcome?.result) safeOutcome = salvage(role, roleOutcome);
    if (!safeOutcome) {
      if (role === 'analyst') throw new ReviewError('INVALID_MODEL_OUTPUT');
      errors[role] = 'INVALID_MODEL_OUTPUT';
      emit({ type: 'role-error', role, error: errors[role] });
      continue;
    }
    results[role] = finalizeRole(safeOutcome.result, { guard: { repaired, regenerated: meta.regenerations > 0, notes: safeOutcome.notes }, meta: { servedModel: meta.servedModel, ms: role === 'analyst' ? meta.ms : 0, tokens: role === 'analyst' ? meta.tokens : 0, calls: role === 'analyst' ? meta.calls : 0 } });
    emit({ type: 'result', role, result: results[role] });
  }
  if (!results.coordinator && results.analyst) {
    results.coordinator = finalizeRole({ role: 'coordinator', focus: results.analyst.focus, items: [], questions: [], frames: [], schemes: [], checks: null, strength: null, selfAssessment: null, priorities: fallbackPriorities(results.analyst), tension: '', nextStep: 'Revise in Step 4.' }, { guard: { repaired: false, regenerated: false, notes: ['COORDINATOR_FALLBACK'] }, meta: {} });
    emit({ type: 'result', role: 'coordinator', result: results.coordinator });
  }
}

// ---------- Socratic dialogue (also used to clarify a feedback item) ----------
export async function runDialogueTurn({ input, task = null, question, thread, callModel }) {
  const learnerTurns = thread.filter(turn => turn.from === 'learner');
  const replyFields = learnerTurns.map((turn, index) => ({ path: `reply.${index}`, text: turn.text }));
  const finalTurn = learnerTurns.length >= MAX_LEARNER_TURNS;
  const ctx = { ...baseContext(input, task, replyFields), replyFields, finalTurn, kind: question.kind, paraphraseCheck: false };
  const out = await callAndGuard({
    kind: 'dialogue', label: 'dialogue', ctx, callModel, params: PARAMS.dialogue,
    messages: dialogueMessages({ input, question, thread: thread.map(turn => ({ from: turn.from, text: turn.text })), finalTurn }),
    guard: value => guardDialogue(value, ctx)
  });
  const meta = tally(out.usage);
  return { ...out.result, final: finalTurn || out.result.move === 'close', guard: { repaired: out.repaired, regenerated: out.regenerated, notes: out.notes }, meta: { ...meta, promptVersion: PROMPT_VERSION, params: PARAMS.dialogue } };
}

// ---------- revision check ----------
export async function runRevisionCheck({ input, task = null, priorities, decisions, insights, revised, callModel }) {
  const revisedFields = [{ path: 'revised', text: revised }];
  const declined = priorities.filter(item => decisions[item.id]?.decision === 'reject').map(item => item.id);
  const ctx = { ...baseContext(input, task, revisedFields), revisedFields, priorityIds: priorities.map(item => item.id), declined, paraphraseCheck: false };
  const out = await callAndGuard({
    kind: 'check', label: 'check', ctx, callModel, params: PARAMS.check,
    messages: checkMessages({ input, priorities: priorities.map(({ id, target, text, successCheck }) => ({ id, target, text, successCheck })), decisions, insights, revised }),
    guard: value => guardCheck(value, ctx)
  });
  const meta = tally(out.usage);
  return { result: finalizeCheck(out.result, { guard: { repaired: out.repaired, regenerated: out.regenerated, notes: out.notes } }), meta: { ...meta, promptVersion: PROMPT_VERSION, params: PARAMS.check } };
}
