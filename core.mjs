// core.mjs — shared by the browser (app.mjs, teacher.mjs, report.mjs) and the server.
// Pure functions only (no DOM or Node APIs), so every rule here is unit-tested in tests/core.test.mjs.

export const APP_VERSION = '4.0.0';
export const CONSENT_VERSION = '2026-10-v1';
export const pair = (zh, en) => ({ zh, en });

export const ROLES = ['analyst', 'socratic', 'language', 'coordinator'];
export const ROLE_PREFIX = { analyst: 'A', socratic: 'Q', language: 'L', coordinator: 'R' };
export const LEVELS = ['B1', 'B2', 'C1'];
export const MAX_ARGUMENTS = 5;
export const MAX_COUNTERS = 3;
export const MAX_SOURCES = 6;
export const MAX_LEARNER_TURNS = 3; // learner replies per dialogue thread

export const BASE_FIELDS = ['topic', 'audience', 'claim', 'qualifier', 'draft'];
export const ARGUMENT_FIELDS = ['reason', 'evidence', 'source', 'warrant'];
export const COUNTER_FIELDS = ['counter', 'response'];

export const LIMITS = {
  topic: 300, audience: 200, claim: 800, qualifier: 600, draft: 6000,
  reason: 800, evidence: 1500, source: 400, warrant: 1000,
  counter: 1000, response: 1500,
  revised: 6000, reply: 1200, decisionReason: 600, note: 1500, transfer: 1500, disclosure: 2000,
  selfReason: 400, selfQuestion: 300, learnerCode: 24, otherTools: 300
};

// ---------- shared vocabularies ----------
// Explicit criteria: the prompts quote these definitions, the UI shows the labels,
// and the teacher dashboard aggregates feedback by these keys.
export const CRITERIA = {
  claim: { label: pair('主张', 'Claim'), desc: 'The claim answers the topic, takes a clear and arguable position, and is qualified to a scope the evidence can support.' },
  relevance: { label: pair('理由相关性', 'Reason relevance'), desc: 'Each reason gives direct and distinct support for the claim; two reasons do not rest on the same ground.' },
  evidence: { label: pair('证据', 'Evidence'), desc: 'Evidence is specific, checkable and sufficient for the reason; its source and type are stated; planned or hypothetical examples are labelled as such, not presented as facts.' },
  warrant: { label: pair('推理联系', 'Warrant'), desc: 'The argument explains both links: why the evidence shows the reason is true, and why the reason supports the claim for this audience.' },
  counterargument: { label: pair('不同观点', 'Counterargument'), desc: 'The strongest reasonable objection is stated fairly, in terms its supporters would recognise.' },
  response: { label: pair('回应', 'Response'), desc: 'The response rebuts, concedes, weighs, or qualifies with a reason, and its strategy fits the claim (a concession should be reflected in the claim\'s scope).' },
  audience: { label: pair('读者意识', 'Audience'), desc: 'Reasons and evidence fit what the stated audience knows, values, and needs to decide.' },
  coherence: { label: pair('图文一致', 'Map–draft coherence'), desc: 'The draft develops the mapped claim, reasons, warrants and response, with the same strength of claim.' },
  stance: { label: pair('立场强度', 'Stance'), desc: 'Hedges and boosters match the strength of the evidence; no unsupported appeals to shared knowledge.' },
  cohesion: { label: pair('逻辑衔接', 'Cohesion'), desc: 'Connectors and reference words make logical relations explicit.' },
  attribution: { label: pair('来源表述', 'Attribution'), desc: 'Sources are introduced with accurate reporting language.' },
  precision: { label: pair('用词精确', 'Precision'), desc: 'Key terms are precise and used consistently.' },
  other: { label: pair('其他', 'Other'), desc: 'Other argument quality issue.' }
};
export const CONTENT_CRITERIA = ['claim', 'relevance', 'evidence', 'warrant', 'counterargument', 'response', 'audience', 'coherence'];
export const LANGUAGE_CRITERIA = ['stance', 'cohesion', 'attribution', 'precision'];

export const QUESTION_TYPES = {
  clarification: pair('澄清概念', 'Clarification'),
  assumption: pair('检验假设', 'Assumption'),
  evidence: pair('追问证据', 'Evidence'),
  alternative: pair('其他解释', 'Alternative'),
  implication: pair('推演后果', 'Implication'),
  counterargument: pair('对方视角', 'Counter-view'),
  audience: pair('读者视角', 'Audience'),
  tension: pair('前后对照', 'Tension'),
  'self-question': pair('自拟追问', 'Your own question'),
  feedback: pair('理解反馈', 'About this feedback'),
  other: pair('追问', 'Question')
};

// Argumentation schemes and critical questions, paraphrased from Walton, Reed & Macagno (2008).
export const SCHEMES = {
  example: { label: pair('举例论证', 'Argument from example'), cq: ['Is the example accurate and checkable?', 'Is it typical, or an exception?', 'Are there counter-examples?', 'Can one example support a claim this broad?'] },
  expert: { label: pair('权威论证', 'Argument from expert opinion'), cq: ['Is the source an expert in this specific field?', 'Is the statement reported accurately and in context?', 'Do other experts agree?', 'Could the source have a conflict of interest?'] },
  cause: { label: pair('因果论证', 'Cause-to-effect argument'), cq: ['How strong is the causal link?', 'Could another factor explain the effect?', 'Could the effect happen without this cause?'] },
  consequence: { label: pair('后果论证', 'Argument from consequences'), cq: ['How likely are the predicted consequences?', 'For whom are they good or bad?', 'Are there opposite consequences that weigh more?'] },
  analogy: { label: pair('类比论证', 'Argument from analogy'), cq: ['Are the two cases similar in the respects that matter?', 'Is there a relevant difference that breaks the analogy?'] },
  statistics: { label: pair('数据论证', 'Argument from data or sign'), cq: ['Where do the numbers come from, and are they current?', 'Is the sample representative?', 'Could the data be explained in another way?'] },
  values: { label: pair('价值论证', 'Argument from values'), cq: ['Does the audience share this value?', 'Which competing values are at stake?', 'Why should this value take priority here?'] },
  practical: { label: pair('实践推理', 'Practical reasoning'), cq: ['Would the proposed action actually achieve the goal?', 'Are there better alternatives?', 'What side effects could it have?'] },
  other: { label: pair('其他', 'Other'), cq: ['What would make this reason acceptable to a sceptical reader?'] }
};

