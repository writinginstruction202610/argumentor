// i18n.mjs — interface text catalogue (Chinese / English). Learner writing and AI feedback stay in English;
// only the interface switches language. Reused strings live here; one-off sentences use t(zh, en) in place.
import { pair, GLOSSARY, CONSENT_VERSION } from './core.mjs';
import { esc, raw } from './html.mjs';

let current = 'zh';
export const setLang = lang => { current = lang === 'en' ? 'en' : 'zh'; };
export const getLang = () => current;
export const t = (zh, en) => (current === 'zh' ? zh : en);
export const tx = value => (value && typeof value === 'object' ? (value[current] ?? value.en ?? '') : String(value ?? ''));

export const STEPS = [
  ['frame', pair('明确任务', 'Frame'), 'Frame'],
  ['map', pair('构建论证', 'Map'), 'Map'],
  ['coach', pair('追问对话', 'Question'), 'Question'],
  ['revise', pair('自主修订', 'Revise'), 'Revise'],
  ['reflect', pair('检查反思', 'Reflect'), 'Reflect']
];

export const ROLE_NAMES = {
  analyst: pair('论证分析', 'Argument analyst'),
  socratic: pair('苏格拉底式追问', 'Socratic questioner'),
  language: pair('语言教练', 'Language coach'),
  coordinator: pair('修订协调', 'Revision coordinator'),
  guard: pair('诚信守门', 'Integrity guard')
};
export const ROLE_HELP = {
  analyst: pair('按明确标准诊断论证结构，并指出值得保留之处', 'Diagnoses structure against explicit criteria and names what to keep'),
  socratic: pair('依据论证类型的关键问题提出递进追问', 'Asks sequenced critical questions matched to the type of reasoning'),
  language: pair('指向你自己的句子，提供可选择的表达框架', 'Points to your own sentences and offers optional frames'),
  coordinator: pair('把反馈整理为一至两个可检验的修订重点', 'Turns feedback into one or two checkable revision priorities'),
  guard: pair('程序核查引文、改写、语言与引用是否真实', 'Software check for quotes, rewriting, language and invented sources')
};
export const ROLE_SHORT = { analyst: 'A', socratic: 'Q', language: 'L', coordinator: 'R' };

export const LABELS = {
  topic: pair('写作议题', 'Writing question'),
  audience: pair('目标读者', 'Audience'),
  level: pair('英语支持等级', 'English support level'),
  claim: pair('核心主张', 'Claim'),
  qualifier: pair('主张限定（条件与范围）', 'Qualifier (conditions and scope)'),
  reason: pair('支持理由', 'Supporting reason'),
  evidence: pair('证据或例子', 'Evidence or example'),
  evidenceType: pair('证据类型', 'Evidence type'),
  source: pair('来源', 'Source'),
  warrant: pair('推理联系', 'Warrant'),
  counterTarget: pair('这条异议针对', 'This objection targets'),
  counter: pair('不同观点', 'Counterargument'),
  strategy: pair('回应策略', 'Response strategy'),
  response: pair('你的回应', 'Your response'),
  draft: pair('英语初稿', 'English draft'),
  revised: pair('英语修订稿', 'Revised English text'),
  decisionReason: pair('理由', 'Reason'),
  note: pair('整体修订说明（选填）', 'Overall revision note (optional)'),
  transfer: pair('下一次写作的策略', 'Strategy for your next essay'),
  disclosure: pair('AI 使用说明', 'AI-use statement'),
  selfElement: pair('你认为最需要加强的部分', 'The part you think is weakest'),
  selfReason: pair('为什么？（英语，一句话）', 'Why? (one sentence in English)'),
  selfQuestion: pair('想问教练的问题（选填，英语）', 'A question for the coach (optional, English)'),
  learnerCode: pair('学习者代码（化名，如 S07）', 'Learner code (pseudonym, e.g. S07)'),
  reply: pair('你的回答（英语）', 'Your answer (English)')
};

export function fieldLabel(path) {
  if (!path) return '';
  let match = path.match(/^arguments\.(\d+)\.(\w+)$/);
  if (match) return `${t('理由', 'Reason')} ${Number(match[1]) + 1} · ${tx(LABELS[match[2]])}`;
  match = path.match(/^counters\.(\d+)\.(\w+)$/);
  if (match) return `${t('异议', 'Counterargument')} ${Number(match[1]) + 1} · ${tx(LABELS[match[2]])}`;
  return tx(LABELS[path] || pair(path, path));
}

// Targets such as "Reason 2" come from the model in English; show them in the interface language.
export function targetLabel(target) {
  if (!target) return '';
  let match = target.match(/^Reason (\d)$/);
  if (match) return `${t('理由', 'Reason')} ${match[1]}`;
  match = target.match(/^Counterargument (\d)$/);
  if (match) return `${t('异议', 'Counterargument')} ${match[1]}`;
  const map = { Topic: pair('议题', 'Topic'), Audience: pair('读者', 'Audience'), Claim: pair('主张', 'Claim'), Qualifier: pair('限定', 'Qualifier'), Draft: pair('初稿', 'Draft') };
  return tx(map[target] || pair(target, target));
}

