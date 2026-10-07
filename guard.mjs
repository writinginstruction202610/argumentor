// guard.mjs — the integrity guard. Every model response passes through these checks before a learner sees it.
//   Hard problems (non-English text, invented citations/years/statistics, ghost-written sentences, leading or
//   compound questions, broken format) trigger one repair call; if the repair also fails, only the offending
//   items are removed. Soft problems (unverifiable anchors, invalid references, unsafe frames) are fixed
//   silently and recorded in guard.notes, so violation rates can be measured.
import { CRITERIA, CONTENT_CRITERIA, LANGUAGE_CRITERIA, QUESTION_TYPES, SCHEMES, ROLE_PREFIX, CHECK_STATUS, CHECK_VALUES, MOVES, MAX_ARGUMENTS, MAX_COUNTERS, isObject, str, countWords, findSpan, locateAnchor, normalizeForMatch, ngrams, targetForPath } from './core.mjs';

// ---------- parsing ----------
export function parseModelContent(content) {
  if (typeof content !== 'string' || !content.trim()) return { ok: false, raw: '', empty: true };
  const text = content.trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const attempts = [text, unfenced];
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) attempts.push(unfenced.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt);
      if (isObject(value)) return { ok: true, value };
    } catch { /* try the next form */ }
  }
  return { ok: false, raw: text.slice(0, 12000), empty: false };
}

export function looksLikeRefusal(text) {
  return /\b(sorry|apologi[sz]e|cannot|can't|unable to)\b.{0,40}\b(help|assist|comply|answer|discuss|provide|continue)\b|beyond my (current )?scope|抱歉|无法(回答|提供|协助|讨论)|不能(回答|提供|讨论)/i.test(String(text || '').slice(0, 800));
}

// ---------- text checks ----------
const asText = value => {
  if (typeof value === 'string') return value;
  if (isObject(value) && typeof (value.en ?? value.english ?? value.text) === 'string') return value.en ?? value.english ?? value.text;
  return '';
};
const asList = value => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]);

const CLOSED_WORLD = [
  /\bhttps?:\/\/[^\s"”)]+|\bwww\.[a-z0-9-]+\.[a-z]{2,}[^\s"”)]*/gi,                    // URLs
  /\b10\.\d{4,9}\/[^\s"”)]+|\bdoi:\s*\S+/gi,                                              // DOIs
  /\(\s*[A-Z][A-Za-z'’-]+(?:\s+(?:et al\.|and|&)\s*(?:[A-Z][A-Za-z'’-]+)?)?,?\s+(?:19|20)\d{2}[a-z]?\s*\)/g, // (Smith, 2020)
  /\b[A-Z][A-Za-z'’-]+(?:\s+(?:et al\.|and|&)(?:\s+[A-Z][A-Za-z'’-]+)?)?\s+\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g,   // Smith (2020)
  /\bet al\./g,
  /\b(?:19|20)\d{2}\b/g,                                                                   // years
  /\b\d+(?:\.\d+)?\s?(?:%|per ?cent\b)/gi,                                                 // percentages
  /\b\d[\d,.]*\s*(?:million|billion|thousand|people|persons|workers|employees|staff|students|companies|firms|employers|users|respondents|participants|hours|days|weeks|months)\b/gi
];