export const EVIDENCE_TYPES = {
  data: pair('统计数据', 'Statistics or data'),
  study: pair('研究结果', 'Research finding'),
  expert: pair('专家或机构观点', 'Expert or official view'),
  case: pair('真实案例', 'Real case or event'),
  personal: pair('个人经历', 'Personal experience'),
  source: pair('教师提供材料', 'Teacher-provided source'),
  planned: pair('计划收集（尚无证据）', 'Planned (not yet collected)'),
  hypothetical: pair('假设情境', 'Hypothetical example')
};
export const STRATEGIES = { rebut: pair('反驳', 'Rebut'), concede: pair('让步', 'Concede'), weigh: pair('权衡', 'Weigh'), qualify: pair('限定', 'Qualify') };
export const DECISIONS = { accept: pair('采纳', 'Accept'), adapt: pair('调整后采纳', 'Adapt'), reject: pair('不采纳', 'Reject'), unclear: pair('还没看懂', 'Not sure what it means') };
export const CHECK_STATUS = {
  visible: pair('已体现', 'Visible'),
  partly: pair('部分体现', 'Partly visible'),
  'not-yet': pair('尚未体现', 'Not yet visible'),
  declined: pair('学生决定不采纳', 'Declined by learner')
};
export const MOVES = { probe: pair('深入追问', 'Probe'), press: pair('聚焦追问', 'Press'), acknowledge: pair('确认发现', 'Acknowledge'), clarify: pair('解释反馈', 'Clarify'), close: pair('小结', 'Close') };
export const AI_USE_LEVELS = {
  'argumentor-only': pair('仅允许使用本工具的反馈与追问', 'ArguMentor feedback and questions only'),
  'language-tools': pair('另允许AI语言检查，须披露', 'AI language checking also allowed, with disclosure'),
  'open-disclosed': pair('允许其他AI辅助，须详细披露', 'Other AI assistance allowed, with detailed disclosure')
};
// Structured analyst checks (diagnostic labels, never scores).
export const CHECK_VALUES = {
  scope: ['qualified', 'overbroad', 'unclear'],
  answersTopic: ['yes', 'partly', 'no'],
  evidenceStatus: ['collected', 'source', 'personal', 'planned', 'hypothetical', 'missing'],
  link: ['explained', 'partly', 'missing'],
  fairness: ['fair', 'weakened', 'missing'],
  responseType: ['rebut', 'concede', 'weigh', 'qualify', 'restates-claim', 'missing']
};

// Starter topics with topic-language sheets (balanced vocabulary for both sides; not argument content).
export const TOPIC_PACKS = {
  'workplace-ai': {
    label: pair('职场AI监控', 'AI monitoring at work'),
    topic: 'Should employers be allowed to use AI systems to monitor employees\' work?',
    vocabulary: [
      ['employee monitoring', '员工监控', 'Collecting information about how employees work.'],
      ['algorithmic management', '算法管理', 'Using software to assign, track or evaluate work.'],
      ['productivity tracking', '生产效率追踪', 'Measuring output, speed or activity.'],
      ['keystroke logging', '键盘记录', 'Recording what a person types.'],
      ['proportionality', '相称性原则', 'Monitoring should not go further than the purpose needs.'],
      ['data minimisation', '数据最小化', 'Collecting only the data that is necessary.'],
      ['informed consent', '知情同意', 'Agreement given with a clear understanding of what happens.'],
      ['transparency', '透明度', 'Employees know what is collected and why.'],
      ['workplace trust', '职场信任', 'Confidence between employees and managers.'],
      ['false positive', '误判', 'A system wrongly flags normal behaviour as a problem.']
    ]
  },
  'ai-writing': {
    label: pair('AI与学术写作', 'AI in writing courses'),
    topic: 'Should universities permit generative AI in academic writing courses?',
    vocabulary: [
      ['generative AI', '生成式人工智能', 'Software that produces text or images from prompts.'],
      ['academic integrity', '学术诚信', 'Honest and responsible academic work.'],
      ['disclosure', '披露', 'Stating openly how a tool was used.'],
      ['authorship', '作者身份', 'Who is responsible for the ideas and words.'],
      ['over-reliance', '过度依赖', 'Depending on a tool more than is helpful for learning.'],
      ['AI literacy', 'AI素养', 'Knowing how AI tools work and where they fail.'],
      ['formative feedback', '形成性反馈', 'Feedback given during learning to guide improvement.'],
      ['outline', '提纲', 'A plan of the main points of a text.']
    ]
  },
  green: {
    label: pair('绿色校园', 'A greener campus'),
    topic: 'How should universities encourage students to reduce single-use packaging?',
    vocabulary: [
      ['single-use packaging', '一次性包装', 'Packaging thrown away after one use.'],
      ['reduce at source', '源头减量', 'Producing less waste in the first place.'],
      ['reusable container', '可重复使用容器', 'A container used many times.'],
      ['incentive', '激励措施', 'A reward that encourages a behaviour.'],
      ['behavioural nudge', '行为助推', 'A small design change that makes a choice easier.'],
      ['deposit-return scheme', '押金返还制度', 'Paying a small deposit that is returned when the item is brought back.'],
      ['convenience', '便利性', 'How easy an option is to use.'],
      ['waste sorting', '垃圾分类', 'Separating waste into categories.']
    ]
  },
  heritage: {
    label: pair('文化传承', 'Cultural heritage'),
    topic: 'Should university language courses include community-based cultural heritage projects?',
    vocabulary: [
      ['intangible cultural heritage', '非物质文化遗产', 'Practices, skills and traditions passed between generations.'],
      ['safeguard', '保护', 'Protect and keep alive (UNESCO\'s usual verb).'],
      ['transmission', '传承', 'Passing knowledge from one generation to the next.'],
      ['bearer / practitioner', '传承人', 'UNESCO texts often say "bearers" or "practitioners"; Chinese official English often says "representative inheritor". Choose for your audience.'],
      ['community participation', '社区参与', 'Local people taking an active part.'],
      ['commodification', '商品化', 'Turning a cultural practice into a product for sale.'],
      ['service learning', '服务学习', 'Learning through organised community service.'],
      ['authenticity', '真实性', 'Being true to the original practice.']
    ]
  }
};