export const CHECK_LABELS = {
  scope: { qualified: pair('范围恰当', 'Scope fits evidence'), overbroad: pair('范围过大', 'Broader than evidence'), unclear: pair('立场不清', 'Unclear') },
  answersTopic: { yes: pair('回应议题', 'Answers the question'), partly: pair('部分回应议题', 'Partly answers'), no: pair('未回应议题', 'Does not answer') },
  evidenceStatus: { collected: pair('已收集证据', 'Collected'), source: pair('教师材料', 'Teacher source'), personal: pair('个人经历', 'Personal'), planned: pair('计划中', 'Planned'), hypothetical: pair('假设', 'Hypothetical'), missing: pair('缺少证据', 'Missing') },
  link: { explained: pair('已说明', 'Explained'), partly: pair('部分说明', 'Partly'), missing: pair('未说明', 'Missing') },
  fairness: { fair: pair('公正呈现', 'Fair'), weakened: pair('被弱化', 'Weakened'), missing: pair('缺少异议', 'Missing') },
  responseType: { rebut: pair('反驳', 'Rebut'), concede: pair('让步', 'Concede'), weigh: pair('权衡', 'Weigh'), qualify: pair('限定', 'Qualify'), 'restates-claim': pair('只重复主张', 'Restates claim'), missing: pair('尚无回应', 'No response') }
};
export const CHECK_TONE = { qualified: 'ok', yes: 'ok', collected: 'ok', source: 'ok', explained: 'ok', fair: 'ok', rebut: 'ok', concede: 'ok', weigh: 'ok', qualify: 'ok', partly: 'mid', personal: 'mid', planned: 'mid', unclear: 'mid', overbroad: 'gap', no: 'gap', hypothetical: 'mid', missing: 'gap', weakened: 'gap', 'restates-claim': 'gap' };

export const ERRORS = {
  MISSING_INPUT: pair('请先填写必填内容（写作议题和核心主张）。', 'Fill in the required fields (writing question and claim).'),
  MISSING_REASON: pair('请至少填写一个支持理由。', 'Enter at least one supporting reason.'),
  INVALID_ARGUMENTS: pair('论证单元数量或格式有误。', 'The argument units are invalid.'),
  ENGLISH_REQUIRED: pair('这里需要用英语写作。可以保留括号中的简短中文专名，但不要写中文句子。', 'Please write this in English. Short Chinese names in brackets are fine; Chinese sentences are not.'),
  PII_DETECTED: pair('检测到可能的个人信息（邮箱、手机号、证件号或长数字）。请删除或使用“自动遮蔽”。', 'Possible personal information found (email, phone, ID or long number). Remove it or use "Redact".'),
  INPUT_TOO_LONG: pair('文本过长，请缩短后重试。', 'The text is too long. Shorten it and try again.'),
  INVALID_INPUT: pair('输入格式有误，请检查后重试。', 'Check the input and try again.'),
  TOO_SHORT: pair('内容太短，请再多写几个词。', 'This is too short; please write a few more words.'),
  SELF_ASSESSMENT_REQUIRED: pair('运行前，请先选出你认为最需要加强的部分，并用英语写一句理由。', 'Before running, choose the part you think is weakest and give one English sentence explaining why.'),
  CONSENT_REQUIRED: pair('请先阅读数据说明并勾选同意。', 'Read the data notice and tick the consent box first.'),
  NOT_CONFIGURED: pair('DeepSeek 尚未配置。请打开“连接说明”，在本机保存 API 密钥后重启服务。', 'DeepSeek is not configured. Open the connection guide, save the API key locally and restart the service.'),
  KEY_REJECTED: pair('DeepSeek 未接受当前密钥，请重新运行 npm run setup。', 'DeepSeek rejected the key. Run npm run setup again.'),
  NO_BALANCE: pair('DeepSeek 账户余额不足。', 'The DeepSeek account has insufficient balance.'),
  MODEL_NOT_FOUND: pair('当前模型名称不可用。请运行 npm run check 查看可用模型。', 'The configured model is not available. Run npm run check to list available models.'),
  PROVIDER_LIMIT: pair('DeepSeek 暂时限流，请稍后重试。', 'DeepSeek is temporarily limiting requests. Try again later.'),
  PROVIDER_ERROR: pair('DeepSeek 未完成请求，请检查网络后重试。', 'DeepSeek could not complete the request. Check the network and try again.'),
  PROVIDER_REJECTED_REQUEST: pair('DeepSeek 拒绝了请求参数。请运行 npm run check，或在配置中设置 DEEPSEEK_THINKING=omit。', 'DeepSeek rejected the request parameters. Run npm run check, or set DEEPSEEK_THINKING=omit.'),
  MODEL_DECLINED: pair('模型拒绝讨论这一议题。这不是对你论证的评价；请与教师商量是否更换议题。', 'The model declined this topic. This is not a judgement of your argument; ask your teacher whether to choose another topic.'),
  INVALID_MODEL_OUTPUT: pair('模型输出未通过诚信与格式检查，本次未显示。你可以稍后重试。', 'The model output failed the integrity and format checks and was not shown. You can try again later.'),
  CONNECTION_ERROR: pair('连接中断，本轮未完成；之前的反馈仍然保留。', 'The connection was interrupted; earlier feedback is kept.'),
  TIMEOUT: pair('请求超时，请稍后重试；之前的反馈仍然保留。', 'The request timed out; earlier feedback is kept.'),
  CANCELLED: pair('已停止等待；已发出的请求仍可能计费。', 'Stopped waiting; requests already sent may still be charged.'),
  BUSY: pair('当前排队人数较多，请稍后再试。', 'Too many requests are queued. Try again shortly.'),
  RATE_LIMIT: pair('请求过于频繁，请稍后再试。', 'Too many requests in a short time. Try again later.'),
  BUDGET_LIMIT: pair('今日模型调用额度已用完（由服务器设置）。', 'Today\'s model budget set on the server has been used up.'),
  ACCESS_CODE_REQUIRED: pair('需要课堂访问码。', 'A class access code is required.'),
  HOST_NOT_ALLOWED: pair('该地址未被允许访问。', 'This address is not allowed.'),
  ORIGIN_NOT_ALLOWED: pair('请求来源未被允许。', 'Request origin not allowed.'),
  THREAD_LIMIT: pair('这一追问的对话已达到上限。', 'This dialogue has reached its turn limit.'),
  INVALID_TASK: pair('任务文件无法识别。', 'The task file could not be read.'),
  NO_CHANGES: pair('自上一轮以来论证没有变化。请先根据反馈修改论证或初稿，再请求新一轮反馈。', 'Nothing has changed since the last round. Revise your map or draft before asking for new feedback.'),
  CHECK_NEEDS_DECISIONS: pair('请先对每个修订重点作出决定，并写好至少20个英语单词的修订稿。', 'Decide on each revision priority and write at least 20 English words of revised text first.'),
  INVALID_REQUEST: pair('请求格式有误。', 'The request was invalid.')
};
export const PII_TYPES = { email: pair('邮箱', 'email'), phone: pair('手机号', 'phone number'), 'id-number': pair('证件号', 'ID number'), 'long-number': pair('长数字（如学号）', 'long number (e.g. student number)') };

