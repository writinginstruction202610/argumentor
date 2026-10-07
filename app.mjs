// app.mjs — the learner interface: five steps, Socratic dialogue, revision desk, revision check,
// demo replay, persistence, privacy safeguards and research event logging.
import {
  APP_VERSION, CONSENT_VERSION, ROLES, LEVELS, LIMITS, MAX_ARGUMENTS, MAX_COUNTERS, MAX_LEARNER_TURNS, CRITERIA, QUESTION_TYPES, SCHEMES,
  EVIDENCE_TYPES, STRATEGIES, DECISIONS, CHECK_STATUS, MOVES, AI_USE_LEVELS, TOPIC_PACKS, GLOSSARY, EXAMPLE,
  defaultState, newRound, blankArgument, blankCounter, validateInput, validateLearnerText, validateSelfAssessment, validateTask,
  normalizeRoleResult, migrateState, sameInput, changedFields, fieldCompletion, checkSourceQuotes, selfAssessmentOptions,
  countWords, screenPII, redactPII, englishIssue, learnerFields
} from './core.mjs';
import { html, raw } from './html.mjs';
import { t, tx, setLang, STEPS, ROLE_NAMES, ROLE_HELP, ROLE_SHORT, LABELS, fieldLabel, targetLabel, CHECK_LABELS, CHECK_TONE, ERRORS, PII_TYPES, CONSENT_NOTICE, glossify } from './i18n.mjs';
import * as api from './api.mjs';
import { wordDiff, diffStats } from './diff.mjs';
import { buildRecord, reportHTML, fileName } from './report.mjs';
import { teacherPage, teacherClick, teacherInput, teacherChange } from './teacher.mjs';

const STORAGE = 'argumentor-v4';
const LEGACY = 'argumentor-course-v3';
const PORTFOLIO = 'argumentor-portfolio-v1';
const PUBLIC_FLAG = 'argumentor-public-mode';
const CONSENT_KEY = 'argumentor-consent';
const DEMO_URL = './demo/workplace-ai-monitoring.json'; // relative, so it works under a project-site subpath (…github.io/argumentor/)

let state = defaultState();
let service = { configured: false, online: false, live: true, model: '', mode: 'multi', provider: 'DeepSeek', accessCodeRequired: false, keyInProjectFolder: false, remainingCalls: 0 };
const ui = {
  busy: null, pending: null, statuses: {}, error: null, fieldError: null, queue: 0, aborter: null,
  consent: readConsent(), selfDraft: { element: '', reason: '', question: '' }, framesRequested: false,
  replyDrafts: {}, threadErrors: {}, openClarify: {}, showDiff: false, liveMessage: '',
  demo: null, crossTab: false, storageError: false, restoreNotice: null, checkError: null,
  openDetails: new Set()
};
// <details> is uncontrolled, so a re-render would collapse it. Panels carry data-details="<key>" and the
// capture listener below records which keys are open, so render() can restore them.
const detailsAttrs = key => raw(`data-details="${key}"${ui.openDetails.has(key) ? ' open' : ''}`);
let lastWritten = '';
let saveTimer = null;
let confirmAction = null;

const $ = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();

// ---------- persistence ----------
function publicMode() { try { return localStorage.getItem(PUBLIC_FLAG) === '1'; } catch { return false; } }
function store() { return publicMode() ? sessionStorage : localStorage; }
function readConsent() {
  try { const value = JSON.parse(sessionStorage.getItem(CONSENT_KEY) || 'null'); return value?.version === CONSENT_VERSION ? value : null; } catch { return null; }
}
function writeSave() {
  if (ui.demo || ui.crossTab) return;
  state.savedAt = nowIso();
  if (!state.createdAt) state.createdAt = state.savedAt;
  try {
    lastWritten = JSON.stringify(state);
    store().setItem(STORAGE, lastWritten);
    ui.storageError = false;
  } catch {
    if (!ui.storageError) notify('浏览器无法保存，请及时导出学习记录。', 'Browser storage is unavailable; export your record regularly.');
    ui.storageError = true;
  }
}
function save(immediate = false) {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (immediate) writeSave();
  else saveTimer = setTimeout(writeSave, 300);
}
// Backups and the portfolio follow the same rule as the record itself: in public-computer mode they must
// not touch localStorage, or they would outlive the browser session the banner promises to clear.
function backupRaw(raw) { try { store().setItem(`argumentor-backup-${Date.now()}`, raw); } catch { /* storage full */ } }
function forgetEverything() {
  for (const area of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(area)) if (key === STORAGE || key === LEGACY || key === PORTFOLIO || key.startsWith('argumentor-backup-')) area.removeItem(key);
    } catch { /* storage unavailable */ }
  }
}
function load() {
  let raw = null;
  let legacy = false;
  try {
    raw = store().getItem(STORAGE);
    if (!raw && !publicMode()) { raw = localStorage.getItem(LEGACY); legacy = Boolean(raw); }
  } catch { ui.storageError = true; }
  if (!raw) return;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { backupRaw(raw); ui.restoreNotice = ['record']; return; }
  const { state: restored, dropped } = migrateState(parsed);
  if (dropped.length) { backupRaw(raw); ui.restoreNotice = dropped; }
  state = restored;
  lastWritten = raw;
  if (legacy) { logEvent('migrated', 'v3 record'); save(true); }
}
function portfolio() { try { return JSON.parse(store().getItem(PORTFOLIO) || '[]'); } catch { return []; } }
function lastGoal() { const entry = portfolio().filter(item => String(item?.transfer || '').trim()).at(-1); return entry ? String(entry.transfer).slice(0, 300) : ''; }

// Reply drafts, thread errors and open clarify boxes are keyed by item id (A1, Q1, R1 …), and those ids are
// reused every round, so they must be cleared whenever the round or the whole task changes.
function resetRoundUI() {
  ui.selfDraft = { element: '', reason: '', question: '' };
  ui.replyDrafts = {};
  ui.threadErrors = {};
  ui.openClarify = {};
  ui.framesRequested = false;
  ui.showDiff = false;
  ui.checkError = null;
  ui.prerunOpen = null;
}

function logEvent(type, detail = '') {
  if (ui.demo) return;
  state.events.push({ t: nowIso(), type, round: state.rounds.at(-1)?.id || 0, detail: String(detail).slice(0, 160) });
  if (state.events.length > 2000) state.events = state.events.slice(-2000);
}