// Bilingual glossary shown in the interface only (the model always works in English).
export const GLOSSARY = {
  claim: pair('主张：你对议题给出的明确回答。', 'Your clear answer to the question.'),
  qualifier: pair('限定：说明主张成立的条件、范围或程度。', 'The conditions, scope or degree of your claim.'),
  reason: pair('理由：支持主张的一个独立依据。', 'One separate ground that supports the claim.'),
  evidence: pair('证据：可以核查的事实、数据、案例或材料。', 'Checkable facts, data, cases or sources.'),
  warrant: pair('推理联系：说明证据为什么能支持理由、理由为什么能支持主张。', 'Why the evidence supports the reason, and why the reason supports the claim.'),
  counterargument: pair('不同观点：理性的读者可能提出的反对意见。', 'An objection a reasonable reader might raise.'),
  rebuttal: pair('反驳：说明反对意见为什么不成立。', 'Showing why an objection does not hold.'),
  concession: pair('让步：承认反对意见中合理的部分。', 'Accepting what is reasonable in an objection.'),
  hedge: pair('缓和语：如 may、likely，用来降低断言强度。', 'Words such as "may" or "likely" that soften a claim.'),
  booster: pair('强化语：如 clearly、must，用来增强断言强度。', 'Words such as "clearly" or "must" that strengthen a claim.'),
  stance: pair('立场强度：表达的确定程度是否与证据相符。', 'How certain your wording sounds compared with your evidence.'),
  attribution: pair('来源表述：如何引出和转述来源。', 'How you introduce and report a source.'),
  cohesion: pair('衔接：用连接词和指代说明逻辑关系。', 'Using connectors and reference words to show logical links.'),
  scheme: pair('论证类型：如举例、因果、权威、类比等推理方式。', 'The type of reasoning, such as example, cause, expert or analogy.'),
  audience: pair('目标读者：这篇文章想要说服的人。', 'The people your argument is written to persuade.'),
  assumption: pair('假设：论证默认成立、但没有说明的前提。', 'Something your argument takes for granted without saying it.')
};

// ---------- small helpers ----------
export const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = value => (Array.isArray(value) ? value : []);
export const integer = (value, fallback, min, max) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const pick = (value, allowed, fallback = '') => (Object.hasOwn(allowed, value) ? value : fallback);

export class InputError extends Error {
  constructor(code, field = '', detail = '') {
    super(code);
    this.name = 'InputError';
    this.field = field;
    this.detail = detail;
  }
}