export const CONSENT_NOTICE = {
  version: CONSENT_VERSION,
  zh: [
    '运行反馈时，本轮的议题、论证地图、初稿、自评，以及你在追问对话和修订检查中提交的英语文本，会经由本机服务发送给 DeepSeek（深度求索）的接口，用于生成反馈。',
    '本工具不会把你的文本用于其他用途，也不保存在任何服务器上；学习记录只保存在当前浏览器中，你可以随时导出或清空。DeepSeek 对接口数据的处理适用其自身的隐私政策。',
    '请不要输入姓名、学号、学校、联系方式或敏感个人经历。系统会在发送前自动检测常见的个人信息。',
    '你可以随时停止使用；不同意时不会发送任何文本。'
  ],
  en: [
    'When you run feedback, this round\'s question, argument map, draft, self-assessment, and the English text you submit in dialogue and revision checks are sent through this local service to DeepSeek\'s API to generate feedback.',
    'This tool does not use your text for anything else and stores nothing on a server; your record stays in this browser, where you can export or clear it at any time. DeepSeek\'s own privacy policy applies to data sent to its API.',
    'Do not enter names, student numbers, schools, contact details, or sensitive personal experiences. Common personal information is checked automatically before sending.',
    'You may stop at any time; nothing is sent unless you agree.'
  ]
};

// Adds a tooltip with the bilingual glossary definition to the first use of each key term.
const TERMS = [
  ['warrant', /\bwarrants?\b/i], ['qualifier', /\bqualif(?:ier|y|ies|ying|ication)s?\b/i], ['counterargument', /\bcounter-?arguments?\b/i],
  ['rebuttal', /\brebut(?:tal)?s?\b/i], ['concession', /\bconce(?:de|ssion)s?\b/i], ['hedge', /\bhedg(?:e|es|ing)\b/i],
  ['booster', /\bboosters?\b/i], ['attribution', /\battribution\b/i], ['cohesion', /\bcohesion\b/i], ['stance', /\bstance\b/i],
  ['assumption', /\bassumptions?\b/i], ['scheme', /\bschemes?\b/i]
];
export function glossify(text) {
  let out = esc(text);
  for (const [key, pattern] of TERMS) {
    out = out.replace(pattern, word => `<abbr class="term" tabindex="0" title="${esc(tx(GLOSSARY[key]))}">${word}</abbr>`);
  }
  return raw(out);
}