// ---------- helpers ----------
function notify(zh, en) {
  const toast = $('toast');
  toast.textContent = t(zh, en);
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
}
const errorText = code => tx(ERRORS[code] || ERRORS.CONNECTION_ERROR);
const latestRound = () => state.rounds.at(-1) || null;
const viewedRound = () => ui.pending || state.rounds[state.current] || null;
const viewingLatest = () => !ui.pending && state.current === state.rounds.length - 1;
const safeSnapshot = () => { try { return validateInput(state.data); } catch { return null; } };
const priorities = round => round?.results?.coordinator?.priorities || [];
const idOf = path => `f-${path.replace(/\./g, '-')}`;
const stamp = value => { const date = new Date(value); return Number.isNaN(+date) ? '' : date.toLocaleString(state.lang === 'zh' ? 'zh-CN' : 'en-GB', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const allowChineseReflection = () => state.task?.reflectionLanguage !== 'english';

function getPath(scope, path) {
  if (scope === 'data') return path.split('.').reduce((value, key) => value?.[key], state.data);
  if (scope === 'state') return state[path];
  if (scope === 'self') return ui.selfDraft[path];
  if (scope === 'reply') return ui.replyDrafts[path] || '';
  if (scope === 'decision') return latestRound()?.decisions?.[path]?.reason || '';
  if (scope === 'takeaway') return latestRound()?.dialogue?.[path]?.takeaway || '';
  if (scope === 'round') return latestRound()?.[path] || '';
  if (scope === 'aiUse') return state.aiUse[path];
  return '';
}
function setPath(scope, path, value) {
  if (scope === 'data') {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((object, key) => object[key], state.data);
    target[last] = value;
  } else if (scope === 'state') state[path] = value;
  else if (scope === 'self') ui.selfDraft[path] = value;
  else if (scope === 'reply') ui.replyDrafts[path] = value;
  else if (scope === 'decision') {
    const round = latestRound();
    round.decisions[path] = { ...(round.decisions[path] || { decision: '' }), reason: value, at: nowIso() };
  } else if (scope === 'takeaway') {
    const round = latestRound();
    round.dialogue[path] = { ...(round.dialogue[path] || { kind: 'question', closed: true, turns: [] }), takeaway: value };
  } else if (scope === 'round') latestRound()[path] = value;
  else if (scope === 'aiUse') state.aiUse[path] = value;
}

// ---------- small view helpers ----------
const button = (action, zh, en, cls = 'btn', attrs = '') => html`<button type="button" class="${cls}" data-act="${action}" ${raw(attrs)}>${t(zh, en)}</button>`;
const tag = (text, cls = '') => html`<span class="tag ${cls}">${text}</span>`;
const heading = (number, zh, en, subZh, subEn) => html`<div class="section-head"><div><div class="eyebrow">${t('学习工作区', 'LEARNING STUDIO')}</div><h2>${t(zh, en)}</h2><p>${t(subZh, subEn)}</p></div><span class="chapter">0${number}</span></div>`;

function field(path, { scope = 'data', input = false, rows = 0, help = null, placeholder = '', optional = false, readonly = false, english = true, limit = 0, labelText = null } = {}) {
  const id = idOf(scope === 'data' ? path : `${scope}-${path}`);
  const value = getPath(scope, path) ?? '';
  const key = path.split('.').at(-1);
  const max = limit || LIMITS[key] || 1500;
  const error = ui.fieldError && ui.fieldError.path === path && ui.fieldError.scope === scope ? ui.fieldError : null;
  const describedBy = [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  const common = raw(`id="${id}" data-scope="${scope}" data-path="${path}" maxlength="${max}" ${english ? 'lang="en" spellcheck="true"' : ''} ${readonly ? 'readonly' : ''} ${describedBy ? `aria-describedby="${describedBy}"` : ''} ${error ? 'aria-invalid="true"' : ''}`);
  const labelHtml = labelText ?? tx(LABELS[key] || { zh: key, en: key });
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="${id}">${labelHtml}${optional ? html` <small>${t('选填', 'optional')}</small>` : ''}${!labelText && state.lang === 'zh' && LABELS[key] ? html` <small>${LABELS[key].en}</small>` : ''}</label>
    ${input ? html`<input ${common} value="${value}" placeholder="${placeholder}">` : html`<textarea ${common} rows="${rows || 3}" placeholder="${placeholder}">${value}</textarea>`}
    ${help ? html`<p class="help" id="${id}-help">${tx(help)}</p>` : ''}
    ${error ? html`<p class="field-error" id="${id}-error" role="alert">${error.message}</p>` : ''}
  </div>`;
}

function select(path, options, { scope = 'data', labelText, help = null } = {}) {
  const id = idOf(scope === 'data' ? path : `${scope}-${path}`);
  const value = getPath(scope, path) ?? '';
  const error = ui.fieldError && ui.fieldError.path === path && ui.fieldError.scope === scope ? ui.fieldError : null;
  const describedBy = [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return html`<div class="field ${error ? 'has-error' : ''}"><label for="${id}">${labelText}</label>
    <select id="${id}" data-scope="${scope}" data-path="${path}" ${describedBy ? raw(`aria-describedby="${describedBy}"`) : ''} ${error ? raw('aria-invalid="true"') : ''}>
      ${options.map(([optionValue, text]) => html`<option value="${optionValue}" ${optionValue === value ? raw('selected') : ''}>${text}</option>`)}
    </select>${help ? html`<p class="help" id="${id}-help">${tx(help)}</p>` : ''}${error ? html`<p class="field-error" id="${id}-error" role="alert">${error.message}</p>` : ''}</div>`;
}

function anchorQuote(item) {
  if (!item?.anchor) return '';
  return html`<button type="button" class="anchor" data-act="goto-field" data-path="${item.anchorField || ''}" title="${t('在论证地图中查看', 'Show in my map')}"><span aria-hidden="true">“</span><span lang="en">${item.anchor}</span><span aria-hidden="true">”</span><small>${fieldLabel(item.anchorField)}</small></button>`;
}

// ---------- header, navigation, side panel ----------
function header() {
  const ready = service.configured;
  const live = service.live !== false;
  return html`<header class="header">
    <div class="brand"><div class="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 24V8M8 16H22M22 16V8M22 16V24" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="8" cy="24" r="3" fill="currentColor"/><circle cx="22" cy="8" r="3" fill="currentColor"/><circle cx="22" cy="24" r="3" fill="currentColor"/></svg></div>
      <div><div class="brand-name">${t('论证工坊', 'ArguMentor')}</div><div class="brand-sub">${t('ARGUMENTOR · 学习者的思维伙伴', 'ARGUMENT STUDIO · 论证工坊')} · v${APP_VERSION}</div></div></div>
    <div class="header-actions">
      <button type="button" class="badge ${ready ? 'ready' : ''} ${ready && !live ? 'mock' : ''}" data-act="setup"><i class="dot"></i>${ready ? (live ? `DeepSeek · ${service.model}` : t('离线模板模式', 'Offline template mode')) : t('DeepSeek 未配置', 'DeepSeek not configured')}</button>
      ${button(state.page === 'guide' ? 'frame' : 'guide', state.page === 'guide' ? '返回工坊' : '使用指南', state.page === 'guide' ? 'Back to studio' : 'Guide', 'link-button')}
      ${button(state.page === 'teacher' ? 'frame' : 'teacher', state.page === 'teacher' ? '返回学习' : '教师', state.page === 'teacher' ? 'Back to learning' : 'Teacher', 'link-button')}
      <div class="lang" role="group" aria-label="Language"><button type="button" data-lang="zh" aria-pressed="${String(state.lang === 'zh')}">中文</button><button type="button" data-lang="en" aria-pressed="${String(state.lang === 'en')}">EN</button></div>
    </div></header>`;
}

function progress() {
  const round = latestRound();
  const dialogueCount = round ? Object.values(round.dialogue).filter(thread => thread.kind !== 'feedback' && thread.turns.some(turn => turn.from === 'learner')).length : 0;
  return [
    Boolean(state.data.topic.trim() && state.data.claim.trim()),
    Boolean(state.data.arguments.some(item => item.reason.trim())),
    Boolean(round && round.results.analyst && dialogueCount > 0),
    Boolean(round && round.revised.trim() && priorities(round).every(item => round.decisions[item.id]?.decision)),
    Boolean(round?.check && state.transfer.trim())
  ];
}

function navigation() {
  const done = progress();
  return html`<nav class="navigation" aria-label="${t('学习流程', 'Learning steps')}">
    <div class="nav-label">${t('学习流程 / WORKFLOW', 'YOUR WORKFLOW')}</div>
    ${STEPS.map(([id, name, en], index) => html`<button type="button" class="nav-step ${state.page === id ? 'active' : ''} ${done[index] ? 'done' : ''}" data-act="${id}" ${state.page === id ? raw('aria-current="step"') : ''}>
      <span class="number">${done[index] ? '✓' : index + 1}</span><span><b>${tx(name)}</b><small>${en}</small></span></button>`)}
    <div class="nav-foot">
      ${button('setup', '◌ 连接与模型', '◌ Connection', 'link-button')}
      ${button('export-html', '↓ 导出学习报告', '↓ Export report', 'link-button')}
      ${button('glossary', 'Aa 术语表', 'Aa Glossary', 'link-button')}
      ${button('toggle-public', publicMode() ? '◉ 公用电脑模式：开' : '○ 公用电脑模式：关', publicMode() ? '◉ Public computer: on' : '○ Public computer: off', 'link-button')}
      ${button('new-task', '＋ 开始新任务', '＋ Start a new task', 'link-button', ui.busy ? 'disabled' : '')}
      ${button('clear', '清空本机记录', 'Clear local record', 'link-button danger', ui.busy ? 'disabled' : '')}
      <p>${t('追问发生在对话中，改写由你完成。', 'Questions happen in dialogue; rewriting is yours.')}</p>
    </div></nav>`;
}

function sidePanel() {
  const rows = fieldCompletion(state.data);
  const filled = rows.filter(row => row.filled).length;
  const done = progress();
  const narration = ui.demo?.narration?.[state.page];
  const round = latestRound();
  return html`
    ${narration ? html`<section class="side-card narration"><h3>${t('演示解说', 'Demo narration')}</h3>${(narration[state.lang] || narration.en || []).map(line => html`<p>${line}</p>`)}</section>` : ''}
    <section class="side-card"><h3>${t('论证要素', 'Argument elements')} <small>${filled}/${rows.length}</small></h3>
      ${rows.map(row => html`<div class="checkline"><span>${row.index === undefined ? '' : `${row.key === 'counter' || row.key === 'response' ? t('异议', 'Counter') : t('理由', 'Reason')} ${row.index + 1} · `}${tx(LABELS[row.key])}${row.optional ? html` <small>${t('选填', 'opt.')}</small>` : ''}</span><span class="${row.filled ? 'filled' : ''}">${row.filled ? t('✓ 已填写', '✓ Entered') : t('待补充', 'Not yet')}</span></div>`)}
      <p>${t('这里只检查是否填写，不是分数。', 'This checks completion only; it is not a score.')}</p></section>
    <section class="side-card"><h3>${t('学习过程', 'Learning process')}</h3>
      ${STEPS.map(([, name], index) => html`<div class="checkline"><span>${index + 1}. ${tx(name)}</span><span class="${done[index] ? 'filled' : ''}">${done[index] ? t('✓ 已完成', '✓ Done') : t('进行中', 'Open')}</span></div>`)}
      ${round ? html`<p>${t('当前第', 'Round ')}${round.id}${t(' 轮', '')} · ${round.meta?.live === false ? t('离线模板', 'offline template') : (round.meta?.model || '')}</p>` : ''}</section>
    <section class="side-note"><h3>${t('诚信表达 · 理性讨论', 'Integrity · Thoughtful dialogue')}</h3><p>${t('AI 只提问和指出问题，不替你写作；它可能出错。核查证据，公正表述不同观点，并对最终文本负责。', 'The AI asks and points; it never writes for you, and it can be wrong. Check evidence, represent other views fairly, and own your final text.')}</p></section>`;
}

function banners() {
  const list = [];
  if (ui.demo) {
    const meta = ui.demo.meta || {};
    list.push(html`<div class="demo-banner" role="status"><div><strong>${t('演示回放', 'Demo replay')}</strong> · ${t(`模拟学习者（由 AI 助手扮演）完成“${meta.topicZh || '职场AI监控'}”议论文。智能体输出录制自真实 DeepSeek 运行（${meta.recordedAt || ''}，${meta.model || ''}）。在此的操作不会保存。`, `A simulated EFL learner (role-played by an AI assistant) works on “${meta.topicEn || 'AI monitoring at work'}”. Agent outputs were recorded from real DeepSeek runs (${meta.recordedAt || ''}, ${meta.model || ''}). Nothing here is saved.`)}</div>${button('exit-demo', '退出演示', 'Exit demo', 'btn small')}</div>`);
  }
  if (ui.crossTab) list.push(html`<div class="warning-banner" role="alert">${t('此记录已在另一个标签页中修改。为避免覆盖，本页已暂停保存。', 'This record was changed in another tab. Saving is paused here to avoid overwriting it.')} ${button('reload', '重新载入', 'Reload', 'btn small')}</div>`);
  if (ui.restoreNotice) list.push(html`<div class="warning-banner" role="alert">${t('部分旧记录无法恢复，原始数据已备份在浏览器中：', 'Some saved parts could not be restored; the raw record was backed up in this browser: ')}${ui.restoreNotice.join(', ')} ${button('dismiss-restore', '知道了', 'OK', 'btn small secondary')}</div>`);
  if (publicMode() && !ui.demo) list.push(html`<div class="info-banner">${t('公用电脑模式：关闭浏览器后记录会被删除，请在离开前导出。', 'Public computer mode: the record is deleted when the browser closes. Export before you leave.')}</div>`);
  if (service.live === false && service.configured && !ui.demo) list.push(html`<div class="info-banner">${t('当前为离线模板模式：反馈由固定模板生成，不是 AI 反馈，仅用于测试和练习流程。', 'Offline template mode: feedback comes from fixed templates, not AI. Use it only to test or practise the workflow.')}</div>`);
  return list;
}

// ---------- Step 1: frame ----------
function taskCard(task) {
  return html`<section class="task-card">
    <div class="task-head"><div><span class="eyebrow">${t('教师任务', 'TEACHER TASK')}</span><h3>${task.title}</h3></div>${ui.demo ? '' : button('remove-task', '移除任务', 'Remove task', 'link-button danger')}</div>
    ${task.instructions ? html`<p>${task.instructions}</p>` : ''}
    ${task.requirements.length ? html`<ul>${task.requirements.map(item => html`<li>${item}</li>`)}</ul>` : ''}
    <p class="fine">${task.wordMax ? `${t('字数', 'Length')}: ${task.wordMin}–${task.wordMax} ${t('词', 'words')} · ` : ''}${t('AI 使用规则', 'AI-use rule')}: ${tx(AI_USE_LEVELS[task.aiUse])}${task.sources.length ? ` · ${t('教师材料', 'Sources')}: ${task.sources.length}` : ''}${task.minDialogue ? ` · ${t('至少回答追问', 'Answer at least')} ${task.minDialogue}${t(' 个', ' question(s)')}` : ''}</p>
    ${task.teacherNote ? html`<p class="teacher-note">${task.teacherNote}</p>` : ''}
  </section>`;
}

function framePage() {
  const task = state.task;
  const lock = Boolean(task?.lockTopic);
  const goal = lastGoal();
  return html`${heading(1, '明确英语写作任务', 'Frame the English writing task', '确定议题、受众与可论证的核心主张。', 'Define the question, the audience and an arguable claim.')}
    ${goal ? html`<div class="goal-card"><b>${t('你上次给自己定的写作目标', 'The goal you set at the end of your last task')}</b><p lang="en">${goal}</p><small>${t('写作时留意它；最后一步会请你自己判断是否做到。', 'Keep it in mind; at the end you will judge for yourself whether you applied it.')}</small></div>` : ''}
    ${task ? taskCard(task) : ''}
    <div class="toolbar">
      ${button('import-task', '载入教师任务文件', 'Load a teacher task file', 'btn secondary small')}
      ${button('example', '载入教学示例', 'Load the teaching example', 'btn secondary small', ui.busy ? 'disabled' : '')}
      ${button('demo', '观看完整演示', 'Watch the full demo', 'btn secondary small')}
      <input type="file" id="task-file" accept=".json,application/json" hidden>
    </div>
    ${lock ? '' : html`<div class="topics" role="group" aria-label="${t('示例议题', 'Starter topics')}">${Object.entries(TOPIC_PACKS).map(([key, pack]) => button(`topic-${key}`, pack.label.zh, pack.label.en, 'topic-button'))}</div>`}
    ${field('topic', { input: true, readonly: lock, help: { zh: '用英语写出一个可以依据事实和理由讨论的问题。', en: 'Write a question in English that can be discussed with evidence and reasons.' }, placeholder: 'e.g. Should employers be allowed to use AI to monitor employees?' })}
    <div class="row">
      ${field('audience', { input: true, readonly: lock && Boolean(task?.audience), help: { zh: '明确谁将阅读并被说服，例如公司管理层或大学委员会。', en: 'Who will read and needs to be persuaded? For example, company managers or a university committee.' }, placeholder: 'e.g. Managers at a mid-sized company' })}
      ${select('level', LEVELS.map(level => [level, `${level} · ${level === 'B1' ? t('较多支架', 'More guidance') : level === 'B2' ? t('适度支架', 'Moderate guidance') : t('精细表达', 'Nuanced expression')}`]), { labelText: tx(LABELS.level), help: { zh: '只调整反馈的措辞与语言支架，不改变诊断，也不是能力测评。', en: 'Changes wording and language scaffolding only, never the diagnosis; it is not a test.' } })}
    </div>
    ${field('claim', { rows: 3, help: { zh: '用英语给出你的明确回答。', en: 'Give your clear answer in English.' }, placeholder: 'I argue that … because …' })}
    ${field('qualifier', { rows: 2, optional: true, help: { zh: '在什么条件、范围或程度上你的主张成立？限定能让主张更站得住。', en: 'Under what conditions, scope or degree does your claim hold? A qualifier makes a claim easier to defend.' }, placeholder: 'This applies only when … / unless …' })}
    <div class="learning-agreement">${t('学习约定：论证与修订用英语完成；独立思考，核查来源，如实说明 AI 使用，并对最终文本负责。', 'Learning agreement: write your argument and revisions in English; think independently, verify sources, disclose AI use, and take responsibility for your final text.')}</div>
    <div class="actions"><span class="fine">${t('界面可中英切换；论证写作与 AI 反馈均使用英语。', 'The interface is bilingual; argument writing and AI feedback are in English.')}</span>${button('to-map', '构建论证 →', 'Build the argument →')}</div>`;
}

// ---------- Step 2: map ----------
function argumentUnit(unit, index, checks) {
  const prefix = `arguments.${index}`;
  const unitChecks = checks.filter(item => item.unit === index);
  return html`<section class="argument-unit" id="unit-${index}">
    <div class="argument-head"><div><span>${t('论证单元', 'ARGUMENT UNIT')}</span><h3>${t('支持理由', 'Supporting reason')} ${index + 1}</h3></div>${state.data.arguments.length > 1 ? button(`remove-argument-${index}`, '移除此理由', 'Remove reason', 'link-button danger') : ''}</div>
    ${field(`${prefix}.reason`, { rows: 2, help: { zh: '一个理由承担一项清晰的支持任务。', en: 'Give this reason one clear supporting job.' }, placeholder: 'One reason is that …' })}
    <div class="row">
      ${field(`${prefix}.evidence`, { rows: 3, help: { zh: '填写可核查的材料；引用原文请加引号。若只是计划或假设，请如实选择证据类型。', en: 'Use checkable material; put quoted words in quotation marks. If it is only planned or hypothetical, say so in the evidence type.' }, placeholder: 'According to … / One relevant case is …' })}
      <div>
        ${select(`${prefix}.evidenceType`, [['', t('请选择证据类型', 'Choose an evidence type')], ...Object.entries(EVIDENCE_TYPES).map(([key, value]) => [key, tx(value)])], { labelText: tx(LABELS.evidenceType) })}
        ${field(`${prefix}.source`, { input: true, english: false, help: { zh: '作者、标题、链接，或教师材料编号（如 S1）。可写中文文献题名。', en: 'Author, title, link, or a teacher source ID such as S1. Chinese titles are fine.' }, placeholder: 'Author, title, URL, or S1' })}
      </div>
    </div>
    ${field(`${prefix}.warrant`, { rows: 2, help: { zh: '说明两层联系：证据为什么能证明这个理由，以及这个理由为什么支持你的主张。', en: 'Explain both links: why the evidence shows the reason is true, and why the reason supports your claim.' }, placeholder: 'This shows … because …; this matters for my claim because …' })}
    ${unitChecks.length ? html`<div class="quote-checks">${unitChecks.map(item => html`<span class="quote-check ${item.status}">${item.status === 'found' ? `✓ ${t('引文见于', 'Quote found in')} ${item.sourceId}` : item.status === 'unknown-source' ? `⚠ ${t('没有这份材料', 'No such source')}: ${item.sourceId}` : `✗ ${t('引文未在材料中找到', 'Quote not found in')} ${item.sourceId}`}${item.quote ? html` <q lang="en">${item.quote.slice(0, 60)}${item.quote.length > 60 ? '…' : ''}</q>` : ''}</span>`)}</div>` : ''}
  </section>`;
}

function counterUnit(unit, index) {
  const prefix = `counters.${index}`;
  const targets = [['Claim', t('整个主张', 'The whole claim')], ...state.data.arguments.map((item, i) => [`Reason ${i + 1}`, `${t('理由', 'Reason')} ${i + 1}`])];
  return html`<section class="argument-unit counter-unit" id="counter-${index}">
    <div class="argument-head"><div><span>${t('回应异议', 'ADDRESS AN OBJECTION')}</span><h3>${t('不同观点', 'Counterargument')} ${index + 1}</h3></div>${state.data.counters.length > 1 ? button(`remove-counter-${index}`, '移除', 'Remove', 'link-button danger') : ''}</div>
    ${select(`${prefix}.target`, targets, { labelText: tx(LABELS.counterTarget) })}
    ${field(`${prefix}.counter`, { rows: 2, help: { zh: '用对方会认可的方式表述最有力的异议，而不是弱化它。', en: 'State the strongest objection in terms its supporters would accept, not a weak version.' }, placeholder: 'An informed critic might argue that …' })}
    ${select(`${prefix}.strategy`, [['', t('请选择回应策略', 'Choose a strategy')], ...Object.entries(STRATEGIES).map(([key, value]) => [key, tx(value)])], { labelText: tx(LABELS.strategy), help: { zh: '反驳：说明它不成立；让步：承认合理之处；权衡：比较轻重；限定：缩小主张范围。', en: 'Rebut: show it fails. Concede: accept what is right. Weigh: compare. Qualify: narrow your claim.' } })}
    ${field(`${prefix}.response`, { rows: 3, placeholder: 'This concern is valid insofar as …; however, …' })}
  </section>`;
}

function topicLanguage() {
  const pack = Object.values(TOPIC_PACKS).find(item => item.topic === state.data.topic.trim());
  const vocabulary = state.task?.vocabulary?.length ? state.task.vocabulary : pack?.vocabulary;
  if (!vocabulary?.length) return '';
  return html`<details class="details vocab" ${detailsAttrs('vocab')}><summary>${t('议题语言（双方都可使用的中性词汇）', 'Topic language (neutral words for either side)')}</summary>
    <table><tbody>${vocabulary.map(([term, zh, note]) => html`<tr><td lang="en"><b>${term}</b></td><td>${zh}</td><td lang="en">${note}</td></tr>`)}</tbody></table>
    <p class="fine">${t('这是语言支持，不是论点。是否使用、如何使用由你决定。', 'This is language support, not arguments. Whether and how you use it is up to you.')}</p></details>`;
}

function sourcePackView() {
  const sources = state.task?.sources || [];
  if (!sources.length) return '';
  return html`<details class="details sources" ${detailsAttrs('sources')}><summary>${t('教师提供的材料（引用时在“来源”中写编号）', 'Teacher sources (write the ID in the Source field when you use one)')}</summary>
    ${sources.map(item => html`<article class="source-item"><b>${item.id}</b> ${item.title}${item.kind ? html` <span class="tag">${item.kind}</span>` : ''}<p lang="en">${item.text}</p></article>`)}
    <p class="fine">${t('如果在证据中加引号引用原文，系统会自动核对引文是否真的出自该材料。', 'If you quote a source in your evidence, the tool checks automatically whether the quoted words really appear in it.')}</p></details>`;
}

function mapPage() {
  const checks = checkSourceQuotes(state.data, state.task?.sources || []);
  const words = countWords(state.data.draft);
  const task = state.task;
  return html`${heading(2, '用多个理由构建论证', 'Build the argument with several reasons', '每个理由分别连接证据、来源与推理联系；再正面回应最有力的异议。', 'Connect each reason to its own evidence, source and warrant; then answer the strongest objection.')}
    <div class="callout">${t('理由不是越多越好。保留能够独立支持主张、且有证据可发展的理由。', 'More reasons are not automatically better. Keep reasons that independently support the claim and can be developed with evidence.')}</div>
    ${sourcePackView()}
    ${field('claim', { rows: 2, help: { zh: '与第 1 步同步。', en: 'Shared with Step 1.' } })}
    ${state.data.qualifier ? html`<p class="qualifier-note"><b>${t('限定', 'Qualifier')}:</b> <span lang="en">${state.data.qualifier}</span></p>` : ''}
    <div id="argument-units">${state.data.arguments.map((unit, index) => argumentUnit(unit, index, checks))}</div>
    ${state.data.arguments.length < MAX_ARGUMENTS ? button('add-argument', '＋ 添加一个支持理由', '＋ Add another reason', 'btn secondary') : ''}
    <div class="counter-block">${state.data.counters.map(counterUnit)}${state.data.counters.length < MAX_COUNTERS ? button('add-counter', '＋ 添加另一条异议', '＋ Add another objection', 'btn secondary') : ''}</div>
    ${topicLanguage()}
    ${field('draft', { rows: 9, optional: true, help: { zh: '选填。只粘贴你自己写的英语文本，不写个人身份信息。', en: 'Optional. Paste only your own English writing and leave out personal identifiers.' }, placeholder: 'Paste or write your English draft here …' })}
    <p class="word-count" id="wc-draft">${words} ${t('词', 'words')}${task?.wordMax ? ` · ${t('任务要求', 'Task')} ${task.wordMin}–${task.wordMax}` : ''}</p>
    <div class="actions">${button('frame', '← 明确任务', '← Frame', 'btn secondary')}${button('to-coach', '进入追问对话 →', 'Go to questions & dialogue →')}</div>`;
}

// ---------- Step 3: coach ----------
function roundTabs() {
  if (state.rounds.length < 2 && !ui.pending) return '';
  return html`<div class="round-tabs" role="tablist" aria-label="${t('反馈轮次', 'Feedback rounds')}">
    ${state.rounds.map((round, index) => html`<button type="button" role="tab" aria-selected="${String(!ui.pending && state.current === index)}" data-act="view-round" data-index="${index}">${t('第', 'Round ')}${round.id}${t(' 轮', '')}${round.status === 'partial' ? ' ⚠' : ''}</button>`)}
    ${ui.pending ? html`<button type="button" role="tab" aria-selected="true" disabled>${t('第', 'Round ')}${ui.pending.id}${t(' 轮（进行中）', ' (running)')}</button>` : ''}
  </div>`;
}

function preRunPanel() {
  const last = latestRound();
  const snapshot = safeSnapshot();
  const changes = last?.input && snapshot ? changedFields(last.input, snapshot) : null;
  const unchanged = Boolean(last?.input && snapshot && sameInput(last.input, snapshot));
  const options = selfAssessmentOptions(state.data);
  const notice = CONSENT_NOTICE[state.lang] || CONSENT_NOTICE.en;
  const blockedReason = !service.configured ? errorText('NOT_CONFIGURED') : unchanged ? errorText('NO_CHANGES') : !ui.consent ? errorText('CONSENT_REQUIRED') : '';
  const open = ui.prerunOpen ?? (!last || !unchanged || ui.busy === 'review' || ui.fieldError?.scope === 'self');
  return html`<details class="prerun" ${open ? raw('open') : ''}>
    <summary data-act="toggle-prerun"><h3 id="prerun-title">${last ? `${t('准备第', 'Prepare round ')}${last.id + 1}${t(' 轮反馈', '')}` : t('准备第 1 轮反馈', 'Prepare round 1')}</h3>${last && !open ? html`<span class="fine">${unchanged ? t('（修改论证或初稿后再展开）', '(revise your map or draft first, then open)') : t('（点击展开）', '(click to open)')}</span>` : ''}</summary>
    ${changes ? html`<div class="changes ${unchanged ? 'none' : ''}">${unchanged ? errorText('NO_CHANGES') : html`<b>${t('自第', 'Changed since round ')}${last.id}${t(' 轮以来的修改', '')}:</b> ${changes.slice(0, 8).map(path => tag(fieldLabel(path)))}${changes.length > 8 ? ` +${changes.length - 8}` : ''}`}</div>` : ''}
    <div class="self-assess">
      <p class="self-intro"><b>${t('先自己判断：', 'Judge first:')}</b> ${t('在看 AI 反馈之前，选出你认为最需要加强的部分。分析角色会先回应你的判断。', 'Before seeing AI feedback, pick the part you think is weakest. The analyst will respond to your judgement first.')}</p>
      ${select('element', [['', t('请选择', 'Choose…')], ...options.map(([value, label]) => [value, targetLabelFull(label)])], { scope: 'self', labelText: tx(LABELS.selfElement) })}
      ${field('reason', { scope: 'self', rows: 2, labelText: tx(LABELS.selfReason), placeholder: 'I think … because …', limit: LIMITS.selfReason })}
      ${field('question', { scope: 'self', rows: 1, input: true, labelText: tx(LABELS.selfQuestion), placeholder: 'Is my … strong enough?', limit: LIMITS.selfQuestion })}
      ${last && state.data.level !== 'B1' ? html`<label class="check-row"><input type="checkbox" data-act="toggle-frames" ${ui.framesRequested ? raw('checked') : ''}> ${t('本轮也请提供句子框架（第 2 轮起默认减少语言支架）', 'Include sentence frames this round (from round 2, language scaffolding fades by default)')}</label>` : ''}
    </div>
    <details class="consent-notice" ${detailsAttrs('consent')}><summary>${t('数据说明（版本 ', 'Data notice (version ')}${CONSENT_VERSION})</summary>${notice.map(line => html`<p>${line}</p>`)}</details>
    <label class="check-row consent"><input type="checkbox" id="consent" ${ui.consent ? raw('checked') : ''} ${ui.busy ? raw('disabled') : ''}> ${t('我已阅读数据说明，同意在本次学习中把提交的文本发送给 DeepSeek；其中不含个人身份信息。', 'I have read the data notice and agree that the text I submit in this session may be sent to DeepSeek. It contains no personal identifiers.')}</label>
    <div class="connection ${service.configured ? 'ready' : ''}"><span class="dot"></span><div><strong>${service.configured ? (service.live === false ? t('离线模板模式', 'Offline template mode') : `DeepSeek · ${service.model}`) : t('DeepSeek 尚未配置', 'DeepSeek not configured')}</strong><small>${service.configured ? `${t('模式', 'Mode')}: ${service.mode}${service.remainingCalls ? ` · ${t('今日剩余调用', 'calls left today')}: ${service.remainingCalls}` : ''}` : t('先在本机保存 API 密钥，再开始。', 'Save an API key locally first.')}</small></div>${button('setup', '连接说明', 'Connection guide', 'link-button')}</div>
    ${ui.busy === 'review'
      ? html`<button type="button" class="btn run-button stop" data-act="cancel">${t('停止等待', 'Stop waiting')}${ui.queue ? ` · ${t('排队第', 'queue position ')}${ui.queue}${t(' 位', '')}` : ''}</button>`
      : html`<button type="button" class="btn run-button" data-act="run" ${blockedReason || ui.busy || ui.demo ? raw('aria-disabled="true"') : ''}>${last ? t('运行新一轮多智能体反馈', 'Run a new round of multi-agent feedback') : t('运行多智能体反馈', 'Run multi-agent feedback')}</button>`}
    ${blockedReason && !ui.busy ? html`<p class="fine blocked">${blockedReason}</p>` : ''}
  </details>`;
}

function targetLabelFull(label) {
  const match = String(label).match(/^(Reason|Counterargument) (\d)(?: (\w+))?$/);
  if (!match) return targetLabel(label);
  const base = targetLabel(`${match[1]} ${match[2]}`);
  const part = { evidence: LABELS.evidence, warrant: LABELS.warrant, response: LABELS.response }[match[3]];
  return part ? `${base} · ${tx(part)}` : base;
}

function flow(round) {
  const status = role => ui.statuses[role] || (round?.results?.[role] ? (round.results[role].guard?.notes?.some(note => /FALLBACK|ASSEMBLY/.test(note)) ? 'fallback' : 'done') : round?.roleErrors?.[role] ? 'error' : '');
  const node = role => {
    const value = status(role);
    const label = value === 'running' ? t('运行中', 'Working') : value === 'repairing' ? t('修正中', 'Repairing') : value === 'done' ? t('已完成', 'Done') : value === 'fallback' ? t('程序汇总', 'Assembled') : value === 'error' ? t('未返回', 'Unavailable') : t('等待中', 'Waiting');
    return html`<div class="flow-node ${value}"><span class="flow-dot">${value === 'done' ? '✓' : ROLE_SHORT[role]}</span><span>${tx(ROLE_NAMES[role])}</span><em>${label}</em></div>`;
  };
  const arrow = html`<span class="flow-arrow">→</span>`;
  return html`<div class="orchestration" aria-hidden="true">${node('analyst')}${arrow}${node('socratic')}${arrow}${node('language')}${arrow}${node('coordinator')}<span class="flow-arrow">⇢</span><div class="flow-node guard ${round?.results?.analyst ? 'done' : ''}"><span class="flow-dot">✓</span><span>${tx(ROLE_NAMES.guard)}</span><em>${t('核查每条输出', 'checks each output')}</em></div></div>`;
}

function startHere(round) {
  const coordinator = round.results.coordinator;
  const analyst = round.results.analyst;
  if (!coordinator) return '';
  const fallback = coordinator.priorities.some(item => item.fallback);
  return html`<article class="agent-card coordinator start-here" id="card-coordinator">
    <div class="agent-top"><span class="agent-avatar">R</span><div><h3>${t('从这里开始', 'Start here')} · ${tx(ROLE_NAMES.coordinator)}</h3><small>${tx(ROLE_HELP.coordinator)}</small></div></div>
    <h4 lang="en">${coordinator.focus}</h4>
    ${round.self ? html`<div class="self-compare"><span>${t('你的判断', 'You flagged')}: <b>${targetLabelFull(round.self.label)}</b></span>${analyst?.selfAssessment ? html`<span class="tag agree-${analyst.selfAssessment.agreement}">${{ agree: t('分析者同意', 'Analyst agrees'), partly: t('部分同意', 'Partly agrees'), different: t('分析者有不同看法', 'Analyst sees it differently') }[analyst.selfAssessment.agreement]}</span><p lang="en">${analyst.selfAssessment.note}</p>` : ''}</div>` : ''}
    <div class="priorities">${coordinator.priorities.map(item => html`<div class="priority" id="item-${item.id}">
      <div class="priority-head"><span class="pid">${item.id}</span>${tag(targetLabel(item.target))}${tag(item.type === 'language' ? t('语言', 'Language') : t('论证', 'Argument'), 'soft')}${item.basedOn.map(ref => html`<a class="ref" href="#item-${ref}">${ref}</a>`)}</div>
      <p lang="en">${glossify(item.text)}</p>
      ${item.successCheck ? html`<p class="success-check"><b>${t('怎样算完成：', 'How you will know:')}</b> <span lang="en">${item.successCheck}</span></p>` : ''}
      ${viewingLatest() && !ui.demo ? button(`clarify-${item.id}`, '这条什么意思？', 'What does this mean?', 'link-button small') : ''}
      ${clarifyThread(round, item, 'R')}
    </div>`)}</div>
    ${coordinator.tension ? html`<p class="tension"><b>${t('需要权衡：', 'Tension:')}</b> <span lang="en">${coordinator.tension}</span></p>` : ''}
    ${coordinator.nextStep ? html`<p class="next-step"><b>${t('下一步：', 'Next:')}</b> <span lang="en">${coordinator.nextStep}</span></p>` : ''}
    ${fallback ? html`<p class="fine">${t('修订协调角色本轮未返回，以上重点由程序根据论证分析汇总。', 'The coordinator did not return this round; these priorities were assembled from the analysis by software.')}</p>` : ''}
  </article>`;
}

function strengthCard(round) {
  const strength = round.results.analyst?.strength;
  if (!strength) return '';
  return html`<article class="strength-card"><b>${t('值得保留', 'Keep this')}</b>${anchorQuote(strength)}<p lang="en">${strength.text}</p></article>`;
}

function turnBubble(turn) {
  return html`<div class="turn ${turn.from}"><span class="who">${turn.from === 'learner' ? t('你', 'You') : `${t('教练', 'Coach')}${turn.move ? ` · ${tx(MOVES[turn.move])}` : ''}`}</span><p lang="en">${turn.text}</p>${turn.insight ? html`<p class="insight"><b>${t('你的发现', 'Your insight')}:</b> <q lang="en">${turn.insight}</q></p>` : ''}</div>`;
}

function replyBox(id, kind, thread) {
  const learnerTurns = (thread?.turns || []).filter(turn => turn.from === 'learner').length;
  const busy = ui.busy === `dialogue:${id}`;
  const error = ui.threadErrors[id];
  const fieldId = idOf(`reply-${id}`);
  return html`<div class="reply-box">
    <label for="${fieldId}">${kind === 'feedback' && !learnerTurns ? t('你的问题（英语）', 'Your question (English)') : tx(LABELS.reply)}</label>
    <textarea id="${fieldId}" data-scope="reply" data-path="${id}" rows="3" maxlength="${LIMITS.reply}" lang="en" placeholder="${kind === 'feedback' ? 'I am not sure what … means here. Do you mean …?' : 'I think … because …'}" ${busy ? raw('disabled') : ''}>${ui.replyDrafts[id] || ''}</textarea>
    ${error ? html`<p class="field-error" role="alert">${errorText(error)}</p>` : ''}
    <div class="reply-actions"><span class="fine">${t('还可回答', 'Turns left')}: ${MAX_LEARNER_TURNS - learnerTurns} · ${t('Ctrl/⌘+Enter 发送', 'Ctrl/⌘+Enter to send')}</span>
      <span>${learnerTurns ? button('finish-thread', '结束这个问题', 'Finish this question', 'link-button', `data-id="${id}"`) : ''}
      <button type="button" class="btn small" data-act="send-reply" data-id="${id}" data-kind="${kind}" ${busy ? raw('disabled') : ''}>${busy ? t('等待回应…', 'Waiting…') : t('发送', 'Send')}</button></span></div>
  </div>`;
}

function threadView(round, id, kind) {
  const thread = round.dialogue[id];
  const canReply = viewingLatest() && !ui.demo && !thread?.closed;
  return html`<div class="thread" id="thread-${id}">
    ${(thread?.turns || []).map(turnBubble)}
    ${canReply ? replyBox(id, kind, thread) : ''}
    ${thread?.closed && kind === 'question' ? html`<div class="takeaway">${viewingLatest() && !ui.demo
      ? field(id, { scope: 'takeaway', rows: 2, labelText: t('用你自己的话写下收获（选填，英语）', 'Your takeaway in your own words (optional, English)'), placeholder: 'I realised that …' })
      : thread.takeaway ? html`<p><b>${t('你的收获', 'Your takeaway')}:</b> <span lang="en">${thread.takeaway}</span></p>` : ''}</div>` : ''}
  </div>`;
}

function clarifyThread(round, item) {
  const thread = round.dialogue[item.id];
  if (!thread && !ui.openClarify[item.id]) return '';
  return html`<div class="clarify">${threadView(round, item.id, 'feedback')}</div>`;
}

function questionsCard(round) {
  const socratic = round.results.socratic;
  if (!socratic) return round.roleErrors.socratic ? html`<article class="agent-card socratic unavailable"><h3>${tx(ROLE_NAMES.socratic)}</h3><p>${t('本轮追问未返回。你可以直接修订，或稍后重新运行。', 'Questions did not return this round. You can revise directly or run again later.')}</p></article>` : '';
  const minimum = state.task?.minDialogue ?? 1;
  return html`<article class="agent-card socratic" id="card-socratic">
    <div class="agent-top"><span class="agent-avatar">Q</span><div><h3>${tx(ROLE_NAMES.socratic)}</h3><small>${tx(ROLE_HELP.socratic)}</small></div></div>
    <h4 lang="en">${socratic.focus}</h4>
    <p class="dialogue-hint">${t(`请至少回答 ${minimum} 个问题。教练会根据你的回答继续追问，但不会替你回答或改写。`, `Answer at least ${minimum} question(s). The coach follows up on your answers but never answers for you or rewrites your text.`)}</p>
    ${socratic.questions.map(item => html`<div class="question-card" id="item-${item.id}">
      <div class="q-head"><span class="qid">${item.id}</span>${tag(tx(QUESTION_TYPES[item.type]), 'qtype')}${item.target ? tag(targetLabel(item.target)) : ''}</div>
      ${anchorQuote(item)}
      <p class="q-text" lang="en">${glossify(item.text)}</p>
      ${threadView(round, item.id, 'question')}
    </div>`)}
  </article>`;
}

function checkChip(kind, value) {
  if (!value) return '';
  return html`<span class="chip ${CHECK_TONE[value] || ''}">${tx(CHECK_LABELS[kind][value])}</span>`;
}

function analystCard(round) {
  const analyst = round.results.analyst;
  if (!analyst) return '';
  const checks = analyst.checks;
  return html`<article class="agent-card analyst" id="card-analyst">
    <div class="agent-top"><span class="agent-avatar">A</span><div><h3>${tx(ROLE_NAMES.analyst)}</h3><small>${tx(ROLE_HELP.analyst)}</small></div></div>
    <h4 lang="en">${analyst.focus}</h4>
    ${checks ? html`<table class="check-table"><caption>${t('论证检查（诊断标签，不是分数）', 'Argument check (diagnostic labels, not scores)')}</caption><tbody>
      <tr><th>${t('主张', 'Claim')}</th><td>${checkChip('answersTopic', checks.claim.answersTopic)}${checkChip('scope', checks.claim.scope)}</td></tr>
      ${checks.reasons.map(item => html`<tr><th>${targetLabel(item.target)}</th><td>${checkChip('evidenceStatus', item.evidenceStatus)}<span class="link-label">${t('证据→理由', 'evidence→reason')}</span>${checkChip('link', item.evidenceLink)}<span class="link-label">${t('理由→主张', 'reason→claim')}</span>${checkChip('link', item.claimLink)}</td></tr>`)}
      ${checks.counterarguments.map(item => html`<tr><th>${targetLabel(item.target)}</th><td>${checkChip('fairness', item.fairness)}${checkChip('responseType', item.responseType)}</td></tr>`)}
    </tbody></table>` : ''}
    ${analyst.schemes?.length ? html`<div class="schemes">${analyst.schemes.map(item => html`<span class="scheme" tabindex="0" title="${(SCHEMES[item.scheme]?.cq || []).join(' ')}">${targetLabel(item.target)} · ${tx(SCHEMES[item.scheme]?.label)}</span>`)}</div>` : ''}
    ${analyst.items.map(item => feedbackItem(round, item))}
  </article>`;
}

function feedbackItem(round, item) {
  const decision = round.decisions[item.id]?.decision;
  return html`<div class="feedback-item" id="item-${item.id}">
    <div class="q-head"><span class="qid">${item.id}</span>${tag(tx(CRITERIA[item.criterion]?.label))}${item.target ? tag(targetLabel(item.target)) : ''}${decision ? tag(tx(DECISIONS[decision]), `decision ${decision}`) : ''}</div>
    ${anchorQuote(item)}
    <p lang="en">${glossify(item.text)}</p>
    ${viewingLatest() && !ui.demo ? button(`clarify-${item.id}`, '这条什么意思？', 'What does this mean?', 'link-button small') : ''}
    ${clarifyThread(round, item)}
  </div>`;
}

function languageCard(round) {
  const language = round.results.language;
  if (!language) return round.roleErrors.language ? html`<p class="fine">${t('本轮语言反馈不可用。', 'Language feedback is unavailable this round.')}</p>` : '';
  return html`<article class="agent-card language" id="card-language">
    <div class="agent-top"><span class="agent-avatar">L</span><div><h3>${tx(ROLE_NAMES.language)}</h3><small>${tx(ROLE_HELP.language)}</small></div></div>
    <h4 lang="en">${language.focus}</h4>
    ${language.items.map(item => feedbackItem(round, item))}
    ${language.frames.length ? html`<div class="frames"><p class="fine">${t('句子框架是可选的“修辞动作”，请改写成你自己的话，不要照抄。', 'Frames are optional rhetorical moves: adapt them in your own words rather than copying.')}</p>
      ${language.frames.map(frame => html`<div class="sentence-frame"><span class="move">${frame.move || t('框架', 'Frame')}</span><span lang="en">${frame.text}</span></div>`)}</div>` : ''}
  </article>`;
}

const NOTE_TEXT = {
  ANCHOR_UNVERIFIED: pairText('引文无法在你的文本中找到，已隐藏', 'quote not found in your text; hidden'),
  ANCHOR_MISSING: pairText('未提供引文', 'no quote given'),
  ITEM_REMOVED: pairText('因违反诚信规则被移除', 'removed for breaking an integrity rule'),
  FRAME_REMOVED: pairText('不安全的句子框架已移除', 'unsafe sentence frame removed'),
  CLOSED_QUESTION: pairText('是非问句（已记录）', 'yes/no question (logged)'),
  BASEDON_INVALID: pairText('无效引用已移除', 'invalid reference removed'),
  COORDINATOR_FALLBACK: pairText('修订重点由程序汇总', 'priorities assembled by software'),
  DETERMINISTIC_ASSEMBLY: pairText('修订重点由程序汇总（研究模式）', 'priorities assembled by software (research mode)'),
  INSIGHT_UNVERIFIED: pairText('发现摘录无法核实，已隐藏', 'insight quote not verified; hidden'),
  MOVE_FORCED_CLOSE: pairText('已到对话上限，教练小结', 'turn limit reached; coach closed'),
  FEW_QUESTIONS: pairText('追问少于 2 个', 'fewer than 2 questions')
};
function pairText(zh, en) { return { zh, en }; }

function guardFooter(round) {
  const notes = ROLES.flatMap(role => (round.results[role]?.guard?.notes || []).map(note => ({ role, note })));
  const repaired = ROLES.filter(role => round.results[role]?.guard?.repaired);
  const anchored = ROLES.flatMap(role => [...(round.results[role]?.items || []), ...(round.results[role]?.questions || [])]);
  const meta = round.meta || {};
  return html`<details class="guard-details" ${detailsAttrs('guard')}><summary>${t('诚信守门与运行记录', 'Integrity guard and run record')}</summary>
    <ul>
      <li>${t('引文核实', 'Quotes verified')}: ${anchored.filter(item => item.anchor).length}/${anchored.length} ${t('（每条引文都由程序在你的文本中逐词核对）', '(every quote is matched word by word against your text)')}</li>
      <li>${t('格式或诚信修复', 'Repairs')}: ${repaired.length ? repaired.map(role => tx(ROLE_NAMES[role])).join(', ') : t('无', 'none')}</li>
      ${notes.length ? html`<li>${t('守门记录', 'Guard notes')}: ${notes.map(({ role, note }) => { const [code, id] = note.split(':'); return tag(`${ROLE_SHORT[role]} · ${NOTE_TEXT[code] ? tx(NOTE_TEXT[code]) : code}${id ? ` (${id})` : ''}`, 'soft'); })}</li>` : ''}
      ${Object.keys(round.roleErrors || {}).length ? html`<li>${t('未返回的角色', 'Unavailable roles')}: ${Object.entries(round.roleErrors).map(([role, code]) => `${tx(ROLE_NAMES[role])} (${code})`).join(', ')}</li>` : ''}
      <li>${t('模型', 'Model')}: ${meta.model || '—'}${meta.servedModel && meta.servedModel !== meta.model ? ` → ${meta.servedModel}` : ''} · ${t('提示词版本', 'prompt version')} ${meta.promptVersion || '—'} · ${t('模式', 'mode')} ${meta.mode || '—'} · ${meta.calls ?? 0} ${t('次调用', 'calls')} · ${meta.tokens ?? 0} tokens · ${meta.ms ? `${(meta.ms / 1000).toFixed(1)} s` : ''}</li>
      ${meta.runId ? html`<li class="fine">run ${meta.runId} · ${meta.at ? stamp(meta.at) : ''}</li>` : ''}
    </ul></details>`;
}

function coachOutput() {
  const round = viewedRound();
  const stale = round && viewingLatest() && round.input && safeSnapshot() && !sameInput(round.input, safeSnapshot());
  return html`${flow(round)}
    ${ui.error ? html`<div class="error" role="alert">${errorText(ui.error.code)}${ui.error.field ? html` <button type="button" class="link-button" data-act="goto-field" data-path="${ui.error.field}">${t('查看', 'Go to')} ${fieldLabel(ui.error.field)}</button>` : ''}</div>` : ''}
    ${!round ? html`<div class="empty"><span class="big">A → S + L → R</span>${t('先完成上面的自评与同意，再运行反馈。反馈会引用你的原话，并提出需要你回答的问题。', 'Complete the self-assessment and consent above, then run feedback. It quotes your own words and asks questions for you to answer.')}</div>` : html`
      <p class="run-status">${t('第', 'Round ')}${round.id}${t(' 轮', '')} · ${round.status === 'running' ? t('进行中', 'running') : round.status === 'partial' ? t('部分完成', 'partial') : t('已完成', 'complete')} · ${stamp(round.meta?.at || round.startedAt)}${round.meta?.live === false ? ` · ${t('离线模板', 'offline template')}` : ''}</p>
      ${stale ? html`<div class="callout warning">${t('你在本轮之后修改了论证。下面的反馈针对的是本轮提交的版本；修改完成后可以运行新一轮。', 'You have changed the map since this round. The feedback below refers to the version reviewed in this round; run a new round when you are ready.')}</div>` : ''}
      ${startHere(round)}${strengthCard(round)}${questionsCard(round)}${analystCard(round)}${languageCard(round)}
      ${round.results.analyst ? guardFooter(round) : ''}`}`;
}

function coachPage() {
  const showPre = !ui.demo && (viewingLatest() || !state.rounds.length || ui.pending);
  return html`${heading(3, '回答追问，检验你的论证', 'Answer questions to test your argument', '四个角色分工反馈，诚信守门逐条核查；你通过回答追问自己发现问题。', 'Four roles give feedback, an integrity guard checks every item, and you find the problems yourself by answering questions.')}
    <div class="stage-note"><strong>${t('本环节做什么？', 'What happens here?')}</strong><p>${t('论证分析按明确标准诊断并指出值得保留之处；苏格拉底式追问依据论证类型提出关键问题；语言教练指向你自己的句子；修订协调给出一至两个可检验的重点。你需要回答追问，教练会继续追问，但不会替你回答或改写。', 'The analyst diagnoses against explicit criteria and names what to keep; the questioner asks critical questions for your type of reasoning; the language coach points to your own sentences; the coordinator gives one or two checkable priorities. You answer the questions; the coach follows up but never answers or rewrites for you.')}</p></div>
    ${roundTabs()}
    ${showPre ? preRunPanel() : ''}
    <div id="coach-output">${coachOutput()}</div>
    <div class="actions">${button('map', '← 回到论证地图', '← Argument map', 'btn secondary')}${button('to-revise', '进入自主修订 →', 'Continue to revision →')}</div>`;
}

// ---------- Step 4: revise ----------
function decisionControl(round, item, required) {
  const current = round.decisions[item.id];
  const editable = !ui.demo;
  return html`<div class="decision ${required && !current?.decision ? 'needed' : ''}">
    <div class="segmented" role="group" aria-label="${t('你的决定', 'Your decision')} ${item.id}">${Object.entries(DECISIONS).map(([key, value]) => html`<button type="button" data-act="decide" data-id="${item.id}" data-value="${key}" aria-pressed="${String(current?.decision === key)}" ${editable ? '' : raw('disabled')}>${tx(value)}</button>`)}</div>
    ${current?.decision ? field(item.id, { scope: 'decision', input: true, english: !allowChineseReflection(), labelText: current.decision === 'unclear' ? t('哪里不清楚？（也可以点“这条什么意思？”提问）', 'What is unclear? (You can also ask “What does this mean?”)') : t('理由（一句话）', 'Reason (one sentence)'), placeholder: current.decision === 'reject' ? 'I will keep … because …' : 'I will … because …', limit: LIMITS.decisionReason }) : ''}
  </div>`;
}

function insightsList(round) {
  const items = [];
  for (const [id, thread] of Object.entries(round.dialogue)) {
    if (thread.kind === 'feedback') continue;
    const question = round.results.socratic?.questions?.find(item => item.id === id);
    for (const turn of thread.turns) if (turn.insight) items.push({ id, question, text: turn.insight });
    if (thread.takeaway) items.push({ id, question, text: thread.takeaway, own: true });
  }
  return items;
}

function revisePage() {
  const round = latestRound();
  if (!round?.results?.analyst) return html`${heading(4, '把追问转化为自己的修订', 'Turn questions into your own revision', '', '')}<div class="callout">${t('请先在第 3 步运行反馈并回答追问。', 'Run feedback and answer questions in Step 3 first.')}</div>${button('coach', '← 去第 3 步', '← Go to Step 3', 'btn secondary')}`;
  const list = priorities(round);
  const insights = insightsList(round);
  const draft = round.input?.draft || '';
  const revisedWords = countWords(round.revised);
  const parts = ui.showDiff && draft && round.revised ? wordDiff(draft, round.revised) : null;
  const stats = diffStats(parts);
  const replies = Object.values(round.dialogue).reduce((sum, thread) => sum + thread.turns.filter(turn => turn.from === 'learner').length, 0);
  const decided = Object.values(round.decisions).filter(item => item.decision).length;
  const other = [...(round.results.analyst?.items || []), ...(round.results.language?.items || [])];
  return html`${heading(4, '把追问转化为自己的修订', 'Turn questions into your own revision', '对照反馈作出决定，再亲自改写。你可以采纳、调整或拒绝建议，但要说明理由。', 'Decide on each priority, then rewrite yourself. You may accept, adapt or reject advice, with a reason.')}
    <div class="mini-stats">
      <div class="mini-stat"><b>${replies}</b><span>${t('你的追问回答', 'Your dialogue replies')}</span></div>
      <div class="mini-stat"><b>${decided}</b><span>${t('已作出的决定', 'Decisions made')}</span></div>
      <div class="mini-stat"><b>${round.revisions.length}</b><span>${t('修订快照', 'Revision snapshots')}</span></div>
    </div>
    <div class="desk">
      <aside class="rail" aria-label="${t('反馈栏', 'Feedback rail')}">
        <h3>${t('修订重点（需要决定）', 'Revision priorities (decide on each)')}</h3>
        ${list.map(item => html`<div class="rail-item priority"><div class="priority-head"><span class="pid">${item.id}</span>${tag(targetLabel(item.target))}</div><p lang="en">${item.text}</p>${item.successCheck ? html`<p class="success-check"><b>${t('怎样算完成：', 'How you will know:')}</b> <span lang="en">${item.successCheck}</span></p>` : ''}${decisionControl(round, item, true)}</div>`)}
        ${insights.length ? html`<h3>${t('你在对话中的发现', 'What you worked out in dialogue')}</h3>${insights.map(item => html`<div class="rail-item insight-item"><small>${item.id} · ${item.own ? t('你的小结', 'your takeaway') : t('你的原话', 'your words')}</small><q lang="en">${item.text}</q></div>`)}` : html`<p class="fine">${t('你还没有在对话中回答追问。回答会帮助你决定怎么改。', 'You have not answered any questions yet. Answering helps you decide how to revise.')}</p>`}
        ${round.results.socratic ? html`<details class="details" ${detailsAttrs('draft-reviewed')}><summary>${t('追问与你的回答', 'Questions and your answers')}</summary>${round.results.socratic.questions.map(item => { const last = (round.dialogue[item.id]?.turns || []).filter(turn => turn.from === 'learner').at(-1); return html`<p><b>${item.id}</b> <span lang="en">${item.text}</span>${last ? html`<br><small>${t('你的回答', 'You')}:</small> <span lang="en">${last.text}</span>` : ''}</p>`; })}</details>` : ''}
        ${round.results.language?.frames?.length ? html`<details class="details" ${detailsAttrs('questions-answers')}><summary>${t('可选句子框架', 'Optional frames')}</summary>${round.results.language.frames.map(frame => html`<p><span class="move">${frame.move}</span> <span lang="en">${frame.text}</span></p>`)}</details>` : ''}
        <details class="details" ${detailsAttrs('frames')}><summary>${t('其他反馈（可选决定）', 'Other feedback (optional decisions)')}</summary>${other.map(item => html`<div class="rail-item"><div class="priority-head"><span class="pid">${item.id}</span>${tag(tx(CRITERIA[item.criterion]?.label))}</div><p lang="en">${item.text}</p>${decisionControl(round, item, false)}</div>`)}</details>
      </aside>
      <section class="editor">
        ${draft ? html`<details class="details" ${detailsAttrs('other-feedback')}><summary>${t('第', 'Round ')}${round.id}${t(' 轮提交的初稿', ' draft as reviewed')} (${countWords(draft)} ${t('词', 'words')})</summary><p class="draft-view" lang="en">${draft}</p></details>` : ''}
        <div class="editor-tools">${draft && !round.revised.trim() && !ui.demo ? button('start-from-draft', '从我的初稿开始修改', 'Start from my draft', 'btn secondary small') : ''}${draft && round.revised ? button('toggle-diff', ui.showDiff ? '隐藏修改对比' : '显示修改对比', ui.showDiff ? 'Hide changes' : 'Show changes', 'btn secondary small') : ''}</div>
        ${field('revised', { scope: 'round', rows: 14, labelText: tx(LABELS.revised), help: { zh: '必须由你自己用英语完成。核查引文，并如实说明 AI 的作用。', en: 'Write this yourself, in English. Check quotations and be honest about the AI\'s role.' }, placeholder: 'Write your revised English text here …' })}
        <p class="word-count" id="wc-revised">${revisedWords} ${t('词', 'words')}${state.task?.wordMax ? ` · ${t('任务要求', 'Task')} ${state.task.wordMin}–${state.task.wordMax}` : ''}</p>
        ${parts ? html`<div class="diff-view" aria-label="${t('修改对比', 'Changes')}"><p class="fine">${t('新增', 'Added')} ${stats.add} · ${t('删除', 'Removed')} ${stats.del} · ${t('保留', 'Kept')} ${stats.same} ${t('词', 'words')}</p><p lang="en">${parts.map(part => (part.type === 'same' ? part.text : part.type === 'add' ? html`<ins>${part.text}</ins>` : html`<del>${part.text}</del>`))}</p></div>` : ''}
        ${field('note', { scope: 'round', rows: 2, optional: true, english: !allowChineseReflection(), labelText: tx(LABELS.note), help: allowChineseReflection() ? { zh: '可用中文或英语。', en: 'Chinese or English.' } : null })}
        <div class="actions tight">${ui.demo ? '' : button('save-version', '保存修订快照', 'Save revision snapshot', 'btn secondary')}${round.revisions.length ? html`<span class="fine">${t('最近快照', 'Last snapshot')}: ${stamp(round.revisions.at(-1).at)} · ${round.revisions.at(-1).words} ${t('词', 'words')}</span>` : ''}</div>
      </section>
    </div>
    <div class="actions">${button('coach', '← 回到追问对话', '← Questions & dialogue', 'btn secondary')}${button('reflect', '检查修订并反思 →', 'Check revision and reflect →')}</div>`;
}

// ---------- Step 5: reflect ----------
function generatedStatement() {
  const models = [...new Set(state.rounds.map(round => round.meta?.model).filter(Boolean))].join(', ') || 'DeepSeek';
  const replies = state.rounds.reduce((sum, round) => sum + Object.values(round.dialogue).reduce((total, thread) => total + thread.turns.filter(turn => turn.from === 'learner').length, 0), 0);
  const counts = { accept: 0, adapt: 0, reject: 0, unclear: 0 };
  state.rounds.forEach(round => Object.values(round.decisions).forEach(item => { if (counts[item.decision] !== undefined) counts[item.decision] += 1; }));
  const parts = [`AI use statement: I used ArguMentor, an AI writing coach (model: ${models}), for ${state.rounds.length} round(s) of feedback on my argument map and draft. It asked me questions and pointed out issues; it did not write text for my essay. I wrote ${replies} reply/replies in dialogue with the coach and made ${counts.accept + counts.adapt + counts.reject} decision(s) about its feedback (accepted ${counts.accept}, adapted ${counts.adapt}, rejected ${counts.reject}).`];
  if (state.aiUse.languageTools) parts.push(`I also used another AI tool to check my language${state.aiUse.otherTools ? `: ${state.aiUse.otherTools}` : ''}.`);
  if (state.aiUse.contentTools) parts.push(`I also used another AI tool for ideas or content${state.aiUse.otherTools ? `: ${state.aiUse.otherTools}` : ''}.`);
  if (state.aiUse.ownWords) parts.push('All sentences in my final text are my own, and I can explain every change I made.');
  return parts.join(' ');
}

function reflectPage() {
  const round = latestRound();
  const list = priorities(round);
  const check = round?.check;
  const goal = lastGoal();
  const ready = round && list.length && list.every(item => round.decisions[item.id]?.decision) && countWords(round.revised) >= 20;
  return html`${heading(5, '检查修订，反思策略', 'Check your revision and reflect', 'AI 只描述修订中“读者能看到什么”，不打分；是否完成由你判断。', 'The AI only describes what a reader can now see in your revision; it does not score. You judge whether you are done.')}
    ${!round ? html`<div class="callout">${t('请先完成第 3、4 步。', 'Complete Steps 3 and 4 first.')}</div>` : html`
    <section class="check-panel">
      <h3>${t('修订检查', 'Revision check')}</h3>
      <ul class="requirements">
        <li class="${list.every(item => round.decisions[item.id]?.decision) ? 'ok' : ''}">${t('已对每个修订重点作出决定', 'A decision on every priority')}</li>
        <li class="${countWords(round.revised) >= 20 ? 'ok' : ''}">${t('修订稿至少 20 个英语单词', 'At least 20 words of revised text')} (${countWords(round.revised)})</li>
        <li class="${ui.consent ? 'ok' : ''}">${t('已同意数据说明（第 3 步）', 'Data notice accepted (Step 3)')}</li>
      </ul>
      ${ui.demo ? '' : html`<button type="button" class="btn" data-act="run-check" ${!ready || !ui.consent || ui.busy ? raw('aria-disabled="true"') : ''}>${ui.busy === 'check' ? t('检查中…', 'Checking…') : check ? t('重新检查当前修订稿', 'Check the current revision again') : t('运行修订检查', 'Run the revision check')}</button>`}
      ${ui.checkError ? html`<div class="error" role="alert">${errorText(ui.checkError)}</div>` : ''}
      ${check ? html`<div class="check-results"><p lang="en"><b>${check.result.focus}</b></p>
        ${check.result.checks.map(item => { const priority = list.find(entry => entry.id === item.priorityId); return html`<div class="check-item ${item.status}"><div class="priority-head"><span class="pid">${item.priorityId}</span><span class="status ${item.status}">${tx(CHECK_STATUS[item.status])}</span></div>${priority ? html`<p class="fine" lang="en">${priority.text}</p>` : ''}${item.anchor ? html`<blockquote lang="en">${item.anchor}</blockquote>` : ''}<p lang="en">${item.note}</p></div>`; })}
        ${check.result.question ? html`<p class="next-step"><b>${t('继续思考：', 'Think further:')}</b> <span lang="en">${check.result.question}</span></p>` : ''}
        ${check.revised !== round.revised ? html`<p class="fine">${t('你在检查之后又修改了修订稿。', 'You changed the revision after this check.')}</p>` : ''}</div>` : ''}
    </section>
    ${state.rounds.length > 1 ? html`<section class="progress-rounds"><h3>${t('各轮进展', 'Progress across rounds')}</h3>${state.rounds.map(item => html`<p><b>${t('第', 'Round ')}${item.id}${t(' 轮', '')}</b> ${(item.check?.result?.checks || []).map(entry => html`<span class="status ${entry.status}">${entry.priorityId} ${tx(CHECK_STATUS[entry.status])}</span>`)}${item.check ? '' : html`<span class="fine">${t('未检查', 'not checked')}</span>`}</p>`)}</section>` : ''}`}
    ${goal ? html`<section class="goal-card"><b>${t('你上次的目标', 'Your goal from last time')}:</b> <span lang="en">${goal}</span>${field('goalCheck', { scope: 'state', rows: 2, english: !allowChineseReflection(), labelText: t('你自己判断：这次做到了吗？哪里可以看出来？', 'Your own judgement: did you apply it this time? Where can a reader see it?'), placeholder: 'Yes, in … / Not yet, because …' })}</section>` : ''}
    ${field('transfer', { scope: 'state', rows: 2, english: !allowChineseReflection(), labelText: tx(LABELS.transfer), help: allowChineseReflection() ? { zh: '可用中文或英语。下一个任务开始时会提醒你。', en: 'Chinese or English. You will be reminded of it at the start of your next task.' } : { zh: '请用英语。下一个任务开始时会提醒你。', en: 'In English. You will be reminded of it at the start of your next task.' }, placeholder: 'Next time, I will check whether …' })}
    <section class="ai-use">
      <h3>${t('AI 使用说明', 'AI-use statement')}</h3>
      ${state.task ? html`<p class="fine">${t('本任务的 AI 使用规则', 'AI-use rule for this task')}: ${tx(AI_USE_LEVELS[state.task.aiUse])}</p>` : ''}
      <label class="check-row"><input type="checkbox" data-scope="aiUse" data-path="argumentor" ${state.aiUse.argumentor ? raw('checked') : ''}> ${t('我使用了论证工坊的反馈与追问', 'I used ArguMentor feedback and questions')}</label>
      <label class="check-row"><input type="checkbox" data-scope="aiUse" data-path="languageTools" ${state.aiUse.languageTools ? raw('checked') : ''}> ${t('我还用了其他 AI 工具检查语言', 'I also used another AI tool to check my language')}</label>
      <label class="check-row"><input type="checkbox" data-scope="aiUse" data-path="contentTools" ${state.aiUse.contentTools ? raw('checked') : ''}> ${t('我还用了其他 AI 工具获取想法或内容', 'I also used another AI tool for ideas or content')}</label>
      ${state.aiUse.languageTools || state.aiUse.contentTools ? field('otherTools', { scope: 'aiUse', input: true, english: false, labelText: t('哪个工具、做了什么？', 'Which tool, and for what?'), limit: LIMITS.otherTools }) : ''}
      <label class="check-row"><input type="checkbox" data-scope="aiUse" data-path="ownWords" ${state.aiUse.ownWords ? raw('checked') : ''}> ${t('最终文本中的句子都是我自己写的，我能解释每一处修改。', 'All sentences in my final text are my own, and I can explain every change.')}</label>
      <div class="toolbar">${button('fill-statement', '根据记录生成说明草稿', 'Draft the statement from my record', 'btn secondary small')}</div>
      ${field('disclosure', { scope: 'state', rows: 4, english: false, labelText: tx(LABELS.disclosure), help: { zh: '可以修改。论证工坊不使用 AI 文本检测器；这份说明是你诚信写作的一部分。', en: 'You can edit it. ArguMentor does not use AI-text detectors; this statement is part of honest writing.' } })}
    </section>
    <section class="export-panel">
      <h3>${t('导出与下一步', 'Export and next steps')}</h3>
      ${field('learnerCode', { scope: 'state', input: true, english: false, labelText: tx(LABELS.learnerCode), help: { zh: '使用教师给的代码，不要写真实姓名或学号。', en: 'Use the code your teacher gave you, not your real name or student number.' }, limit: LIMITS.learnerCode })}
      <label class="check-row"><input type="checkbox" data-scope="state" data-path="researchConsent" ${state.researchConsent ? raw('checked') : ''}> ${t('（选填）我同意教师在去除身份信息后，把这份学习记录用于教学研究。', '(Optional) I agree that my teacher may use a de-identified copy of this record for teaching research.')}</label>
      <div class="actions tight">${button('export-html', '导出学习报告 (HTML)', 'Export report (HTML)', 'btn')}${button('export-json', '导出数据 (JSON)', 'Export data (JSON)', 'btn secondary')}</div>
      ${round && !ui.demo ? html`<div class="actions tight">${button('next-round', `用修订稿开始第 ${round.id + 1} 轮`, `Start round ${round.id + 1} with my revision`, 'btn secondary', round.revised.trim() ? '' : 'disabled')}${button('new-task', '开始新任务', 'Start a new task', 'btn secondary')}</div>` : ''}
    </section>
    <div class="actions">${button('revise', '← 回到修订', '← Revision', 'btn secondary')}</div>`;
}

// ---------- guide ----------
function guidePage() {
  const notice = CONSENT_NOTICE[state.lang] || CONSENT_NOTICE.en;
  return html`<section class="info-page"><article class="paper">
    <div class="section-head"><div><div class="eyebrow">GUIDE</div><h2>${t('使用指南与设计说明', 'Guide and design notes')}</h2><p>${t('论证工坊 · 面向英语专业学习者的英语论证写作教练', 'ArguMentor · an English argument-writing coach for English majors')}</p></div>${button('print', '打印 / 保存 PDF', 'Print / save PDF', 'btn secondary small print-button')}</div>
    <h3>${t('一、学习目标', '1. Learning goals')}</h3>
    <p>${t('学习者在提出主张、组织多个理由、选择证据、解释推理联系和回应异议的过程中发展论证能力。工具的核心不是“读 AI 反馈”，而是“回答追问、作出修订决定、亲自改写”。教师设计任务与材料并评价学习，学习者对观点和最终文本负责。', 'Learners develop argument skills while making claims, organising reasons, choosing evidence, explaining warrants and answering objections. The core is not reading AI feedback but answering questions, making revision decisions and rewriting. Teachers design tasks and materials and evaluate learning; learners own their positions and final texts.')}</p>
    <h3>${t('二、五步流程', '2. Five steps')}</h3>
    <div class="info-grid">${STEPS.map(([, name], index) => html`<section><b>${index + 1} · ${tx(name)}</b><p>${[t('确定议题、读者、主张与限定。', 'Question, audience, claim and qualifier.'), t('理由—证据—来源—推理联系；异议、回应策略与回应；初稿。', 'Reason–evidence–source–warrant units; objections, response strategies and responses; draft.'), t('先自评，再运行四角色反馈；回答追问，与教练对话。', 'Self-assess, run four-role feedback, answer questions in dialogue.'), t('对每个重点采纳、调整、拒绝或表示不懂，并亲自改写。', 'Accept, adapt, reject or mark as unclear; rewrite yourself.'), t('AI 描述修订中可见的变化；记录策略、AI 使用说明并导出。', 'AI describes visible changes; record a strategy and an AI-use statement; export.')][index]}</p></section>`)}</div>
    <h3>${t('三、多智能体如何分工', '3. How the agents divide the work')}</h3>
    <p>${t('角色按“功能”而不是“人设”区分：论证分析使用明确标准与结构化检查（且不看支持等级，保证诊断与等级无关）；苏格拉底式追问使用依论证类型编写的关键问题库；语言教练只指向学习者自己的句子；修订协调从前三者的条目中选择一至两个重点，并给出自查问题。每条输出都经过诚信守门程序。研究者可通过 REVIEW_MODE 切换到单次调用或去掉协调角色的对照模式。', 'Roles are defined by function, not persona: the analyst uses explicit criteria and structured checks (and never sees the support level, so diagnosis is level-independent); the questioner uses a bank of critical questions keyed to argument schemes; the language coach points only to the learner\'s own sentences; the coordinator selects one or two priorities from the others\' items and adds a self-check question. Every output passes the integrity guard. Researchers can switch REVIEW_MODE to a single-call or no-coordinator condition for comparison.')}</p>
    <h3>${t('四、学术诚信', '4. Academic integrity')}</h3>
    <ul><li>${t('程序核查：AI 引用的“你的原话”必须逐词出现在你的文本中，否则不显示。', 'Software check: any quote of “your words” must appear word for word in your text, or it is hidden.')}</li>
      <li>${t('程序阻止：AI 输出中出现你文本里没有的链接、文献、年份、百分比或统计数字，或出现可直接粘贴的改写句时，会被修复或删除。', 'Software block: links, references, years, percentages or statistics not in your text, and pasteable rewritten sentences, are repaired or removed.')}</li>
      <li>${t('对话中教练不会替你回答问题；修订稿必须由你完成；AI 使用说明由你确认。论证工坊不使用 AI 文本检测器。', 'In dialogue the coach never answers for you; you write the revision; you confirm the AI-use statement. ArguMentor uses no AI-text detectors.')}</li></ul>
    <h3>${t('五、数据与隐私', '5. Data and privacy')}</h3>${notice.map(line => html`<p>${line}</p>`)}
    <p>${t('“公用电脑模式”下记录只保存在本次浏览会话中。API 密钥保存在项目文件夹之外的私有位置，不进入网页、记录或发布包。', 'In public computer mode the record lives only in this browser session. The API key is stored outside the project folder and never enters pages, records or release packages.')}</p>
    <h3>${t('六、教师', '6. For teachers')}</h3>
    <p>${t('在“教师”页面设计任务文件（议题、读者、要求、关注标准、语言重点、AI 使用规则、词汇表、最多 6 份材料），发给学生载入；收回学生导出的 JSON 后可查看全班概览、追问与发现，并导出 CSV。课堂局域网部署见 README。', 'On the Teacher page, design a task file (question, audience, requirements, focus criteria, language focus, AI-use rule, vocabulary, up to six sources) for learners to load; collect their exported JSON records for a class overview, the class\'s questions and insights, and a CSV export. See the README for classroom LAN deployment.')}</p>
    <h3>${t('七、术语', '7. Glossary')}</h3>
    <table class="glossary"><tbody>${Object.entries(GLOSSARY).map(([term, value]) => html`<tr><td lang="en"><b>${term}</b></td><td>${value.zh}</td><td lang="en">${value.en}</td></tr>`)}</tbody></table>
    <div class="actions">${button('frame', '返回学习工作区', 'Back to the studio')}${button('setup', '连接 DeepSeek', 'Connect DeepSeek', 'btn secondary')}</div>
  </article></section>`;
}

// ---------- page shell ----------
function hero() {
  return html`<section class="hero"><div><div class="eyebrow">${t('有据可循 · 有理可辩 · 有责可担', 'EVIDENCE · REASONING · RESPONSIBILITY')}</div>
    <h1>${t('不是替你写，而是陪你想清楚。', 'Not writing for you — thinking it through with you.')}</h1>
    <p>${t('面向英语专业学习者的英语论证写作教练：构建论证 → 回答追问 → 亲自修订 → 检查与反思。', 'An English argument-writing coach for English majors: build an argument → answer questions → revise yourself → check and reflect.')}</p>
    <div class="hero-tags"><span>${t('教师设计任务', 'Teacher-designed tasks')}</span><span>${t('学习者主导写作', 'Learner authorship')}</span><span>${t('程序化诚信守门', 'Software integrity guard')}</span></div></div>
    <aside class="hero-quote"><p>${t('“你的证据如何证明这个理由？这个理由又为什么支持你的主张？”', '“How does your evidence show this reason is true — and why does the reason support your claim?”')}</p>
      <div class="mini-path"><span>${t('构建', 'Build')}</span>→<span>${t('回答', 'Answer')}</span>→<span>${t('修订', 'Revise')}</span>→<span>${t('反思', 'Reflect')}</span></div></aside></section>`;
}

function appMarkup() {
  const page = state.page;
  const full = page === 'guide' || page === 'teacher';
  const content = { frame: framePage, map: mapPage, coach: coachPage, revise: revisePage, reflect: reflectPage }[page] || framePage;
  return html`<div class="wrap">${header()}${banners()}
    ${full ? (page === 'guide' ? guidePage() : html`<section class="info-page wide"><article class="paper" id="workspace">${teacherPage(teacherContext())}</article></section>`) : html`
      ${page === 'frame' ? hero() : ''}
      <div class="layout">${navigation()}<section class="paper" id="workspace">${content()}</section><aside class="side" id="side">${sidePanel()}</aside></div>`}
    <footer class="footer"><span>${t('论证工坊 · 教师设计任务 / 学习者主导写作 / 诚信表达', 'ArguMentor · Teacher-designed tasks / Learner authorship / Academic integrity')}</span><span>${t('AI 反馈可能出错，需要学习者与教师核查', 'AI feedback can be wrong; learners and teachers check it')}</span></footer>
  </div>`;
}

function render() {
  setLang(state.lang);
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('论证工坊 · 英语论证写作教练', 'ArguMentor · English argument coach');
  const active = document.activeElement;
  const focusId = active && active.id && active !== document.body ? active.id : null;
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scrollY = window.scrollY;
  $('app').innerHTML = String(appMarkup());
  if (focusId) {
    const element = document.getElementById(focusId);
    if (element) {
      element.focus({ preventScroll: true });
      if (selection && element.setSelectionRange) { try { element.setSelectionRange(...selection); } catch { /* not a text field */ } }
    }
  }
  window.scrollTo(0, scrollY);
  if (ui.focusAfterRender) {
    const target = document.getElementById(ui.focusAfterRender);
    ui.focusAfterRender = null;
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
}

function renderCoachOutput() {
  const output = $('coach-output');
  if (output) output.innerHTML = String(coachOutput());
  const side = $('side');
  if (side) side.innerHTML = String(sidePanel());
  const live = $('live');
  if (live) live.textContent = ui.liveMessage;
}

function go(page, focus) {
  state.page = page;
  ui.fieldError = null;
  logEvent('page', page);
  save();
  render();
  if (focus) { const element = document.getElementById(focus); if (element) { element.focus(); element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  else $('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- errors pointing at fields ----------
function pageForPath(path) {
  if (!path) return null;
  if (['topic', 'audience', 'claim', 'qualifier'].includes(path)) return state.page === 'map' && path === 'claim' ? 'map' : 'frame';
  if (/^(arguments|counters)\./.test(path) || path === 'draft') return 'map';
  if (path.startsWith('self.')) return 'coach';
  return null;
}
function showFieldError(error) {
  const code = error?.message || 'INVALID_INPUT';
  let path = error?.field || '';
  if (/^(arguments|counters)\.\d+$/.test(path)) path = `${path}.${path.startsWith('arguments') ? 'reason' : 'counter'}`;
  if (code === 'PII_DETECTED' && !path.startsWith('self.')) return piiDialog(path, error.detail);
  const message = `${errorText(code)}${code === 'PII_DETECTED' && error.detail ? ` (${tx(PII_TYPES[error.detail])})` : ''}`;
  const scope = path.startsWith('self.') ? 'self' : 'data';
  const cleanPath = path.replace(/^self\./, '');
  ui.fieldError = path ? { path: cleanPath, scope, message } : null;
  const page = pageForPath(path);
  if (page && page !== state.page) state.page = page;
  ui.focusAfterRender = path ? idOf(scope === 'data' ? cleanPath : `${scope}-${cleanPath}`) : null;
  if (!path) ui.error = { code };
  render();
  notify(ERRORS[code]?.zh || code, ERRORS[code]?.en || code);
}

// ---------- dialogs ----------
function openDialog(markup) { const dialog = $('dialog'); dialog.innerHTML = String(markup); if (!dialog.open) dialog.showModal(); }
function confirmDialog(zh, en, action) {
  confirmAction = action;
  openDialog(html`<h2>${t('确认操作', 'Confirm')}</h2><p>${t(zh, en)}</p><div class="dialog-actions">${button('close-dialog', '取消', 'Cancel', 'btn secondary')}${button('confirm', '确认', 'Confirm')}</div>`);
}
function piiDialog(path, type) {
  openDialog(html`<h2>${t('检测到可能的个人信息', 'Possible personal information')}</h2>
    <p>${t('位置', 'Where')}: <b>${fieldLabel(path)}</b> · ${t('类型', 'Type')}: <b>${tx(PII_TYPES[type] || PII_TYPES['long-number'])}</b></p>
    <p>${t('为保护隐私，含有邮箱、手机号、证件号或长数字的文本不会发送。你可以自动遮蔽（替换为 [email] 等占位符），或自己修改。', 'Text with emails, phone numbers, ID numbers or long numbers is not sent. You can redact automatically (replacing them with placeholders such as [email]) or edit it yourself.')}</p>
    <div class="dialog-actions">${button('goto-pii', '自己修改', 'Edit it myself', 'btn secondary', `data-path="${path}"`)}${button('redact-all', '自动遮蔽全部', 'Redact all')}</div>`);
}
function setupDialog(result = null) {
  openDialog(html`<h2>${t('连接 DeepSeek', 'Connect DeepSeek')}</h2>
    <p>${service.configured ? (service.live === false ? t('当前为离线模板模式（PROVIDER=mock），反馈不是 AI 生成。', 'Offline template mode (PROVIDER=mock): feedback is not AI-generated.') : t(`本机服务已读取密钥，模型：${service.model}，模式：${service.mode}。`, `The local server has a key. Model: ${service.model}. Mode: ${service.mode}.`)) : t('首次使用请在项目文件夹双击“启动论证工坊”，或在终端运行 npm run setup，然后 npm start。', 'For first use, open the launcher in the project folder, or run npm run setup and then npm start in a terminal.')}</p>
    <p>${t('密钥保存在项目文件夹之外的私有位置（macOS/Linux：~/.config/argumentor/env；Windows：%APPDATA%\\ArguMentor\\env），不进入网页、学习记录或发布包。一轮完整反馈通常调用模型 4 次；追问对话每次回答调用 1 次；修订检查调用 1 次。费用由密钥所属账户承担。', 'The key is stored outside the project folder (macOS/Linux: ~/.config/argumentor/env; Windows: %APPDATA%\\ArguMentor\\env) and never enters pages, records or release packages. A full review usually makes 4 model calls; each dialogue reply makes 1; a revision check makes 1. Calls are charged to the key owner.')}</p>
    ${service.keyInProjectFolder ? html`<p class="error">${t('⚠ 检测到项目文件夹内的 .env 密钥文件。复制或压缩此文件夹会泄露密钥，请运行 npm run setup 迁移。', '⚠ A .env key file is inside the project folder. Copying or zipping the folder would leak it; run npm run setup to move it.')}</p>` : ''}
    ${result ? html`<p class="${result.ok ? 'ok-text' : 'error'}">${result.ok ? t(`连接正常。账户可用模型：${result.models.join(', ')}。当前模型${result.modelAvailable ? '可用' : '不在列表中'}。`, `Connection OK. Models: ${result.models.join(', ')}. The configured model is ${result.modelAvailable ? 'available' : 'NOT in the list'}.`) : errorText(result.error)}</p>` : ''}
    <div class="dialog-actions">${service.configured ? button('verify', '免费验证连接', 'Verify connection (free)', 'btn secondary') : ''}${button('refresh-service', '刷新状态', 'Refresh status', 'btn secondary')}${button('close-dialog', '关闭', 'Close')}</div>`);
}
function glossaryDialog() {
  openDialog(html`<h2>${t('术语表', 'Glossary')}</h2><table class="glossary"><tbody>${Object.entries(GLOSSARY).map(([term, value]) => html`<tr><td lang="en"><b>${term}</b></td><td>${tx(value)}</td></tr>`)}</tbody></table><div class="dialog-actions">${button('close-dialog', '关闭', 'Close')}</div>`);
}
function accessCodeDialog() {
  openDialog(html`<h2>${t('课堂访问码', 'Class access code')}</h2><p>${t('教师为本课堂服务设置了访问码。', 'Your teacher has set an access code for this classroom server.')}</p>
    <div class="field"><label for="access-code">${t('访问码', 'Access code')}</label><input id="access-code" autocomplete="off"></div>
    <div class="dialog-actions">${button('save-access-code', '确定', 'OK')}</div>`);
}
function staleRecordDialog() {
  openDialog(html`<h2>${t('继续之前的记录？', 'Continue the previous record?')}</h2>
    <p>${t(`这个浏览器里有一份保存于 ${stamp(state.savedAt)} 的学习记录。如果这不是你的记录（例如在公用电脑上），请先导出或清空。`, `This browser holds a record saved on ${stamp(state.savedAt)}. If it is not yours (for example on a shared computer), export or clear it first.`)}</p>
    <div class="dialog-actions">${button('clear-now', '清空，重新开始', 'Clear and start fresh', 'btn secondary')}${button('close-dialog', '继续这份记录', 'Continue this record')}</div>`);
}

// ---------- actions ----------
async function refreshService() {
  try {
    const data = await api.status();
    service = { configured: data.configured === true, online: true, live: data.live !== false, model: String(data.model || ''), mode: String(data.mode || 'multi'), provider: String(data.provider || ''), accessCodeRequired: Boolean(data.accessCodeRequired), keyInProjectFolder: Boolean(data.keyInProjectFolder), remainingCalls: Number(data.remainingCalls || 0) };
  } catch {
    service = { ...service, configured: false, online: false };
  }
}

function buildPriorRounds() {
  return state.rounds.slice(-2).map(round => ({
    round: round.id,
    priorities: priorities(round).map(item => ({ id: item.id, target: item.target, text: item.text, decision: round.decisions[item.id]?.decision || '', reason: round.decisions[item.id]?.reason || '', status: round.check?.result?.checks?.find(check => check.priorityId === item.id)?.status || '' })),
    insights: insightsList(round).map(item => item.text).slice(0, 6),
    questionsAsked: (round.results.socratic?.questions || []).map(item => item.text)
  }));
}

function handleReviewEvent(round, event) {
  if (event.type === 'begin') round.meta = { ...round.meta, runId: event.runId, provider: event.provider, model: event.model, live: event.live, mode: event.mode, promptVersion: event.promptVersion, appVersion: event.appVersion };
  if (event.type === 'queued') ui.queue = event.position;
  if (event.type === 'start' && ROLES.includes(event.role)) { ui.queue = 0; ui.statuses[event.role] = 'running'; }
  if ((event.type === 'repair' || event.type === 'regenerate') && ROLES.includes(event.role)) ui.statuses[event.role] = 'repairing';
  if (event.type === 'result' && ROLES.includes(event.role)) {
    try {
      round.results[event.role] = normalizeRoleResult(event.result, event.role);
      ui.statuses[event.role] = 'done';
    } catch {
      round.roleErrors[event.role] = 'INVALID_MODEL_OUTPUT';
      ui.statuses[event.role] = 'error';
    }
  }
  if (event.type === 'role-error' && ROLES.includes(event.role)) { round.roleErrors[event.role] = event.error; ui.statuses[event.role] = 'error'; }
  if (event.type === 'done') {
    round.status = event.complete ? 'complete' : 'partial';
    round.roleErrors = { ...round.roleErrors, ...(event.errors || {}) };
    round.meta = { ...round.meta, ...event.meta, consent: ui.consent ? { version: ui.consent.version, at: ui.consent.at } : null };
  }
  const doneCount = ROLES.filter(role => round.results[role]).length;
  ui.liveMessage = event.type === 'done' ? t('反馈已完成。', 'Feedback complete.') : event.type === 'queued' ? t(`排队中，第 ${event.position} 位。`, `Queued, position ${event.position}.`) : t(`已返回 ${doneCount}/4 个角色。`, `${doneCount} of 4 roles returned.`);
  renderCoachOutput();
}

async function runReview() {
  if (ui.busy) return;
  if (ui.demo) return notify('演示为只读模式。', 'The demo is read-only.');
  let input;
  try { input = validateInput(state.data); } catch (error) { return showFieldError(error); }
  if (!service.configured) { ui.error = { code: 'NOT_CONFIGURED' }; return render(); }
  const last = latestRound();
  if (last?.input && sameInput(last.input, input)) { ui.error = { code: 'NO_CHANGES' }; return render(); }
  let self;
  try { self = validateSelfAssessment(ui.selfDraft, input); } catch (error) {
    const field = error.field === 'self.element' ? 'self.element' : `self.${error.field === 'selfReason' ? 'reason' : error.field === 'selfQuestion' ? 'question' : 'reason'}`;
    error.field = field;
    if (error.message === 'MISSING_INPUT' || error.message === 'TOO_SHORT') error.message = error.field === 'self.question' ? error.message : 'SELF_ASSESSMENT_REQUIRED';
    return showFieldError(error);
  }
  if (!ui.consent) { ui.error = { code: 'CONSENT_REQUIRED' }; ui.focusAfterRender = 'consent'; return render(); }
  if (service.accessCodeRequired && !api.accessCode()) return accessCodeDialog();

  const round = newRound((last?.id || 0) + 1, input);
  round.self = self;
  round.startedAt = nowIso();
  round.status = 'running';
  ui.pending = round;
  ui.busy = 'review';
  ui.statuses = {};
  ui.error = null;
  ui.fieldError = null;
  ui.queue = 0;
  logEvent('review-start', `round ${round.id}`);
  render();
  ui.aborter = new AbortController();
  const timer = setTimeout(() => ui.aborter?.abort('timeout'), 300000);
  try {
    await api.review({ input, task: state.task, consent: true, consentVersion: CONSENT_VERSION, self, round: round.id, priorRounds: buildPriorRounds(), learnerGoal: lastGoal(), framesRequested: ui.framesRequested }, { signal: ui.aborter.signal, onEvent: event => handleReviewEvent(round, event) });
    if (!round.results.analyst) throw new Error('CONNECTION_ERROR');
  } catch (error) {
    ui.error = { code: ERRORS[error.message] ? error.message : 'CONNECTION_ERROR', field: error.field || '' };
    if (error.message === 'ACCESS_CODE_REQUIRED') api.setAccessCode('');
  } finally {
    clearTimeout(timer);
    if (round.results.analyst) {
      if (round.status === 'running') round.status = 'partial';
      state.rounds.push(round);
      state.rounds = state.rounds.slice(-8);
      state.current = state.rounds.length - 1;
      resetRoundUI();
      logEvent('review', `${round.status} · ${round.meta.calls || 0} calls · ${round.meta.tokens || 0} tokens`);
    } else {
      logEvent('review-failed', ui.error?.code || 'unknown');
    }
    ui.pending = null;
    ui.busy = null;
    ui.aborter = null;
    ui.statuses = {};
    ui.queue = 0;
    save(true);
    await refreshService();
    render();
    if (round.results.coordinator) document.getElementById('card-coordinator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function threadQuestion(round, id, kind) {
  if (kind === 'question') {
    const item = round.results.socratic?.questions?.find(entry => entry.id === id);
    return item ? { id, kind, type: item.type, target: item.target, text: item.text } : null;
  }
  const item = [...(round.results.analyst?.items || []), ...(round.results.language?.items || []), ...priorities(round)].find(entry => entry.id === id);
  return item ? { id, kind, type: 'feedback', target: item.target, text: item.text } : null;
}

async function sendReply(id, kind) {
  if (ui.busy) return;
  if (ui.demo) return notify('演示为只读模式。', 'The demo is read-only.');
  const round = latestRound();
  const question = round && threadQuestion(round, id, kind);
  if (!question) return;
  let text;
  try { text = validateLearnerText(ui.replyDrafts[id], 'reply', { minWords: 2 }); } catch (error) {
    if (error.message === 'PII_DETECTED') { ui.threadErrors[id] = 'PII_DETECTED'; return render(); }
    ui.threadErrors[id] = error.message === 'MISSING_INPUT' ? 'TOO_SHORT' : error.message;
    return render();
  }
  if (!ui.consent) { ui.threadErrors[id] = 'CONSENT_REQUIRED'; return render(); }
  const thread = round.dialogue[id] || { kind, closed: false, takeaway: '', turns: [] };
  const turns = [...thread.turns.map(turn => ({ from: turn.from, text: turn.text })), { from: 'learner', text }];
  ui.busy = `dialogue:${id}`;
  ui.threadErrors[id] = '';
  render();
  try {
    const reply = await api.dialogue({ input: round.input, task: state.task, consent: true, consentVersion: CONSENT_VERSION, question, thread: turns }, AbortSignal.timeout(120000));
    const at = nowIso();
    thread.turns = [...thread.turns, { from: 'learner', text, move: '', insight: '', at }, { from: 'coach', text: reply.reply, move: reply.move, insight: reply.insight || '', at }];
    thread.closed = Boolean(reply.final);
    round.dialogue[id] = thread;
    ui.replyDrafts[id] = '';
    logEvent(kind === 'feedback' ? 'clarify' : 'dialogue', `${id} ${reply.move}${reply.guard?.repaired ? ' repaired' : ''}`);
  } catch (error) {
    ui.threadErrors[id] = ERRORS[error.message] ? error.message : 'CONNECTION_ERROR';
  } finally {
    ui.busy = null;
    save(true);
    ui.focusAfterRender = idOf(`reply-${id}`);
    render();
  }
}

async function runCheck() {
  if (ui.busy || ui.demo) return;
  const round = latestRound();
  const list = priorities(round);
  ui.checkError = null;
  if (!list.length || !list.every(item => round.decisions[item.id]?.decision) || countWords(round.revised) < 20) { ui.checkError = 'CHECK_NEEDS_DECISIONS'; return render(); }
  try { validateLearnerText(round.revised, 'revised', { minWords: 20 }); } catch (error) { ui.checkError = error.message; return render(); }
  if (!ui.consent) { ui.checkError = 'CONSENT_REQUIRED'; return render(); }
  ui.busy = 'check';
  render();
  try {
    const decisions = Object.fromEntries(list.filter(item => round.decisions[item.id]).map(item => [item.id, { decision: round.decisions[item.id].decision, reason: round.decisions[item.id].reason || '' }]));
    // Snapshot the text being checked: Step 4 stays editable while this request is in flight.
    const revised = round.revised;
    const response = await api.revisionCheck({ input: round.input, task: state.task, consent: true, consentVersion: CONSENT_VERSION, priorities: list.map(({ id, target, text, successCheck }) => ({ id, target, text, successCheck })), decisions, insights: insightsList(round).map(item => item.text), revised }, AbortSignal.timeout(120000));
    round.check = { at: nowIso(), revised, meta: { servedModel: response.meta?.servedModel || '', promptVersion: response.meta?.promptVersion || '', tokens: response.meta?.tokens || 0 }, result: response.result };
    logEvent('check', response.result.checks.map(item => `${item.priorityId}:${item.status}`).join(' '));
  } catch (error) {
    ui.checkError = ERRORS[error.message] ? error.message : 'CONNECTION_ERROR';
  } finally {
    ui.busy = null;
    save(true);
    render();
  }
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportRecord(kind) {
  if (state.learnerCode && screenPII(state.learnerCode)) return notify('学习者代码看起来像个人信息，请改用教师给的代码。', 'The learner code looks like personal information; use the code from your teacher.');
  const record = await buildRecord(state, { service, demo: Boolean(ui.demo), example: state.events.some(event => event.type === 'example'), goal: lastGoal() });
  if (kind === 'json') download(fileName(record, 'json'), JSON.stringify(record, null, 2), 'application/json;charset=utf-8');
  else download(fileName(record, 'html'), reportHTML(record, state.lang), 'text/html;charset=utf-8');
  logEvent('export', kind);
  save();
  notify('已导出。', 'Exported.');
}

function archiveAndReset() {
  const round = latestRound();
  const entries = portfolio();
  // Only archive a task the learner actually finished; otherwise an abandoned task would blank the goal.
  if (state.transfer.trim()) entries.push({ at: nowIso(), title: state.task?.title || '', topic: state.data.topic, rounds: state.rounds.length, transfer: state.transfer, finalWords: countWords(round?.revised || '') });
  try { store().setItem(PORTFOLIO, JSON.stringify(entries.slice(-20))); } catch { /* portfolio is optional */ }
  const keep = { lang: state.lang, learnerCode: state.learnerCode };
  state = { ...defaultState(), ...keep };
  resetRoundUI();
  ui.error = null;
  logEvent('new-task');
  save(true);
  go('frame');
  notify('新任务已开始；上一个任务的策略已保存为你的目标。', 'New task started; your last strategy is now your goal.');
}

async function loadDemo(page = 'frame') {
  if (ui.demo) return; // re-entry would overwrite the saved real record with the demo
  try {
    const response = await fetch(DEMO_URL);
    if (!response.ok) throw new Error('missing');
    const demo = await response.json();
    const { state: demoState } = migrateState(demo.state);
    demoState.lang = state.lang;
    demoState.page = page;
    ui.demo = { saved: state, meta: demo.meta || {}, narration: demo.narration || {} };
    state = demoState;
    ui.error = null;
    render();
    $('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    notify('演示文件无法载入。', 'The demo file could not be loaded.');
  }
}
// Actions that replace or erase the learner's own record. They are refused during a demo replay,
// because the real record is held only in ui.demo.saved while the demo is on screen.
function blockedInDemo() {
  if (!ui.demo) return false;
  notify('演示为只读模式，请先退出演示。', 'The demo is read-only. Exit the demo first.');
  return true;
}
function exitDemo() {
  const lang = state.lang;
  state = ui.demo.saved;
  state.lang = lang;
  ui.demo = null;
  render();
}

async function importTask(file) {
  try {
    const task = validateTask(JSON.parse(await file.text()));
    state.task = task;
    if (task.lockTopic || !state.data.topic.trim()) state.data.topic = task.topic;
    if ((task.lockTopic && task.audience) || !state.data.audience.trim()) state.data.audience = task.audience;
    if (task.level) state.data.level = task.level;
    logEvent('task-load', task.title);
    save(true);
    render();
    notify('教师任务已载入。', 'Teacher task loaded.');
  } catch {
    notify(ERRORS.INVALID_TASK.zh, ERRORS.INVALID_TASK.en);
  }
}

function teacherContext() {
  return { state, ui, render, notify, download, openDialog, button, save: () => save(true) };
}

// ---------- events ----------
document.addEventListener('input', event => {
  const element = event.target;
  if (element.closest?.('[data-teacher]')) { teacherInput(event, teacherContext()); return; }
  const { scope, path } = element.dataset || {};
  if (!scope || !path) {
    if (element.id === 'consent') {
      ui.consent = element.checked ? { version: CONSENT_VERSION, at: nowIso() } : null;
      try { if (ui.consent) sessionStorage.setItem(CONSENT_KEY, JSON.stringify(ui.consent)); else sessionStorage.removeItem(CONSENT_KEY); } catch { /* session only */ }
      logEvent('consent', ui.consent ? CONSENT_VERSION : 'withdrawn');
      save();
      if (state.page === 'coach') render();
    }
    return;
  }
  const value = element.type === 'checkbox' ? element.checked : element.value;
  setPath(scope, path, value);
  if (ui.fieldError && ui.fieldError.path === path) {
    ui.fieldError = null;
    element.removeAttribute('aria-invalid');
    element.closest('.field')?.classList.remove('has-error');
    element.closest('.field')?.querySelector('.field-error')?.remove();
  }
  const counter = path === 'draft' ? $('wc-draft') : path === 'revised' ? $('wc-revised') : null;
  if (counter) counter.textContent = counter.textContent.replace(/^\d+/, String(countWords(value)));
  if (scope === 'aiUse' && element.type === 'checkbox') { save(); return render(); }
  if (scope !== 'reply') save();
  if (scope === 'data') { const side = $('side'); if (side) side.innerHTML = String(sidePanel()); }
});

document.addEventListener('change', event => {
  const element = event.target;
  if (element.closest?.('[data-teacher]')) { teacherChange(event, teacherContext()); return; }
  if (element.id === 'task-file' && element.files?.[0]) { importTask(element.files[0]); element.value = ''; return; }
  if (element.tagName === 'SELECT' && element.dataset.scope) {
    setPath(element.dataset.scope, element.dataset.path, element.value);
    save();
    if (element.dataset.path === 'level' || element.dataset.path?.endsWith('.target')) render();
  }
  if (element.type === 'checkbox' && element.dataset.scope === 'state') { setPath('state', element.dataset.path, element.checked); save(); }
});

// 'toggle' does not bubble, so this listener captures.
document.addEventListener('toggle', event => {
  const key = event.target?.dataset?.details;
  if (!key) return;
  if (event.target.open) ui.openDetails.add(key); else ui.openDetails.delete(key);
}, true);

document.addEventListener('paste', event => {
  const element = event.target;
  const path = element?.dataset?.path;
  if (!path || ui.demo) return;
  const length = (event.clipboardData?.getData('text') || '').length;
  if (length >= 40) { logEvent('paste', `${path} ${length} chars`); save(); }
});

document.addEventListener('keydown', event => {
  const element = event.target;
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && element?.dataset?.scope === 'reply') {
    event.preventDefault();
    const box = element.closest('.reply-box')?.querySelector('[data-act="send-reply"]');
    if (box) sendReply(box.dataset.id, box.dataset.kind);
  }
});

document.addEventListener('click', async event => {
  const langButton = event.target.closest('[data-lang]');
  if (langButton) { state.lang = langButton.dataset.lang; save(); render(); return; }
  const target = event.target.closest('[data-act]');
  if (!target || target.disabled) return;
  if (target.closest('[data-teacher]') && teacherClick(event, target, teacherContext())) return;
  const action = target.dataset.act;
  if (target.getAttribute('aria-disabled') === 'true' && ['run', 'run-check'].includes(action)) {
    if (action === 'run') { const snapshot = safeSnapshot(); ui.error = { code: !service.configured ? 'NOT_CONFIGURED' : (latestRound()?.input && snapshot && sameInput(latestRound().input, snapshot)) ? 'NO_CHANGES' : !ui.consent ? 'CONSENT_REQUIRED' : 'INVALID_INPUT' }; if (ui.error.code === 'CONSENT_REQUIRED') ui.focusAfterRender = 'consent'; }
    else ui.checkError = !ui.consent ? 'CONSENT_REQUIRED' : 'CHECK_NEEDS_DECISIONS';
    return render();
  }
  if (STEPS.some(([id]) => id === action) || action === 'guide' || action === 'teacher') return go(action);
  switch (action) {
    case 'to-map':
      if (!state.data.topic.trim() || !state.data.claim.trim()) return showFieldError(Object.assign(new Error('MISSING_INPUT'), { field: state.data.topic.trim() ? 'claim' : 'topic' }));
      for (const key of ['topic', 'audience', 'claim', 'qualifier']) if (englishIssue(state.data[key])) return showFieldError(Object.assign(new Error('ENGLISH_REQUIRED'), { field: key }));
      return go('map');
    case 'to-coach':
      try { validateInput(state.data); go('coach'); } catch (error) { showFieldError(error); }
      return;
    case 'to-revise': {
      const round = latestRound();
      const minimum = state.task?.minDialogue ?? 1;
      const answered = round ? Object.values(round.dialogue).filter(thread => thread.kind !== 'feedback' && thread.turns.some(turn => turn.from === 'learner')).length : 0;
      if (round && !ui.demo && answered < minimum) return confirmDialog(`你只回答了 ${answered} 个追问（建议至少 ${minimum} 个）。回答追问能帮助你决定怎么改。仍要继续吗？`, `You have answered ${answered} question(s) (at least ${minimum} recommended). Answering helps you decide how to revise. Continue anyway?`, () => { logEvent('skip-dialogue', `${answered}/${minimum}`); go('revise'); });
      return go('revise');
    }
    case 'run': return runReview();
    case 'cancel': ui.aborter?.abort('user'); return;
    case 'toggle-frames': ui.framesRequested = target.checked; return;
    case 'toggle-prerun': event.preventDefault(); ui.prerunOpen = !target.closest('details').open; return render();
    case 'view-round': state.current = Number(target.dataset.index); save(); return render();
    case 'send-reply': return sendReply(target.dataset.id, target.dataset.kind);
    case 'finish-thread': {
      const round = latestRound();
      const thread = round?.dialogue[target.dataset.id];
      if (thread) { thread.closed = true; logEvent('thread-finish', target.dataset.id); save(); render(); }
      return;
    }
    case 'goto-field': {
      const path = target.dataset.path;
      if (!path) return;
      const page = pageForPath(path) || 'map';
      if (/^(reply|revised)/.test(path)) return;
      return go(page, idOf(path));
    }
    case 'decide': {
      const round = latestRound();
      const id = target.dataset.id;
      round.decisions[id] = { ...(round.decisions[id] || { reason: '' }), decision: target.dataset.value, at: nowIso() };
      logEvent('decision', `${id} ${target.dataset.value}`);
      ui.focusAfterRender = idOf(`decision-${id}`);
      save();
      return render();
    }
    case 'start-from-draft': { const round = latestRound(); round.revised = round.input?.draft || ''; save(); ui.focusAfterRender = idOf('round-revised'); return render(); }
    case 'toggle-diff': ui.showDiff = !ui.showDiff; return render();
    case 'save-version': {
      const round = latestRound();
      if (!round.revised.trim()) return notify('请先写修订稿。', 'Write your revision first.');
      try { validateLearnerText(round.revised, 'revised'); } catch (error) { return notify(ERRORS[error.message]?.zh || error.message, ERRORS[error.message]?.en || error.message); }
      round.revisions.push({ at: nowIso(), text: round.revised, words: countWords(round.revised) });
      round.revisions = round.revisions.slice(-10);
      logEvent('revision-save', `${countWords(round.revised)} words`);
      save(true);
      notify('修订快照已保存。', 'Revision snapshot saved.');
      return render();
    }
    case 'run-check': return runCheck();
    case 'fill-statement': {
      const write = () => { state.disclosure = generatedStatement(); save(); render(); };
      if (state.disclosure.trim()) return confirmDialog('这将覆盖你已经写好的 AI 使用说明。', 'This will replace the AI-use statement you have written.', write);
      return write();
    }
    case 'export-html': return exportRecord('html');
    case 'export-json': return exportRecord('json');
    case 'next-round': {
      const round = latestRound();
      return confirmDialog('将用你的修订稿替换论证地图中的初稿，然后你可以更新地图并运行新一轮反馈。', 'Your revised text will replace the draft in the map; you can then update the map and run a new round.', () => { state.data.draft = round.revised; logEvent('next-round', `from ${round.id}`); save(true); go('map'); notify('初稿已更新。请检查论证地图是否也需要修改，然后在第 3 步运行新一轮。', 'Draft updated. Check whether the map needs changes too, then run a new round in Step 3.'); });
    }
    case 'new-task': if (blockedInDemo() || ui.busy) return; return confirmDialog('开始新任务前，建议先导出当前记录。当前任务的策略会保存为你下一次的目标，其余内容将被清空。', 'Export your current record first. Your strategy will be kept as your next goal; everything else will be cleared.', archiveAndReset);
    case 'clear': if (blockedInDemo()) return; return confirmDialog('这将清空当前浏览器中的论证、反馈和修订记录。', 'This clears the argument, feedback and revisions in this browser.', () => { const lang = state.lang; forgetEverything(); state = { ...defaultState(), lang }; resetRoundUI(); ui.error = null; save(true); render(); notify('本机记录已清空。', 'Local record cleared.'); });
    case 'clear-now': { if (blockedInDemo()) return; $('dialog').close(); const lang = state.lang; forgetEverything(); state = { ...defaultState(), lang }; resetRoundUI(); save(true); render(); return; }
    case 'toggle-public': {
      if (blockedInDemo()) return;
      const turnOn = !publicMode();
      try {
        const snapshot = JSON.stringify(state);
        if (turnOn) { forgetEverything(); localStorage.setItem(PUBLIC_FLAG, '1'); sessionStorage.setItem(STORAGE, snapshot); }
        else { localStorage.removeItem(PUBLIC_FLAG); localStorage.setItem(STORAGE, snapshot); sessionStorage.removeItem(STORAGE); }
      } catch { /* storage unavailable */ }
      return render();
    }
    case 'example': {
      if (blockedInDemo()) return;
      const load = () => { const lang = state.lang; state = { ...defaultState(), lang, data: structuredClone(EXAMPLE) }; logEvent('example', 'ai-writing'); save(true); render(); notify('教学示例已载入。', 'Teaching example loaded.'); };
      if (state.rounds.length || learnerFields(state.data).length) return confirmDialog('载入示例将替换当前浏览器中的学习记录。', 'Loading the example replaces the current record in this browser.', load);
      return load();
    }
    case 'demo': return loadDemo();
    case 'exit-demo': return exitDemo();
    case 'import-task': return $('task-file')?.click();
    case 'remove-task': return confirmDialog('移除教师任务？你的论证内容会保留。', 'Remove the teacher task? Your argument stays.', () => { state.task = null; save(true); render(); });
    case 'add-argument': if (state.data.arguments.length < MAX_ARGUMENTS) { state.data.arguments.push(blankArgument()); save(); ui.focusAfterRender = idOf(`arguments.${state.data.arguments.length - 1}.reason`); render(); } return;
    case 'add-counter': if (state.data.counters.length < MAX_COUNTERS) { state.data.counters.push(blankCounter()); save(); ui.focusAfterRender = idOf(`counters.${state.data.counters.length - 1}.counter`); render(); } return;
    case 'setup': setupDialog(); return;
    case 'verify': {
      try { const result = await api.verify(AbortSignal.timeout(20000)); setupDialog(result); } catch (error) { setupDialog({ ok: false, error: error.message }); }
      return;
    }
    case 'refresh-service': await refreshService(); setupDialog(); render(); return;
    case 'glossary': return glossaryDialog();
    case 'close-dialog': $('dialog').close(); return;
    case 'confirm': $('dialog').close(); { const action = confirmAction; confirmAction = null; action?.(); } return;
    case 'redact-all': {
      $('dialog').close();
      for (const key of ['topic', 'audience', 'claim', 'qualifier', 'draft']) state.data[key] = redactPII(state.data[key]);
      state.data.arguments.forEach(unit => { for (const key of ['reason', 'evidence', 'warrant']) unit[key] = redactPII(unit[key]); unit.source = redactPII(unit.source, { source: true }); });
      state.data.counters.forEach(unit => { unit.counter = redactPII(unit.counter); unit.response = redactPII(unit.response); });
      logEvent('redact');
      save(true);
      render();
      return notify('已遮蔽可能的个人信息。', 'Possible personal information was redacted.');
    }
    case 'goto-pii': $('dialog').close(); return go(pageForPath(target.dataset.path) || 'map', idOf(target.dataset.path));
    case 'save-access-code': api.setAccessCode($('access-code')?.value || ''); $('dialog').close(); return;
    case 'reload': location.reload(); return;
    case 'dismiss-restore': ui.restoreNotice = null; return render();
    case 'print': window.print(); return;
    default:
      if (action.startsWith('topic-')) { const pack = TOPIC_PACKS[action.slice(6)]; if (pack) { state.data.topic = pack.topic; logEvent('topic', action.slice(6)); save(); render(); } return; }
      if (action.startsWith('remove-argument-') && state.data.arguments.length > 1) {
        const index = Number(action.split('-').at(-1));
        state.data.arguments.splice(index, 1);
        state.data.counters.forEach(unit => { const n = Number(unit.target.slice(7)); if (unit.target !== 'Claim' && n - 1 === index) unit.target = 'Claim'; else if (unit.target !== 'Claim' && n - 1 > index) unit.target = `Reason ${n - 1}`; });
        save(); return render();
      }
      if (action.startsWith('remove-counter-') && state.data.counters.length > 1) { state.data.counters.splice(Number(action.split('-').at(-1)), 1); save(); return render(); }
      if (action.startsWith('clarify-')) { const id = action.slice(8); ui.openClarify[id] = !ui.openClarify[id]; if (ui.openClarify[id]) ui.focusAfterRender = idOf(`reply-${id}`); return render(); }
  }
});

window.addEventListener('storage', event => {
  if (event.key === STORAGE && event.newValue !== null && event.newValue !== lastWritten && !ui.demo) { ui.crossTab = true; render(); }
});
window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); writeSave(); } });

// ---------- start ----------
async function start() {
  load();
  const params = new URLSearchParams(location.search);
  if (params.get('lang') === 'en' || params.get('lang') === 'zh') state.lang = params.get('lang');
  render();
  await refreshService();
  render();
  if (params.get('demo') === '1') return loadDemo(params.get('page') || 'frame');
  const hasWork = state.rounds.length || learnerFields(state.data).length;
  if (hasWork && state.savedAt && Date.now() - Date.parse(state.savedAt) > 12 * 3600 * 1000) staleRecordDialog();
  if (!state.createdAt) { state.createdAt = nowIso(); logEvent('session-start', APP_VERSION); save(); }
}
start();