export function countWords(text) {
  return (String(text || '').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

export function normalizeForMatch(text) {
  return String(text || '').normalize('NFKC').toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word tokens with offsets in the original text; matching ignores punctuation and case.
export function tokens(text) {
  const out = [];
  const source = String(text || '');
  const pattern = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
  let match;
  while ((match = pattern.exec(source))) out.push({ word: match[0].normalize('NFKC').toLowerCase().replace(/’/g, "'"), start: match.index, end: match.index + match[0].length });
  return out;
}

// Finds `needle` as a contiguous word sequence in `haystack`; returns the exact original span or null.
export function findSpan(needle, haystack, minWords = 2) {
  const wanted = tokens(needle).map(item => item.word);
  if (wanted.length < minWords) return null;
  const found = tokens(haystack);
  outer: for (let i = 0; i + wanted.length <= found.length; i += 1) {
    for (let j = 0; j < wanted.length; j += 1) if (found[i + j].word !== wanted[j]) continue outer;
    return String(haystack).slice(found[i].start, found[i + wanted.length - 1].end);
  }
  return null;
}

// Locates an anchor in a list of {path, text} fields. Anchors may contain an ellipsis; the longest part is used.
export function locateAnchor(anchor, fields, minWords = 2) {
  const parts = String(anchor || '').split(/\.{3}|…/).map(part => part.trim()).filter(Boolean)
    .sort((a, b) => tokens(b).length - tokens(a).length);
  for (const part of parts) {
    for (const field of fields) {
      const span = findSpan(part, field.text, minWords);
      if (span) return { path: field.path, text: span };
    }
  }
  return null;
}

export function ngrams(text, size = 4) {
  const words = tokens(text).map(item => item.word);
  const grams = new Set();
  for (let i = 0; i + size <= words.length; i += 1) grams.add(words.slice(i, i + size).join(' '));
  return grams;
}

export function learnerFields(data) {
  const fields = [];
  const push = (path, text) => { if (text) fields.push({ path, text }); };
  for (const key of BASE_FIELDS) push(key, data?.[key]);
  list(data?.arguments).forEach((unit, index) => ARGUMENT_FIELDS.forEach(key => push(`arguments.${index}.${key}`, unit?.[key])));
  list(data?.counters).forEach((unit, index) => COUNTER_FIELDS.forEach(key => push(`counters.${index}.${key}`, unit?.[key])));
  return fields;
}

export function targetForPath(path) {
  if (!path) return '';
  let match = path.match(/^arguments\.(\d+)/);
  if (match) return `Reason ${Number(match[1]) + 1}`;
  match = path.match(/^counters\.(\d+)/);
  if (match) return `Counterargument ${Number(match[1]) + 1}`;
  return { topic: 'Topic', audience: 'Audience', claim: 'Claim', qualifier: 'Qualifier', draft: 'Draft' }[path] || '';
}

// ---------- English-writing and privacy rules ----------
// Learner writing must be English. A short Chinese gloss in brackets right after an English word is allowed
// (for example "Kunqu (昆曲)" or "the 996 schedule (996工作制)"); any other Chinese text is not.
// The source field is exempt, so learners can cite Chinese-language sources by their real titles.
const GLOSS = /([A-Za-z0-9’'"”)])\s*[（(][^()（）]{0,16}[)）]/g;
export function englishIssue(text) {
  const value = String(text || '');
  if (!/\p{Script=Han}/u.test(value)) return null;
  const withoutGlosses = value.replace(GLOSS, (match, before) => (/\p{Script=Han}/u.test(match) ? before : match));
  if (/\p{Script=Han}/u.test(withoutGlosses)) return 'ENGLISH_REQUIRED';
  if ((value.match(/\p{Script=Latin}/gu) || []).length < 10) return 'ENGLISH_REQUIRED';
  return null;
}

const PII_RULES = [
  { type: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, mask: '[email]' },
  { type: 'phone', pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, mask: '[phone]' },
  { type: 'id-number', pattern: /(?<!\d)\d{17}[\dXx](?![\dXx])/g, mask: '[ID number]' },
  { type: 'long-number', pattern: /(?<![\d.,])\d{8,}(?!\d)/g, mask: '[number]', skipForSource: true }
];
export function screenPII(text, { source = false } = {}) {
  const value = String(text || '');
  for (const rule of PII_RULES) {
    rule.pattern.lastIndex = 0;
    if (!(source && rule.skipForSource) && rule.pattern.test(value)) return rule.type;
  }
  return null;
}
export function redactPII(text, { source = false } = {}) {
  let value = String(text || '');
  for (const rule of PII_RULES) {
    if (source && rule.skipForSource) continue;
    rule.pattern.lastIndex = 0;
    value = value.replace(rule.pattern, rule.mask);
  }
  return value;
}

// ---------- learner data ----------
export const blankArgument = () => ({ reason: '', evidence: '', evidenceType: '', source: '', warrant: '' });
export const blankCounter = () => ({ target: 'Claim', counter: '', strategy: '', response: '' });
export const blankData = () => ({ topic: '', audience: '', claim: '', qualifier: '', level: 'B2', arguments: [blankArgument()], counters: [blankCounter()], draft: '' });

function cleanText(value, key, path) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new InputError('INVALID_INPUT', path);
  const text = (value || '').trim();
  if (text.length > (LIMITS[key] || 1000)) throw new InputError('INPUT_TOO_LONG', path);
  return text;
}

function checkWriting(path, key, text, { allowChinese = false } = {}) {
  if (!text) return;
  const pii = screenPII(text, { source: key === 'source' });
  if (pii) throw new InputError('PII_DETECTED', path, pii);
  if (!allowChinese && key !== 'source' && englishIssue(text)) throw new InputError('ENGLISH_REQUIRED', path);
}

const COUNTER_TARGET_RE = /^(Claim|Reason [1-5])$/;

export function validateInput(raw) {
  if (!isObject(raw)) throw new InputError('INVALID_INPUT');
  const data = {};
  for (const key of BASE_FIELDS) data[key] = cleanText(raw[key], key, key);
  data.level = LEVELS.includes(raw.level) ? raw.level : 'B2';
  if (!Array.isArray(raw.arguments) || raw.arguments.length < 1 || raw.arguments.length > MAX_ARGUMENTS) throw new InputError('INVALID_ARGUMENTS', 'arguments');
  data.arguments = raw.arguments.map((item, index) => {
    if (!isObject(item)) throw new InputError('INVALID_ARGUMENTS', `arguments.${index}`);
    const unit = Object.fromEntries(ARGUMENT_FIELDS.map(key => [key, cleanText(item[key], key, `arguments.${index}.${key}`)]));
    unit.evidenceType = pick(item.evidenceType, EVIDENCE_TYPES);
    return { reason: unit.reason, evidence: unit.evidence, evidenceType: unit.evidenceType, source: unit.source, warrant: unit.warrant };
  });
  const counters = raw.counters === undefined ? [] : raw.counters;
  if (!Array.isArray(counters) || counters.length > MAX_COUNTERS) throw new InputError('INVALID_ARGUMENTS', 'counters');
  data.counters = counters.map((item, index) => {
    if (!isObject(item)) throw new InputError('INVALID_ARGUMENTS', `counters.${index}`);
    const target = COUNTER_TARGET_RE.test(item.target) && (item.target === 'Claim' || Number(item.target.slice(7)) <= data.arguments.length) ? item.target : 'Claim';
    return { target, counter: cleanText(item.counter, 'counter', `counters.${index}.counter`), strategy: pick(item.strategy, STRATEGIES), response: cleanText(item.response, 'response', `counters.${index}.response`) };
  });
  if (!data.counters.length) data.counters = [blankCounter()];
  if (!data.topic) throw new InputError('MISSING_INPUT', 'topic');
  if (!data.claim) throw new InputError('MISSING_INPUT', 'claim');
  if (!data.arguments.some(item => item.reason)) throw new InputError('MISSING_REASON', 'arguments.0.reason');
  for (const key of BASE_FIELDS) checkWriting(key, key, data[key]);
  data.arguments.forEach((item, index) => ARGUMENT_FIELDS.forEach(key => checkWriting(`arguments.${index}.${key}`, key, item[key])));
  data.counters.forEach((item, index) => COUNTER_FIELDS.forEach(key => checkWriting(`counters.${index}.${key}`, key, item[key])));
  if (JSON.stringify(data).length > 40000) throw new InputError('INPUT_TOO_LONG');
  return data;
}

// Single pieces of learner writing outside the map (dialogue replies, revisions, reflections).
export function validateLearnerText(value, key, { required = true, minWords = 0, allowChinese = false } = {}) {
  const text = cleanText(value, key, key);
  if (required && !text) throw new InputError('MISSING_INPUT', key);
  if (minWords && text && countWords(text) < minWords && !(allowChinese && /\p{Script=Han}/u.test(text))) throw new InputError('TOO_SHORT', key);
  checkWriting(key, key, text, { allowChinese });
  return text;
}

export const sameInput = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Lists learner fields that differ between a reviewed snapshot and the current map.
export function changedFields(before, after) {
  if (!before || !after) return [];
  const changes = [];
  const compare = (path, a, b) => { if ((a || '') !== (b || '')) changes.push(path); };
  for (const key of BASE_FIELDS) compare(key, before[key], after[key]);
  compare('level', before.level, after.level);
  const units = Math.max(list(before.arguments).length, list(after.arguments).length);
  for (let i = 0; i < units; i += 1) for (const key of [...ARGUMENT_FIELDS, 'evidenceType']) compare(`arguments.${i}.${key}`, before.arguments?.[i]?.[key], after.arguments?.[i]?.[key]);
  const counters = Math.max(list(before.counters).length, list(after.counters).length);
  for (let i = 0; i < counters; i += 1) for (const key of ['target', 'counter', 'strategy', 'response']) compare(`counters.${i}.${key}`, before.counters?.[i]?.[key], after.counters?.[i]?.[key]);
  return changes;
}

export function fieldCompletion(data) {
  const filled = value => Boolean(String(value || '').trim());
  const rows = [{ key: 'claim', filled: filled(data.claim) }, { key: 'qualifier', filled: filled(data.qualifier), optional: true }];
  list(data.arguments).forEach((item, index) => {
    rows.push({ key: 'reason', index, filled: filled(item.reason) });
    rows.push({ key: 'evidence', index, filled: filled(item.evidence) });
    rows.push({ key: 'warrant', index, filled: filled(item.warrant) });
  });
  list(data.counters).forEach((item, index) => {
    rows.push({ key: 'counter', index, filled: filled(item.counter) });
    rows.push({ key: 'response', index, filled: filled(item.response) });
  });
  return rows;
}

// A compact, deterministic description of the map for the analyst ("empty" is a fact, not a judgement).
export function mapSummary(data) {
  const empty = [];
  list(data.arguments).forEach((unit, index) => {
    if (!unit.reason) return;
    const missing = ['evidence', 'source', 'warrant'].filter(key => !unit[key]);
    if (missing.length) empty.push(`Reason ${index + 1}: ${missing.join(', ')} not written yet`);
    if (!unit.evidenceType) empty.push(`Reason ${index + 1}: evidence type not chosen`);
  });
  list(data.counters).forEach((unit, index) => {
    if (!unit.counter && !unit.response) empty.push(`Counterargument ${index + 1}: not written yet`);
    else {
      if (!unit.response) empty.push(`Counterargument ${index + 1}: response not written yet`);
      if (!unit.strategy) empty.push(`Counterargument ${index + 1}: response strategy not chosen`);
    }
  });
  if (!data.qualifier) empty.push('Qualifier: not written yet');
  if (!data.draft) empty.push('Draft: not written yet');
  if (!data.audience) empty.push('Audience: not stated');
  return { reasons: list(data.arguments).filter(unit => unit.reason).length, notYetWritten: empty };
}

// Deterministic language signals for the language coach (word-list matches; the coach verifies them).
const SIGNALS = [
  ['booster', /\b(must|always|never|definitely|certainly|undoubtedly|obviously|clearly|surely|totally|completely|absolutely|prove[sd]?|without (?:any )?doubt)\b/gi],
  ['absolute', /\b(all|every|no) (?:people|person|workers?|employees?|students?|companies|employers|managers|teachers|universities)\b/gi],
  ['shared-knowledge', /\b(as we all know|everyone knows|it is (?:well|widely) known|nobody can deny|there is no doubt|it goes without saying)\b/gi],
  ['unattributed', /\b(studies|research|experts|scientists|surveys|statistics|reports|data) (show|shows|prove|proves|say|says|suggest|suggests|found|indicate|indicates)\b/gi],
  ['vague-reference', /(?:^|[.!?]\s+)(this|it) (is|was|will|can|could|may|makes|shows|means)\b/gi]
];
export function languageSignals(data) {
  const out = [];
  for (const field of learnerFields(data)) {
    if (/\.(source)$/.test(field.path) || field.path === 'topic' || field.path === 'audience') continue;
    for (const [signal, pattern] of SIGNALS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(field.text)) && out.length < 12) {
        const start = Math.max(0, field.text.lastIndexOf(' ', Math.max(0, match.index - 25)));
        out.push({ target: targetForPath(field.path), signal, match: field.text.slice(start, match.index + match[0].length + 30).trim() });
      }
    }
  }
  return out;
}

// ---------- self-assessment and earlier rounds (sent with a review request) ----------
export function selfAssessmentOptions(data) {
  const options = [['claim', 'Claim'], ['qualifier', 'Qualifier']];
  list(data.arguments).forEach((unit, index) => {
    if (!unit.reason) return;
    options.push([`arguments.${index}.reason`, `Reason ${index + 1}`]);
    options.push([`arguments.${index}.evidence`, `Reason ${index + 1} evidence`]);
    options.push([`arguments.${index}.warrant`, `Reason ${index + 1} warrant`]);
  });
  list(data.counters).forEach((unit, index) => {
    options.push([`counters.${index}.counter`, `Counterargument ${index + 1}`]);
    options.push([`counters.${index}.response`, `Counterargument ${index + 1} response`]);
  });
  options.push(['draft', 'Draft']);
  return options;
}

export function validateSelfAssessment(raw, data) {
  if (!isObject(raw)) throw new InputError('SELF_ASSESSMENT_REQUIRED', 'self.element');
  const options = selfAssessmentOptions(data);
  const option = options.find(([value]) => value === raw.element);
  if (!option) throw new InputError('SELF_ASSESSMENT_REQUIRED', 'self.element');
  const reason = validateLearnerText(raw.reason, 'selfReason', { minWords: 4 });
  const question = validateLearnerText(raw.question, 'selfQuestion', { required: false });
  return { element: option[0], label: option[1], reason, question };
}

// Learner-written text that is carried forward between rounds. Anything the learner typed is screened for
// personal information before it can reach the provider, exactly like the fields in validateInput; an item
// that would leak is dropped rather than rejected, so one old note cannot block a new round.
export const dropIfPII = (text, max) => { const value = str(text, max); return value && screenPII(value) ? '' : value; };

export function validatePriorRounds(raw) {
  return list(raw).slice(-2).filter(isObject).map(round => ({
    round: integer(round.round, 1, 1, 99),
    priorities: list(round.priorities).slice(0, 3).filter(isObject).map(item => ({
      id: str(item.id, 8), target: str(item.target, 40), text: str(item.text, 600),
      decision: pick(item.decision, DECISIONS), reason: dropIfPII(item.reason, LIMITS.decisionReason),
      status: pick(item.status, CHECK_STATUS)
    })).filter(item => item.text),
    insights: list(round.insights).slice(0, 6).map(item => dropIfPII(item, 400)).filter(Boolean),
    questionsAsked: list(round.questionsAsked).slice(0, 4).map(item => str(item, 300)).filter(Boolean)
  }));
}

// ---------- teacher task and source pack ----------
export function validateTask(raw) {
  if (!isObject(raw) || raw.kind !== 'argumentor-task') throw new InputError('INVALID_TASK');
  const task = {
    kind: 'argumentor-task',
    version: 1,
    title: str(raw.title, 120),
    topic: str(raw.topic, LIMITS.topic),
    audience: str(raw.audience, LIMITS.audience),
    lockTopic: Boolean(raw.lockTopic),
    instructions: str(raw.instructions, 1500),
    requirements: list(raw.requirements).map(item => str(item, 200)).filter(Boolean).slice(0, 8),
    wordMin: integer(raw.wordMin, 0, 0, 3000),
    wordMax: integer(raw.wordMax, 0, 0, 5000),
    level: LEVELS.includes(raw.level) ? raw.level : '',
    focus: list(raw.focus).filter(key => CONTENT_CRITERIA.includes(key)).slice(0, 4),
    languageFocus: LANGUAGE_CRITERIA.includes(raw.languageFocus) ? raw.languageFocus : '',
    minDialogue: integer(raw.minDialogue, 1, 0, 3),
    aiUse: pick(raw.aiUse, AI_USE_LEVELS, 'argumentor-only'),
    reflectionLanguage: raw.reflectionLanguage === 'english' ? 'english' : 'either',
    vocabulary: list(raw.vocabulary).slice(0, 15).map(item => (Array.isArray(item) ? [str(item[0], 60), str(item[1], 60), str(item[2], 200)] : [str(item?.term, 60), str(item?.zh, 60), str(item?.note, 200)])).filter(item => item[0]),
    sources: list(raw.sources).slice(0, MAX_SOURCES)
      .map(item => ({ title: str(item?.title, 200), kind: str(item?.kind, 60), text: str(item?.text, 2500) }))
      .filter(item => item.title || item.text)
      .map((item, index) => ({ id: `S${index + 1}`, ...item })),
    teacherNote: str(raw.teacherNote, 800)
  };
  if (!task.title || !task.topic) throw new InputError('INVALID_TASK');
  if (task.wordMax && task.wordMin > task.wordMax) task.wordMin = 0;
  return task;
}

export function extractQuotes(text) {
  const out = [];
  const pattern = /["“]([^"“”]{3,400})["”]/g;
  let match;
  while ((match = pattern.exec(String(text || '')))) out.push(match[1].trim());
  return out;
}

// Deterministic evidence check: are quoted words in an argument unit really in the cited teacher source?
export function checkSourceQuotes(data, sources = []) {
  const results = [];
  list(data?.arguments).forEach((unit, index) => {
    const ids = [...new Set(String(unit.source || '').match(/\bS[1-6]\b/g) || [])];
    for (const id of ids) if (!sources.some(item => item.id === id)) results.push({ unit: index, sourceId: id, quote: '', status: 'unknown-source' });
    const pool = ids.length ? sources.filter(item => ids.includes(item.id)) : sources;
    if (!pool.length) return;
    for (const quote of extractQuotes(unit.evidence).filter(item => countWords(item) >= 3)) {
      const hit = pool.find(item => findSpan(quote, item.text, 3));
      results.push({ unit: index, sourceId: hit ? hit.id : (ids.join('+') || 'pack'), quote: quote.slice(0, 200), status: hit ? 'found' : 'not-found' });
    }
  });
  return results;
}

// ---------- role results (after the server-side integrity guard) ----------
function normalizeItem(raw, index, prefix) {
  if (!isObject(raw)) return null;
  const text = str(raw.text, 800);
  if (!text) return null;
  return { id: str(raw.id, 8) || `${prefix}${index + 1}`, criterion: CRITERIA[raw.criterion] ? raw.criterion : 'other', target: str(raw.target, 40), anchor: str(raw.anchor, 400), anchorField: str(raw.anchorField, 60), text };
}
function normalizeQuestion(raw, index, prefix) {
  if (!isObject(raw)) return null;
  const text = str(raw.text, 500);
  if (!text) return null;
  return { id: str(raw.id, 8) || `${prefix}${index + 1}`, type: QUESTION_TYPES[raw.type] ? raw.type : 'other', target: str(raw.target, 40), anchor: str(raw.anchor, 400), anchorField: str(raw.anchorField, 60), text };
}
function normalizeChecks(raw) {
  if (!isObject(raw)) return null;
  const enumOf = (value, key) => (CHECK_VALUES[key].includes(value) ? value : '');
  return {
    claim: isObject(raw.claim) ? { scope: enumOf(raw.claim.scope, 'scope'), answersTopic: enumOf(raw.claim.answersTopic, 'answersTopic') } : { scope: '', answersTopic: '' },
    reasons: list(raw.reasons).filter(isObject).slice(0, MAX_ARGUMENTS).map(item => ({ target: str(item.target, 40), evidenceStatus: enumOf(item.evidenceStatus, 'evidenceStatus'), evidenceLink: enumOf(item.evidenceLink, 'link'), claimLink: enumOf(item.claimLink, 'link') })),
    counterarguments: list(raw.counterarguments).filter(isObject).slice(0, MAX_COUNTERS).map(item => ({ target: str(item.target, 40), fairness: enumOf(item.fairness, 'fairness'), responseType: enumOf(item.responseType, 'responseType') }))
  };
}

export function normalizeRoleResult(raw, role) {
  if (!ROLES.includes(role) || !isObject(raw)) throw new Error('INVALID_RESULT');
  const prefix = ROLE_PREFIX[role];
  const result = {
    role,
    focus: str(raw.focus, 300),
    items: list(raw.items).map((item, index) => normalizeItem(item, index, prefix)).filter(Boolean).slice(0, 3),
    questions: list(raw.questions).map((item, index) => normalizeQuestion(item, index, prefix)).filter(Boolean).slice(0, 3),
    frames: list(raw.frames).map(item => (typeof item === 'string' ? { move: '', text: str(item, 220) } : { move: str(item?.move, 60), text: str(item?.text, 220) })).filter(item => item.text).slice(0, 3),
    schemes: list(raw.schemes).filter(isObject).map(item => ({ target: str(item.target, 40), scheme: SCHEMES[item.scheme] ? item.scheme : 'other', note: str(item.note, 200) })).slice(0, MAX_ARGUMENTS + MAX_COUNTERS),
    checks: normalizeChecks(raw.checks),
    strength: isObject(raw.strength) && str(raw.strength.text, 400) ? { target: str(raw.strength.target, 40), anchor: str(raw.strength.anchor, 400), anchorField: str(raw.strength.anchorField, 60), text: str(raw.strength.text, 400) } : null,
    selfAssessment: isObject(raw.selfAssessment) && ['agree', 'partly', 'different'].includes(raw.selfAssessment.agreement) ? { agreement: raw.selfAssessment.agreement, note: str(raw.selfAssessment.note, 400) } : null,
    priorities: list(raw.priorities).filter(isObject).map((item, index) => ({ id: str(item.id, 8) || `R${index + 1}`, target: str(item.target, 40), type: item.type === 'language' ? 'language' : 'argument', text: str(item.text, 600), successCheck: str(item.successCheck, 300), basedOn: list(item.basedOn).map(id => str(id, 8)).filter(Boolean).slice(0, 6), fallback: Boolean(item.fallback) })).filter(item => item.text).slice(0, 2),
    tension: str(raw.tension, 400),
    nextStep: str(raw.nextStep, 300),
    guard: { repaired: Boolean(raw.guard?.repaired), regenerated: Boolean(raw.guard?.regenerated), notes: list(raw.guard?.notes).map(item => str(item, 80)).filter(Boolean).slice(0, 30) },
    meta: isObject(raw.meta) ? { servedModel: str(raw.meta.servedModel, 80), ms: integer(raw.meta.ms, 0, 0, 600000), tokens: integer(raw.meta.tokens, 0, 0, 1000000), calls: integer(raw.meta.calls, 0, 0, 10) } : {}
  };
  if (!result.focus) throw new Error('INVALID_RESULT');
  return result;
}

// ---------- browser state (persisted in localStorage; migration is pure so it can be tested) ----------
export function defaultState() {
  return {
    version: 4, lang: 'zh', page: 'frame', learnerCode: '', task: null, data: blankData(),
    rounds: [], current: -1, transfer: '', goalCheck: '', disclosure: '',
    aiUse: { argumentor: true, languageTools: false, contentTools: false, otherTools: '', ownWords: false },
    researchConsent: false, events: [], createdAt: '', savedAt: ''
  };
}

export function newRound(id, input) {
  return { id, startedAt: '', input, status: 'idle', self: null, results: {}, roleErrors: {}, meta: {}, dialogue: {}, decisions: {}, note: '', revised: '', revisions: [], check: null };
}

function restoreData(raw) {
  const data = blankData();
  if (!isObject(raw)) return data;
  for (const key of BASE_FIELDS) if (typeof raw[key] === 'string') data[key] = raw[key].slice(0, LIMITS[key]);
  data.level = LEVELS.includes(raw.level) ? raw.level : 'B2';
  if (Array.isArray(raw.arguments) && raw.arguments.length) {
    data.arguments = raw.arguments.slice(0, MAX_ARGUMENTS).map(item => ({
      ...Object.fromEntries(ARGUMENT_FIELDS.map(key => [key, typeof item?.[key] === 'string' ? item[key].slice(0, LIMITS[key]) : ''])),
      evidenceType: pick(item?.evidenceType, EVIDENCE_TYPES)
    })).map(unit => ({ reason: unit.reason, evidence: unit.evidence, evidenceType: unit.evidenceType, source: unit.source, warrant: unit.warrant }));
  }
  let counters = Array.isArray(raw.counters) ? raw.counters : [];
  if (!counters.length && (typeof raw.counter === 'string' || typeof raw.response === 'string')) counters = [{ counter: raw.counter, response: raw.response }];
  if (counters.length) {
    data.counters = counters.slice(0, MAX_COUNTERS).map(item => ({
      target: COUNTER_TARGET_RE.test(item?.target) ? item.target : 'Claim',
      counter: typeof item?.counter === 'string' ? item.counter.slice(0, LIMITS.counter) : '',
      strategy: pick(item?.strategy, STRATEGIES),
      response: typeof item?.response === 'string' ? item.response.slice(0, LIMITS.response) : ''
    }));
  }
  return data;
}

function attempt(fn, fallback, dropped, label) {
  try { return fn(); } catch { if (dropped && label) dropped.push(label); return fallback; }
}

function restoreRound(raw, index, dropped) {
  if (!isObject(raw)) return null;
  const input = raw.input ? attempt(() => validateInput(raw.input), null, dropped, `round ${index + 1} input`) : null;
  const round = newRound(integer(raw.id, index + 1, 1, 99), input);
  round.startedAt = str(raw.startedAt, 40);
  round.status = ['idle', 'complete', 'partial', 'failed'].includes(raw.status) ? raw.status : 'idle';
  if (isObject(raw.self)) round.self = { element: str(raw.self.element, 40), label: str(raw.self.label, 60), reason: str(raw.self.reason, LIMITS.selfReason), question: str(raw.self.question, LIMITS.selfQuestion) };
  for (const role of ROLES) {
    if (!raw.results?.[role]) continue;
    const result = attempt(() => normalizeRoleResult(raw.results[role], role), null, dropped, `round ${index + 1} ${role}`);
    if (result) round.results[role] = result;
  }
  if (isObject(raw.roleErrors)) for (const role of ROLES) if (typeof raw.roleErrors[role] === 'string') round.roleErrors[role] = raw.roleErrors[role].slice(0, 40);
  if (isObject(raw.meta)) {
    const meta = raw.meta;
    round.meta = {
      runId: str(meta.runId, 60), model: str(meta.model, 80), servedModel: str(meta.servedModel, 80), promptVersion: str(meta.promptVersion, 40), mode: str(meta.mode, 20),
      provider: str(meta.provider, 20), live: meta.live !== false, calls: integer(meta.calls, 0, 0, 1000), repairs: integer(meta.repairs, 0, 0, 1000), tokens: integer(meta.tokens, 0, 0, 10000000),
      ms: integer(meta.ms, 0, 0, 3600000), at: str(meta.at, 40), appVersion: str(meta.appVersion, 20),
      params: isObject(meta.params) ? { temperature: Number(meta.params.temperature) || 0, maxTokens: integer(meta.params.maxTokens, 0, 0, 100000), thinking: str(meta.params.thinking, 20) } : null,
      consent: isObject(meta.consent) ? { version: str(meta.consent.version, 40), at: str(meta.consent.at, 40) } : null
    };
  }
  if (isObject(raw.dialogue)) {
    for (const [id, thread] of Object.entries(raw.dialogue).slice(0, 12)) {
      if (!isObject(thread)) continue;
      round.dialogue[str(id, 8)] = {
        kind: thread.kind === 'feedback' ? 'feedback' : 'question',
        closed: Boolean(thread.closed),
        takeaway: str(thread.takeaway, LIMITS.reply),
        turns: list(thread.turns).filter(isObject).slice(0, 2 * MAX_LEARNER_TURNS + 2).map(turn => ({
          from: turn.from === 'coach' ? 'coach' : 'learner',
          text: str(turn.text, LIMITS.reply),
          move: MOVES[turn.move] ? turn.move : '',
          insight: str(turn.insight, 400),
          at: str(turn.at, 40)
        })).filter(turn => turn.text)
      };
    }
  }
  if (isObject(raw.decisions)) {
    for (const [id, decision] of Object.entries(raw.decisions).slice(0, 24)) {
      if (isObject(decision) && DECISIONS[decision.decision]) round.decisions[str(id, 8)] = { decision: decision.decision, reason: str(decision.reason, LIMITS.decisionReason), at: str(decision.at, 40) };
    }
  }
  round.note = str(raw.note, LIMITS.note);
  round.revised = typeof raw.revised === 'string' ? raw.revised.slice(0, LIMITS.revised) : '';
  round.revisions = list(raw.revisions).filter(isObject).slice(-10).map(item => ({ at: str(item.at, 40), text: typeof item.text === 'string' ? item.text.slice(0, LIMITS.revised) : '', words: integer(item.words, 0, 0, 100000) }));
  if (isObject(raw.check) && isObject(raw.check.result)) {
    const result = raw.check.result;
    round.check = {
      at: str(raw.check.at, 40),
      revised: typeof raw.check.revised === 'string' ? raw.check.revised.slice(0, LIMITS.revised) : '',
      meta: isObject(raw.check.meta) ? { servedModel: str(raw.check.meta.servedModel, 80), promptVersion: str(raw.check.meta.promptVersion, 40), tokens: integer(raw.check.meta.tokens, 0, 0, 1000000) } : {},
      result: {
        focus: str(result.focus, 300),
        checks: list(result.checks).filter(isObject).slice(0, 4).map(item => ({ priorityId: str(item.priorityId, 8), status: CHECK_STATUS[item.status] ? item.status : 'not-yet', anchor: str(item.anchor, 400), note: str(item.note, 500) })),
        question: str(result.question, 400),
        guard: { repaired: Boolean(result.guard?.repaired), notes: list(result.guard?.notes).map(item => str(item, 80)).slice(0, 20) }
      }
    };
  }
  return round;
}

function legacyResult(raw, role) {
  // v3 results: {focus, observations: [string], questions: [string], frames?}
  const prefix = ROLE_PREFIX[role];
  const asText = item => (typeof item === 'string' ? item : item?.en);
  const observations = list(raw?.observations).map(asText).filter(item => typeof item === 'string');
  const questions = list(raw?.questions).map(asText).filter(item => typeof item === 'string');
  return normalizeRoleResult({
    focus: asText(raw?.focus),
    items: role === 'coordinator' ? [] : observations.map((text, index) => ({ id: `${prefix}${index + 1}`, criterion: 'other', text })),
    questions: role === 'socratic' ? questions.map((text, index) => ({ id: `${prefix}${index + 1}`, type: 'other', text })) : [],
    frames: list(raw?.frames),
    priorities: role === 'coordinator' ? observations.map((text, index) => ({ id: `R${index + 1}`, text, basedOn: [] })) : []
  }, role);
}

// Returns { state, dropped }: `dropped` names any part that could not be restored, so the app can
// back up the raw record and tell the learner instead of failing silently.
export function migrateState(saved) {
  const state = defaultState();
  const dropped = [];
  if (!isObject(saved)) return { state, dropped: saved ? ['record'] : [] };
  state.lang = saved.lang === 'en' ? 'en' : 'zh';
  state.data = attempt(() => restoreData(saved.data), blankData(), dropped, 'argument map');
  if (saved.version === 4) {
    state.page = typeof saved.page === 'string' ? saved.page.slice(0, 20) : 'frame';
    state.learnerCode = str(saved.learnerCode, LIMITS.learnerCode);
    state.task = saved.task ? attempt(() => validateTask(saved.task), null, dropped, 'teacher task') : null;
    state.rounds = list(saved.rounds).slice(-8).map((round, index) => attempt(() => restoreRound(round, index, dropped), null, dropped, `round ${index + 1}`)).filter(Boolean);
    state.current = state.rounds.length ? integer(saved.current, state.rounds.length - 1, 0, state.rounds.length - 1) : -1;
    state.transfer = str(saved.transfer, LIMITS.transfer);
    state.goalCheck = str(saved.goalCheck, LIMITS.transfer);
    state.disclosure = str(saved.disclosure, LIMITS.disclosure);
    if (isObject(saved.aiUse)) state.aiUse = { argumentor: saved.aiUse.argumentor !== false, languageTools: Boolean(saved.aiUse.languageTools), contentTools: Boolean(saved.aiUse.contentTools), otherTools: str(saved.aiUse.otherTools, LIMITS.otherTools), ownWords: Boolean(saved.aiUse.ownWords) };
    state.researchConsent = Boolean(saved.researchConsent);
    state.events = list(saved.events).filter(isObject).slice(-2000).map(event => ({ t: str(event.t, 40), type: str(event.type, 40), round: integer(event.round, 0, 0, 99), detail: str(event.detail, 160) }));
    state.createdAt = str(saved.createdAt, 40);
    state.savedAt = str(saved.savedAt, 40);
    return { state, dropped };
  }
  if (saved.version === 3) {
    // v3.1.x stored a single review; keep the learner's writing and convert the review into round 1.
    state.page = saved.page === 'reflect' ? 'revise' : (['frame', 'map', 'coach'].includes(saved.page) ? saved.page : 'frame');
    const results = {};
    for (const role of ROLES) {
      const converted = saved.results?.[role] ? attempt(() => legacyResult(saved.results[role], role), null, dropped, `v3 ${role}`) : null;
      if (converted) results[role] = converted;
    }
    const hasReview = Object.keys(results).length > 0;
    const hasRevision = typeof saved.revised === 'string' && saved.revised.trim();
    if (hasReview || hasRevision) {
      const round = newRound(1, saved.analysisInput ? attempt(() => validateInput(restoreData(saved.analysisInput)), null, dropped, 'v3 reviewed input') : null);
      round.results = results;
      round.status = ROLES.every(role => results[role]) ? 'complete' : (hasReview ? 'partial' : 'idle');
      round.startedAt = str(saved.resultAt, 40);
      round.meta = { runId: '', model: '', servedModel: '', promptVersion: 'v3', mode: 'multi', provider: 'DeepSeek', live: true, calls: 0, repairs: 0, tokens: 0, ms: 0, at: str(saved.resultAt, 40), appVersion: '3.x', params: null, consent: null };
      round.revised = typeof saved.revised === 'string' ? saved.revised.slice(0, LIMITS.revised) : '';
      round.note = str(saved.decision, LIMITS.note);
      round.revisions = list(saved.versions).filter(isObject).slice(-10).map(item => ({ at: str(item.at, 40), text: typeof item.revised === 'string' ? item.revised.slice(0, LIMITS.revised) : '', words: countWords(item.revised) }));
      state.rounds = [round];
      state.current = 0;
    }
    state.transfer = str(saved.transfer, LIMITS.transfer);
    return { state, dropped };
  }
  dropped.push('unknown record version');
  return { state, dropped };
}

// ---------- built-in learning example (not the recorded demo) ----------
export const EXAMPLE = {
  topic: 'Should universities permit generative AI in academic writing courses?',
  audience: 'University teaching committee',
  level: 'B2',
  claim: 'Universities should permit limited use of generative AI for planning in writing courses.',
  qualifier: 'This applies to planning and outlining only, provided that students disclose their use and remain responsible for the submitted text.',
  arguments: [
    {
      reason: 'Guided comparison can help students notice weaknesses in an outline before drafting.',
      evidence: 'In a planned classroom task, students compare an AI-generated outline with their own outline and annotate unsupported links.',
      evidenceType: 'planned',
      source: 'Teacher-designed classroom task; evidence still needs to be collected.',
      warrant: 'Making the comparison explicit may direct students’ attention to the relationship between claims, reasons, and evidence.'
    },
    { reason: 'Disclosure requirements can make the writing process more transparent to teachers and students.', evidence: '', evidenceType: '', source: '', warrant: '' }
  ],
  counters: [{ target: 'Claim', counter: 'A teacher may object that permitting AI makes it harder to determine whose reasoning is being assessed.', strategy: '', response: '' }],
  draft: 'Universities should permit limited use of generative AI for planning in writing courses. Students can compare an AI outline with their own and identify unsupported reasoning. However, teachers may find it difficult to determine who produced the ideas. For this reason, students should disclose how they used AI and remain responsible for the submitted text.'
};