const REWRITE_PHRASES = [
  /\b(here is|here's|this is) (a|an|the|your|one) (possible )?(revised|rewritten|improved|better|stronger|clearer|new) (version|sentence|paragraph|claim|thesis|draft|warrant)/i,
  /\b(your|the|a) (new |revised |better )?(claim|thesis|sentence|warrant|response|conclusion) (could|might|should) (be|read|say)\s*[:："“]/i,
  /\b(revised|rewritten|improved) (version|sentence|paragraph|claim|thesis|warrant)\s*[:：]/i,
  /\byou (could|can|might|may|should) (write|say|put|phrase it as|rephrase it as|change it to)\s*[:："“]/i,
  /\b(try|consider) (writing|saying)\s*[:："“]/i,
  /\bfor example,?\s*(write|say)\s*[:："“]/i,
  /\bchange (it|this|the sentence) to\s*[:："“]/i
];
const QUOTED_RE = /["“]([^"“”]{12,600})["”]/g;

const inLearner = (fragment, ctx) => {
  const needle = normalizeForMatch(fragment);
  return Boolean(needle) && ctx.learnerNorm.includes(needle);
};

export function citationIssue(text, ctx) {
  for (const re of CLOSED_WORLD) {
    re.lastIndex = 0;
    for (const match of String(text).matchAll(re)) if (!inLearner(match[0], ctx)) return true;
  }
  return false;
}

function rewrittenSentence(text, ctx) {
  // A long sentence that reproduces most of a learner sentence outside quotation marks is likely a rewrite.
  const unquoted = String(text).replace(/["“][^"”]*["”]/g, ' ');
  for (const sentence of unquoted.split(/(?<=[.!?])\s+/)) {
    if (countWords(sentence) < 14) continue;
    const grams = ngrams(sentence, 4);
    if (!grams.size) continue;
    let shared = 0;
    for (const gram of grams) if (ctx.learnerGrams.has(gram)) shared += 1;
    if (shared / grams.size >= 0.5) return true;
  }
  return false;
}

export function rewriteIssue(text, ctx) {
  if (REWRITE_PHRASES.some(re => re.test(text))) return true;
  for (const match of String(text).matchAll(QUOTED_RE)) {
    const quoted = match[1];
    if (countWords(quoted) < 10) continue;
    if (/…|\.\.\./.test(quoted)) continue; // a frame or an elided quotation, not a pasteable sentence
    if (ctx.fields.some(field => findSpan(quoted, field.text, 3))) continue; // the learner's own words
    return true;
  }
  // Near-copies of the learner's map or draft are checked only in feedback roles. In dialogue and revision
  // checks, restating the learner's own words back is the job (a summary of what they worked out).
  return ctx.paraphraseCheck === false ? false : rewrittenSentence(text, ctx);
}

export function nonEnglishIssue(text, ctx) {
  const runs = String(text).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) || [];
  return runs.some(run => !ctx.rawLearner.includes(run));
}

function textProblems(text, ctx) {
  const problems = [];
  if (nonEnglishIssue(text, ctx)) problems.push('NON_ENGLISH');
  if (citationIssue(text, ctx)) problems.push('CITATION');
  if (rewriteIssue(text, ctx)) problems.push('REWRITE');
  return problems;
}

export function questionFormIssue(text, type) {
  const value = String(text).trim();
  const marks = (value.match(/\?/g) || []).length;
  if (type === 'self-question' && marks <= 1) return false;
  if (marks !== 1) return true;
  if (/^(isn't|aren't|don't|doesn't|wouldn't|shouldn't|couldn't|won't|can't)\b/i.test(value)) return true;
  if (/\b(don't you think|wouldn't you agree|isn't it (true|clear|obvious))\b/i.test(value)) return true;
  if (/^why (don't|not|wouldn't) you\b/i.test(value)) return true;
  return false;
}

export function isClosedQuestion(text) {
  const value = String(text).trim();
  return /^(is|are|was|were|do|does|did|can|could|will|would|should|has|have|had)\b/i.test(value)
    && !/\b(how|why|what|which|in what way|to what extent|who|when|where)\b/i.test(value);
}

// ---------- anchors and targets ----------
const TARGET_RE = /^(Topic|Audience|Claim|Qualifier|Draft|Reason [1-5]|Counterargument [1-3])$/;
function pickTarget(target, anchorField) {
  const value = str(asText(target), 40).replace(/^reason\s*/i, 'Reason ').replace(/^counter[- ]?argument\s*/i, 'Counterargument ');
  const normalized = value.charAt(0).toUpperCase() + value.slice(1);
  return TARGET_RE.test(normalized) ? normalized : targetForPath(anchorField);
}

function trimWords(text, max) {
  const words = String(text).split(/\s+/);
  return words.length > max ? `${words.slice(0, max).join(' ')} …` : text;
}

function verifyAnchor(anchor, fields, notes, id) {
  const value = str(asText(anchor), 600);
  if (!value) { notes.push(`ANCHOR_MISSING:${id}`); return { anchor: '', anchorField: '' }; }
  const hit = locateAnchor(value, fields, 2);
  if (!hit) { notes.push(`ANCHOR_UNVERIFIED:${id}`); return { anchor: '', anchorField: '' }; }
  return { anchor: trimWords(hit.text, 30), anchorField: hit.path };
}

function pickCriterion(value, role) {
  const key = str(asText(value), 30).toLowerCase();
  const allowed = role === 'language' ? LANGUAGE_CRITERIA : CONTENT_CRITERIA;
  if (allowed.includes(key)) return key;
  return CRITERIA[key] ? key : 'other';
}

// ---------- role guard ----------
function buildItems(rawItems, max, role, ctx, notes) {
  const prefix = ROLE_PREFIX[role];
  const items = [];
  asList(rawItems).slice(0, max).forEach((raw, index) => {
    const id = `${prefix}${index + 1}`;
    const item = isObject(raw) ? raw : { text: asText(raw) };
    const text = str(asText(item.text ?? item.observation), 800);
    if (!text) { notes.push(`EMPTY_ITEM:${id}`); return; }
    const anchor = verifyAnchor(item.anchor, ctx.fields, notes, id);
    items.push({ id, criterion: pickCriterion(item.criterion, role), target: pickTarget(item.target, anchor.anchorField), ...anchor, text, problems: textProblems(text, ctx) });
  });
  return items;
}

function buildQuestions(rawQuestions, max, ctx, notes) {
  const questions = [];
  asList(rawQuestions).slice(0, max).forEach((raw, index) => {
    const id = `Q${index + 1}`; // Socratic question ids use Q so they do not clash with source ids S1–S6
    const item = isObject(raw) ? raw : { text: asText(raw) };
    const text = str(asText(item.text ?? item.question), 500);
    if (!text) { notes.push(`EMPTY_ITEM:${id}`); return; }
    const anchor = verifyAnchor(item.anchor, ctx.fields, notes, id);
    const rawType = str(asText(item.type), 30).toLowerCase();
    const type = QUESTION_TYPES[rawType] && rawType !== 'feedback' ? rawType : 'other';
    const problems = textProblems(text, ctx);
    if (questionFormIssue(text, type)) problems.push('QUESTION_FORM');
    if (isClosedQuestion(text)) notes.push(`CLOSED_QUESTION:${id}`);
    questions.push({ id, type, target: pickTarget(item.target, anchor.anchorField), ...anchor, text, problems });
  });
  return questions;
}

function buildChecks(raw, ctx) {
  if (!isObject(raw)) return null;
  const pickValue = (value, key) => {
    const normalized = str(asText(value), 30).toLowerCase();
    return CHECK_VALUES[key].includes(normalized) ? normalized : '';
  };
  const reasonCount = (ctx.input?.arguments || []).length || MAX_ARGUMENTS;
  return {
    claim: isObject(raw.claim) ? { scope: pickValue(raw.claim.scope, 'scope'), answersTopic: pickValue(raw.claim.answersTopic, 'answersTopic') } : { scope: '', answersTopic: '' },
    reasons: asList(raw.reasons).filter(isObject).slice(0, reasonCount).map(item => ({
      target: pickTarget(item.target, ''), evidenceStatus: pickValue(item.evidenceStatus, 'evidenceStatus'),
      evidenceLink: pickValue(item.evidenceLink, 'link'), claimLink: pickValue(item.claimLink, 'link')
    })).filter(item => /^Reason \d$/.test(item.target)),
    counterarguments: asList(raw.counterarguments).filter(isObject).slice(0, MAX_COUNTERS).map(item => ({
      target: pickTarget(item.target, ''), fairness: pickValue(item.fairness, 'fairness'), responseType: pickValue(item.responseType, 'responseType')
    })).filter(item => /^Counterargument \d$/.test(item.target))
  };
}

function buildFrames(rawFrames, ctx, notes) {
  return asList(rawFrames).slice(0, 4).map(raw => {
    const item = isObject(raw) ? raw : { text: asText(raw) };
    const text = str(asText(item.text ?? item.frame), 220).replace(/\.\.\.|\. \. \./g, '…').replace(/_{3,}|\[[^\]]{0,30}\]/g, '…');
    const move = str(asText(item.move), 60);
    const fixed = countWords(text.replace(/…/g, ' '));
    const slots = (text.match(/…/g) || []).length;
    let safe = Boolean(text) && slots >= 1 && slots <= 3 && fixed <= 14 && !nonEnglishIssue(text, ctx) && !citationIssue(text, ctx);
    if (safe) { for (const gram of ngrams(text, 4)) if (ctx.learnerGrams.has(gram)) { safe = false; break; } }
    if (text && !safe) notes.push('FRAME_REMOVED');
    return safe ? { move: textProblems(move, ctx).length ? '' : move, text } : null;
  }).filter(Boolean).slice(0, 3);
}

const MINIMUMS = {
  analyst: result => result.items.length >= 1,
  socratic: result => result.questions.length >= 1,
  language: result => result.items.length >= 1,
  coordinator: result => result.priorities.length >= 1
};

export function guardRole(role, value, ctx) {
  const notes = [];
  if (!isObject(value) || value.empty === true) return { result: null, hard: ['FORMAT'], notes };
  const focus = str(asText(value.focus), 300);
  const result = { role, focus, focusProblems: focus ? textProblems(focus, ctx) : ['MISSING'], items: [], questions: [], frames: [], schemes: [], checks: null, strength: null, selfAssessment: null, priorities: [], tension: '', nextStep: '' };

  if (role === 'analyst') {
    result.items = buildItems(value.observations ?? value.items, 3, role, ctx, notes);
    result.schemes = asList(value.schemes).filter(isObject).slice(0, MAX_ARGUMENTS + MAX_COUNTERS).map(item => {
      const scheme = str(asText(item.scheme), 30).toLowerCase();
      const note = str(asText(item.note), 200);
      return { target: pickTarget(item.target, ''), scheme: SCHEMES[scheme] ? scheme : 'other', note: textProblems(note, ctx).length ? '' : note };
    }).filter(item => item.target);
    result.checks = buildChecks(value.checks, ctx);
    if (!result.checks) notes.push('CHECKS_MISSING');
    if (isObject(value.strength) && str(asText(value.strength.text), 400)) {
      const text = str(asText(value.strength.text), 400);
      const anchor = verifyAnchor(value.strength.anchor, ctx.fields, notes, 'strength');
      if (textProblems(text, ctx).length) notes.push('STRENGTH_REMOVED');
      else result.strength = { target: pickTarget(value.strength.target, anchor.anchorField), ...anchor, text };
    }
    if (ctx.selfAssessment && isObject(value.selfAssessment)) {
      const agreement = str(asText(value.selfAssessment.agreement), 20).toLowerCase();
      const note = str(asText(value.selfAssessment.note), 400);
      if (['agree', 'partly', 'different'].includes(agreement) && !textProblems(note, ctx).length) result.selfAssessment = { agreement, note };
      else notes.push('SELF_RESPONSE_REMOVED');
    }
  }
  if (role === 'socratic') {
    result.questions = buildQuestions(value.questions, 3, ctx, notes);
    if (result.questions.length < 2) notes.push('FEW_QUESTIONS');
  }
  if (role === 'language') {
    result.items = buildItems(value.observations ?? value.items, 2, role, ctx, notes);
    result.frames = buildFrames(value.frames, ctx, notes);
  }
  if (role === 'coordinator') {
    const known = new Set(ctx.knownIds || []);
    result.priorities = asList(value.priorities ?? value.observations).slice(0, 2).map((raw, index) => {
      const item = isObject(raw) ? raw : { text: asText(raw) };
      const id = `R${index + 1}`;
      const text = str(asText(item.text ?? item.priority), 600);
      if (!text) return null;
      const basedOn = asList(item.basedOn).map(ref => str(asText(ref), 8).toUpperCase()).filter(ref => known.has(ref));
      if (asList(item.basedOn).length !== basedOn.length) notes.push(`BASEDON_INVALID:${id}`);
      let successCheck = str(asText(item.successCheck), 300);
      if (successCheck && textProblems(successCheck, ctx).length) { notes.push(`SUCCESS_CHECK_REMOVED:${id}`); successCheck = ''; }
      return { id, target: pickTarget(item.target, ''), type: str(asText(item.type), 20).toLowerCase() === 'language' ? 'language' : 'argument', basedOn, text, successCheck, problems: textProblems(text, ctx) };
    }).filter(Boolean);
    const tension = str(asText(value.tension), 400);
    result.tension = tension && !textProblems(tension, ctx).length ? tension : '';
    const nextStep = str(asText(value.nextStep), 300);
    result.nextStep = nextStep && !textProblems(nextStep, ctx).length ? nextStep : '';
  }

  const hard = [];
  result.focusProblems.forEach(code => hard.push(`${code}:focus`));
  for (const group of ['items', 'questions', 'priorities']) for (const item of result[group]) item.problems.forEach(code => hard.push(`${code}:${item.id}`));
  if (!MINIMUMS[role](result)) hard.push('MISSING:items');
  return { result, hard, notes };
}

// After a failed repair: drop only the offending items and keep the role if what remains is still useful.
export function salvage(kind, outcome) {
  const { result } = outcome;
  if (!result) return null;
  if (kind === 'dialogue') return null;
  if (result.focusProblems?.length) return null;
  const notes = [...outcome.notes];
  if (kind === 'check') {
    result.checks = result.checks.filter(item => { if (item.problems.length) { notes.push(`ITEM_REMOVED:${item.priorityId}`); return false; } return true; });
    if (result.questionProblems?.length) { result.question = ''; notes.push('QUESTION_REMOVED'); }
    return result.checks.length ? { result, hard: [], notes } : null;
  }
  for (const group of ['items', 'questions', 'priorities']) {
    result[group] = result[group].filter(item => {
      if (item.problems.length) { notes.push(`ITEM_REMOVED:${item.id}`); return false; }
      return true;
    });
  }
  return MINIMUMS[kind](result) ? { result, hard: [], notes } : null;
}

export function finalizeRole(result, extra = {}) {
  const strip = list => list.map(({ problems, ...rest }) => rest);
  return {
    role: result.role, focus: result.focus,
    items: strip(result.items), questions: strip(result.questions), frames: result.frames, schemes: result.schemes,
    checks: result.checks, strength: result.strength, selfAssessment: result.selfAssessment,
    priorities: strip(result.priorities), tension: result.tension, nextStep: result.nextStep,
    ...extra
  };
}

// When the coordinator fails, assemble priorities deterministically from the analyst (marked as fallback).
export function fallbackPriorities(analyst) {
  return (analyst?.items || []).slice(0, 2).map((item, index) => ({
    id: `R${index + 1}`, target: item.target, type: 'argument', basedOn: [item.id], fallback: true,
    text: `Work on ${item.target || 'this part'}: ${item.text}`.slice(0, 600), successCheck: ''
  }));
}

// ---------- dialogue guard ----------
export function guardDialogue(value, ctx) {
  const notes = [];
  if (!isObject(value) || value.empty === true) return { result: null, hard: ['FORMAT'], notes };
  let move = str(asText(value.move), 20).toLowerCase();
  if (!MOVES[move]) { notes.push('MOVE_DEFAULTED'); move = ctx.kind === 'feedback' ? 'clarify' : 'probe'; }
  if (move === 'clarify' && ctx.kind !== 'feedback') { notes.push('MOVE_CORRECTED'); move = 'probe'; }
  if (ctx.finalTurn && move !== 'close') { notes.push('MOVE_FORCED_CLOSE'); move = 'close'; }
  const reply = str(asText(value.reply), 700);
  const hard = reply ? textProblems(reply, ctx).map(code => `${code}:reply`) : ['MISSING:reply'];
  if (reply && (reply.match(/\?/g) || []).length > 1) hard.push('QUESTION_FORM:reply');
  let insight = '';
  const rawInsight = str(asText(value.insight), 600);
  if (rawInsight && (move === 'acknowledge' || move === 'close')) {
    const hit = locateAnchor(rawInsight, ctx.replyFields, 3);
    if (hit) insight = trimWords(hit.text, 40);
    else notes.push('INSIGHT_UNVERIFIED');
  }
  if (countWords(reply) > 110) notes.push('LONG_REPLY');
  return { result: { move, reply, insight }, hard, notes };
}

// ---------- revision-check guard ----------
export function guardCheck(value, ctx) {
  const notes = [];
  if (!isObject(value) || value.empty === true) return { result: null, hard: ['FORMAT'], notes };
  const focus = str(asText(value.focus), 300);
  const result = { focus, focusProblems: focus ? textProblems(focus, ctx) : ['MISSING'], checks: [], question: '', questionProblems: [] };
  const seen = new Set();
  for (const raw of asList(value.checks).filter(isObject)) {
    const priorityId = str(asText(raw.priorityId), 8).toUpperCase();
    if (!ctx.priorityIds.includes(priorityId) || seen.has(priorityId)) { notes.push('CHECK_UNKNOWN_PRIORITY'); continue; }
    seen.add(priorityId);
    let status = str(asText(raw.status), 20).toLowerCase();
    if (!CHECK_STATUS[status]) { notes.push(`STATUS_DEFAULTED:${priorityId}`); status = 'not-yet'; }
    if (ctx.declined.includes(priorityId)) status = 'declined';
    let anchor = '';
    if (status === 'visible' || status === 'partly') {
      const hit = locateAnchor(str(asText(raw.anchor), 600), ctx.revisedFields, 3);
      if (hit) anchor = trimWords(hit.text, 30);
      else notes.push(`ANCHOR_UNVERIFIED:${priorityId}`);
    }
    const note = str(asText(raw.note), 500);
    result.checks.push({ priorityId, status, anchor, note, problems: note ? textProblems(note, ctx) : [] });
  }
  for (const id of ctx.priorityIds) {
    if (!seen.has(id)) {
      notes.push(`CHECK_MISSING:${id}`);
      if (ctx.declined.includes(id)) result.checks.push({ priorityId: id, status: 'declined', anchor: '', note: '', problems: [] });
    }
  }
  result.question = str(asText(value.question), 400);
  result.questionProblems = result.question ? textProblems(result.question, ctx) : [];
  const hard = [...result.focusProblems.map(code => `${code}:focus`), ...result.questionProblems.map(code => `${code}:question`)];
  for (const item of result.checks) item.problems.forEach(code => hard.push(`${code}:${item.priorityId}`));
  if (!result.checks.length) hard.push('MISSING:checks');
  return { result, hard, notes };
}

export function finalizeCheck(result, extra = {}) {
  return { focus: result.focus, checks: result.checks.map(({ problems, ...rest }) => rest), question: result.question, ...extra };
}
