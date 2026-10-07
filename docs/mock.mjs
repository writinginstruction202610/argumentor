// mock.mjs — offline provider for automated tests, development, and key-free practice.
// It returns clearly labelled TEMPLATE feedback anchored in the learner's own words. It is not AI feedback,
// and the interface says so whenever it is active (PROVIDER=mock).

// Order matters: the single-pass and repair prompts embed the other role texts, so they are matched first.
const ROLE_MARKERS = [
  ['ROLE: Single-pass coach', 'single'],
  ['You repair one ArguMentor', 'repair'],
  ['ROLE: Argument analyst', 'analyst'],
  ['ROLE: Socratic questioner', 'socratic'],
  ['ROLE: Language coach', 'language'],
  ['ROLE: Revision coordinator', 'coordinator'],
  ['ROLE: Socratic dialogue partner', 'dialogue'],
  ['ROLE: Revision reviewer', 'check']
];

const words = (text, count) => String(text || '').split(/\s+/).filter(Boolean).slice(0, count).join(' ');
const LABEL = 'Offline template';

function analyst(data) {
  const units = (data.arguments || []).map((unit, index) => ({ unit, index })).filter(item => item.unit.reason);
  const first = units.find(item => !item.unit.warrant) || units.find(item => !item.unit.evidence) || units[0];
  const target = `Reason ${first.index + 1}`;
  const criterion = !first.unit.warrant ? 'warrant' : !first.unit.evidence ? 'evidence' : 'evidence';
  const observations = [{
    criterion,
    target,
    anchor: words(first.unit.reason, 8),
    text: `${LABEL}: ${criterion === 'warrant' ? 'this reason has no explanation of why its evidence supports it.' : 'check whether the evidence for this reason is specific and checkable.'} A sceptical reader may ask how this reason supports the claim.`
  }];
  const counter = (data.counters || [])[0];
  if (counter?.counter && !counter.response) {
    observations.push({ criterion: 'response', target: 'Counterargument 1', anchor: words(counter.counter, 8), text: `${LABEL}: the counterargument has no response yet, so the reader cannot see how you weigh it.` });
  }
  return {
    focus: `${LABEL}: examine how ${target} supports your claim.`,
    schemes: units.map(item => ({ target: `Reason ${item.index + 1}`, scheme: item.unit.evidence ? 'example' : 'other', note: 'Template classification.' })),
    observations
  };
}

function socratic(data, handoff) {
  const first = handoff?.analyst?.observations?.[0] || { target: 'Claim', anchor: words(data.claim, 8) };
  return {
    focus: `${LABEL}: questions to test ${first.target}.`,
    questions: [
      { type: 'evidence', target: first.target, anchor: first.anchor, text: 'What would a sceptical reader need to see before accepting this reason?' },
      { type: 'assumption', target: first.target, anchor: first.anchor, text: 'Which assumption connects your evidence to this reason, and how could you test it?' },
      { type: 'counterargument', target: 'Claim', anchor: words(data.claim, 8), text: 'Who would disagree with your claim most strongly, and what would they say first?' }
    ]
  };
}

function language(data) {
  return {
    focus: `${LABEL}: match the strength of your claim to your evidence.`,
    observations: [{ criterion: 'stance', target: 'Claim', anchor: words(data.claim, 8), text: `${LABEL}: compare how strongly this sentence states the claim with how strong your evidence is.` }],
    frames: ['It is likely that …, although …', 'This suggests that …, provided that …']
  };
}

function coordinator(handoff) {
  const analystItem = handoff?.analyst?.observations?.[0];
  const basedOn = [analystItem?.id, handoff?.socratic?.questions?.[0]?.id].filter(Boolean);
  return {
    focus: `${LABEL}: one revision priority before the next draft.`,
    priorities: [{ target: analystItem?.target || 'Claim', basedOn, text: `${LABEL}: revisit ${analystItem?.target || 'your claim'} and check that a reader can see why the evidence supports it.` }],
    tension: '',
    nextStep: 'Answer question Q1 in the dialogue panel, then revise in Step 4.'
  };
}

function dialogue(payload) {
  const learnerTurns = (payload.thread || []).filter(turn => turn.from === 'learner');
  const last = learnerTurns.at(-1)?.text || '';
  if (payload.finalTurn) return { move: 'close', reply: `${LABEL}: you have explained your thinking about this question. Carry your own idea into the revision.`, insight: words(last, 8) };
  if (payload.question?.kind === 'feedback') return { move: 'clarify', reply: `${LABEL}: this feedback means a reader cannot yet see the link it describes in your own words. Which sentence in your map would you change first?`, insight: '' };
  if (learnerTurns.length >= 2) return { move: 'acknowledge', reply: `${LABEL}: you said something useful here. How could it change your claim or reason?`, insight: words(last, 8) };
  return { move: 'probe', reply: `${LABEL}: what makes you confident about that, and what would a sceptical reader ask next?`, insight: '' };
}

function check(payload) {
  const revised = String(payload.revised || '');
  return {
    focus: `${LABEL}: comparison of your revision with the priorities.`,
    checks: (payload.priorities || []).map(item => ({ priorityId: item.id, status: 'partly', anchor: words(revised, 8), note: `${LABEL}: some change is visible; check whether the priority is fully addressed.` })),
    question: 'Which strategy from this revision could you reuse in your next essay?'
  };
}

function build(kind, payload) {
  const data = payload.learnerData || {};
  if (kind === 'analyst') return analyst(data);
  if (kind === 'socratic') return socratic(data, payload.handoff);
  if (kind === 'language') return language(data);
  if (kind === 'coordinator') return coordinator(payload.handoff);
  if (kind === 'dialogue') return dialogue(payload);
  if (kind === 'check') return check(payload);
  if (kind === 'single') {
    const a = analyst(data);
    const handoff = { analyst: { observations: a.observations.map((item, index) => ({ ...item, id: `A${index + 1}` })) } };
    const s = socratic(data, handoff);
    handoff.socratic = { questions: s.questions.map((item, index) => ({ ...item, id: `S${index + 1}` })) };
    return { analyst: a, socratic: s, language: language(data), coordinator: coordinator(handoff) };
  }
  return typeof payload.candidate === 'object' && payload.candidate ? payload.candidate : {};
}

export function createMockProvider({ model = 'offline-template' } = {}) {
  return {
    name: 'Mock',
    model,
    live: false,
    async complete({ messages }) {
      const system = String(messages?.[0]?.content || '');
      const kind = (ROLE_MARKERS.find(([marker]) => system.includes(marker)) || [null, 'analyst'])[1];
      let payload = {};
      try { payload = JSON.parse(messages?.[1]?.content || '{}'); } catch { payload = {}; }
      return { content: JSON.stringify(build(kind, payload)), finishReason: 'stop', servedModel: model, usage: { prompt: 0, completion: 0, total: 0, cacheHit: 0 }, ms: 3 };
    },
    async listModels() { return [model]; }
  };
}
