import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyTurnToConversation,
  bindDiscourseToIntent,
  ConversationStateStore,
  discoursePreemptsPendingGoal,
  emptyConversationState,
  interpretDiscourse,
  looksLikeProjectFollowUp,
  rewriteWrongRoute,
  uniqueSlugOrClarify,
} from '../src/jarvis/conversation';
import type { ConversationState } from '../src/jarvis/conversation';
import { DESKTOP_OPEN_SCOPED_RESOURCE } from '../src/jarvis/capabilities/actions/constants';
import { PROJECT_BUILD, PROJECT_READ_FILE, PROJECT_RUN_TESTS, PROJECT_START_DEV_SERVER } from '../src/jarvis/project/constants';
import { SOFTWARE_APPLY_BUILD, SOFTWARE_PLAN_BUILD } from '../src/jarvis/build/constants';
import { resolveUserIntent } from '../src/jarvis/intent';
import { compactCapabilityCatalog } from '../src/jarvis/intent/catalog';
import { presenceShouldForwardToJarvis } from '../src/jarvis/ui/presence/presenceRuntime';
import { validateActionInput } from '../src/jarvis/capabilities/actions/schema';

const CATALOG = compactCapabilityCatalog();

function softwareState(patch: Partial<ConversationState> = {}): ConversationState {
  const base = emptyConversationState('jarvis-lab', 1);
  return {
    ...base,
    activeTopic: 'software',
    activeGoalId: 'BUILD_WEBSITE',
    activePlanId: 'plan_portfolio',
    activeProjectSlug: 'portfolio',
    activeWorkspace: 'data/jarvis/builds/portfolio',
    projects: [{ slug: 'portfolio', label: 'Portfolio', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' }],
    referents: { this_project: 'portfolio', this_site: 'portfolio', this_plan: 'plan_portfolio' },
    ...patch,
  };
}

async function resolve(text: string, conversation: ConversationState) {
  return resolveUserIntent(text, { catalog: CATALOG, conversation });
}

test('preview follow-ups bind the active project instead of asking for a slug', () => {
  const state = softwareState();
  for (const phrase of ['เปิดให้ดู', 'เปิดดู', 'preview', 'show me the site']) {
    const discourse = interpretDiscourse(phrase, state);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.kind, 'CAPABILITY', phrase);
    assert.equal(bound?.capabilityId, PROJECT_START_DEV_SERVER, phrase);
    assert.equal(bound?.arguments?.slug, 'portfolio', phrase);
  }
});

test('rerun after a failed test repeats tests, not a generic what-to-run question', () => {
  const state = softwareState({
    recentVerification: { kind: 'test', ok: false, summary: 'smoke failed', at: 2, capabilityId: PROJECT_RUN_TESTS, slug: 'portfolio' },
  });
  const bound = bindDiscourseToIntent(interpretDiscourse('รันใหม่', state), state, 'รันใหม่');
  assert.equal(bound?.capabilityId, PROJECT_RUN_TESTS);
  const again = bindDiscourseToIntent(interpretDiscourse('run that again', state), state, 'run that again');
  assert.equal(again?.capabilityId, PROJECT_RUN_TESTS);
});

test('ordinal follow-ups resolve offered options without asking which list', () => {
  const state = softwareState({
    offeredOptions: [
      { index: 1, label: 'Add a featured project row' },
      { index: 2, label: 'Add a short bio strip' },
    ],
  });
  const first = bindDiscourseToIntent(interpretDiscourse('อันแรก', state), state, 'อันแรก');
  assert.equal(first?.kind, 'CAPABILITY');
  assert.equal(first?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.match(String(first?.arguments?.brief || ''), /featured project/i);
  const second = bindDiscourseToIntent(interpretDiscourse('เอาอันที่สอง', state), state, 'เอาอันที่สอง');
  assert.match(String(second?.arguments?.brief || ''), /bio strip/i);
});

test('resume-the-site is continue, not restore to a leftover todo website', () => {
  const state = softwareState({
    pendingPermission: { proposalId: 'ap-1', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' },
    projects: [
      { slug: 'todo-modern', label: 'Todo App', kind: 'website' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_portfolio' },
    ],
  });
  const discourse = interpretDiscourse('กลับไปทำเว็บต่อ', state);
  assert.equal(discourse.act, 'CONTINUE');
  const bound = bindDiscourseToIntent(discourse, state, 'กลับไปทำเว็บต่อ');
  assert.equal(bound?.reasonCode, 'WAITING_PERMISSION');
  assert.doesNotMatch(String(bound?.userMessage || ''), /Todo/i);

  const restored = bindDiscourseToIntent(interpretDiscourse('กลับไปเว็บ', {
    ...state,
    pendingPermission: undefined,
  }), { ...state, pendingPermission: undefined }, 'กลับไปเว็บ');
  assert.equal(restored?.reasonCode, 'RESTORE_TOPIC');
  assert.match(String(restored?.userMessage || ''), /Portfolio/i);
  assert.doesNotMatch(String(restored?.userMessage || ''), /Todo/i);
});

test('restore-topic does not open a new website goal', () => {
  const state = softwareState({
    topicStack: [{ topic: 'software', projectSlug: 'portfolio', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio', label: 'Portfolio' }],
    activeTopic: 'research',
  });
  for (const phrase of ['กลับไปเว็บ', 'back to the site']) {
    const bound = bindDiscourseToIntent(interpretDiscourse(phrase, state), state, phrase);
    assert.equal(bound?.kind, 'CONVERSATION', phrase);
    assert.equal(bound?.reasonCode, 'RESTORE_TOPIC', phrase);
    assert.notEqual(bound?.capabilityId, SOFTWARE_PLAN_BUILD, phrase);
  }
});

test('dark-mode and button edits bind the current project, not desktop open', async () => {
  const state = softwareState();
  for (const phrase of ['เพิ่ม dark mode ให้มัน', 'เพิ่มปุ่ม clear completed ในเว็บนี้', 'give it dark mode']) {
    const resolved = await resolve(phrase, state);
    assert.notEqual(resolved.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE, phrase);
    assert.ok(
      resolved.capabilityId === SOFTWARE_APPLY_BUILD || resolved.reasonCode === 'CONVERSATION_MODIFY',
      `${phrase} -> ${resolved.capabilityId || resolved.reasonCode}`,
    );
    assert.equal(resolved.arguments?.planId || state.activePlanId, 'plan_portfolio', phrase);
  }
});

test('rebuild with an active project is project.build, not createWorkspace', async () => {
  const state = softwareState();
  for (const phrase of ['build ใหม่', 'rebuild', 'build']) {
    const resolved = await resolve(phrase, state);
    assert.notEqual(resolved.capabilityId, 'project.createWorkspace', phrase);
    assert.equal(resolved.capabilityId, PROJECT_BUILD, phrase);
    assert.equal(resolved.arguments?.slug, 'portfolio', phrase);
  }
});

test('continue resumes the pending plan or permission instead of asking what to do', () => {
  const review = softwareState({
    pendingPlanReview: { planId: 'plan_portfolio', goalId: 'BUILD_WEBSITE', title: 'Portfolio' },
    activeProjectSlug: undefined,
    projects: [],
  });
  const approve = bindDiscourseToIntent(interpretDiscourse('ทำต่อ', review), review, 'ทำต่อ');
  assert.equal(approve?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.equal(approve?.arguments?.planId, 'plan_portfolio');

  const waiting = softwareState({ pendingPermission: { proposalId: 'ap-1', planId: 'plan_portfolio', goalId: 'BUILD_WEBSITE' } });
  const held = bindDiscourseToIntent(interpretDiscourse('ทำต่อ', waiting), waiting, 'ทำต่อ');
  assert.equal(held?.kind, 'CONVERSATION');
  assert.equal(held?.reasonCode, 'WAITING_PERMISSION');
});

test('permission prompts are not reported as failures, and continue after a finished write does not re-apply', () => {
  const afterGrant = softwareState({
    lastError: {
      summary: 'ทำได้ครับ แต่ต้องขอสิทธิ์สร้าง/แก้ไฟล์ ติดตั้ง dependencies รัน build/test และเปิด preview localhost ในโฟลเดอร์โปรเจกต์นี้จนกว่างานนี้จะจบ',
      at: 10,
    },
    recentOperation: {
      kind: 'write',
      ok: true,
      summary: 'สร้างโปรเจกต์ Portfolio แล้ว Preview http://127.0.0.1:4174',
      at: 11,
      slug: 'portfolio',
    },
    activePreview: { url: 'http://127.0.0.1:4174', port: 4174, slug: 'portfolio' },
  });
  const failure = bindDiscourseToIntent(interpretDiscourse('มีอะไรพังไหม', afterGrant), afterGrant, 'มีอะไรพังไหม');
  assert.equal(failure?.kind, 'CONVERSATION');
  assert.match(String(failure?.userMessage || ''), /ยังไม่มี failure/);
  assert.doesNotMatch(String(failure?.userMessage || ''), /ต้องขอสิทธิ์/);

  const resumed = bindDiscourseToIntent(interpretDiscourse('ถ้าไม่มี ทำต่อเลย', afterGrant), afterGrant, 'ถ้าไม่มี ทำต่อเลย');
  assert.notEqual(resumed?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.equal(resumed?.reasonCode, 'CONTINUE_IDLE');
  assert.match(String(resumed?.userMessage || ''), /preview|4174|Portfolio/i);

  const progress = bindDiscourseToIntent(interpretDiscourse('ตอนนี้ถึงไหนแล้ว', afterGrant), afterGrant, 'ตอนนี้ถึงไหนแล้ว');
  assert.match(String(progress?.userMessage || ''), /Portfolio|4174/);
  assert.doesNotMatch(String(progress?.userMessage || ''), /ทั้งหมด \d+ โปรเจกต์/);
});

test('conditional build does not run when the last test failed', () => {
  const failed = softwareState({
    recentVerification: { kind: 'test', ok: false, summary: 'failed', at: 9, slug: 'portfolio' },
  });
  const held = bindDiscourseToIntent(interpretDiscourse('ถ้า test ผ่านก็ build', failed), failed, 'ถ้า test ผ่านก็ build');
  assert.equal(held?.kind, 'CONVERSATION');
  assert.equal(held?.reasonCode, 'CONDITIONAL_HELD');
  assert.notEqual(held?.capabilityId, PROJECT_BUILD);

  const passed = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: 'smoke ok', at: 9, slug: 'portfolio' },
  });
  const go = bindDiscourseToIntent(interpretDiscourse('if tests pass then build', passed), passed, 'if tests pass then build');
  assert.equal(go?.capabilityId, PROJECT_BUILD);
});

test('wrong desktop/createWorkspace routes are rewritten from conversation state', () => {
  const state = softwareState();
  const opened = rewriteWrongRoute({
    kind: 'CAPABILITY',
    capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE,
    arguments: {},
    confidence: 'HIGH',
    reasonCode: 'SEMANTIC_SCOPED_WEB',
    consumed: true,
    source: 'heuristic',
    actionClass: 'ACTIONABLE',
  }, state, 'เปิดให้ดู');
  assert.equal(opened.capabilityId, PROJECT_START_DEV_SERVER);

  const created = rewriteWrongRoute({
    kind: 'CAPABILITY',
    capabilityId: 'project.createWorkspace',
    arguments: {},
    confidence: 'HIGH',
    reasonCode: 'SEMANTIC',
    consumed: true,
    source: 'semantic',
    actionClass: 'ACTIONABLE',
  }, state, 'build ใหม่');
  assert.equal(created.capabilityId, PROJECT_BUILD);
  assert.equal(created.arguments?.slug, 'portfolio');
});

test('two projects make a destructive "old one" ask instead of guessing', () => {
  const state = softwareState({
    projects: [
      { slug: 'portfolio', label: 'Portfolio', kind: 'website' },
      { slug: 'todo-modern', label: 'Todo App', kind: 'software' },
    ],
  });
  const discourse = interpretDiscourse('ลบอันเก่าออก', state);
  assert.equal(discourse.act, 'AMBIGUOUS');
  assert.equal(discourse.requiresClarification, true);
});

test('accumulate requirements stay on the same plan', () => {
  const state = softwareState({
    pendingPlanReview: { planId: 'plan_portfolio', goalId: 'BUILD_WEBSITE', title: 'Portfolio' },
    activeProjectSlug: undefined,
    projects: [],
  });
  const bound = bindDiscourseToIntent(interpretDiscourse('เอาแนว futuristic แต่ไม่รก', state), state, 'เอาแนว futuristic แต่ไม่รก');
  assert.equal(bound?.capabilityId, SOFTWARE_PLAN_BUILD);
  assert.equal(bound?.arguments?.planId, 'plan_portfolio');
  assert.equal(bound?.arguments?.merge, true);
  const lists = {
    applications: [],
    projects: [],
    trustedOrigins: [],
    trustedPathPrefixes: [],
    explorerExecutable: 'C:\\Safe\\explorer.exe',
    workspaceRoot: process.cwd(),
  };
  const allowed = validateActionInput(SOFTWARE_PLAN_BUILD, bound?.arguments || {}, lists);
  assert.equal(allowed.ok, true);
  const applyMerge = validateActionInput(SOFTWARE_APPLY_BUILD, { planId: 'plan_portfolio', brief: 'add about', merge: true }, lists);
  assert.equal(applyMerge.ok, true);
});

test('new todo beside an existing site is a new plan, restore still knows the first project', () => {
  const state = softwareState();
  const created = bindDiscourseToIntent(
    interpretDiscourse('สร้าง todo app เล็กๆ อีกอัน', state),
    state,
    'สร้าง todo app เล็กๆ อีกอัน',
  );
  assert.equal(created?.capabilityId, SOFTWARE_PLAN_BUILD);
  assert.match(String(created?.arguments?.brief || ''), /todo/i);

  const onTodo = softwareState({
    activeProjectSlug: 'todo-app',
    activePlanId: 'plan_todo',
    projects: [
      { slug: 'todo-modern', label: 'Todo App', kind: 'software' },
      { slug: 'todo-app', label: 'Todo App', kind: 'software', planId: 'plan_todo' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_portfolio' },
    ],
    topicStack: [
      { topic: 'software', projectSlug: 'portfolio', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio', label: 'Portfolio' },
    ],
  });
  const bound = bindDiscourseToIntent(interpretDiscourse('กลับไปอันแรก', onTodo), onTodo, 'กลับไปอันแรก');
  assert.equal(bound?.reasonCode, 'RESTORE_TOPIC');
  assert.match(String(bound?.userMessage || ''), /Portfolio/i);
  assert.doesNotMatch(String(bound?.userMessage || ''), /Todo/i);
});

test('conversation state survives a store reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-conversation-'));
  const file = path.join(dir, 'conversation-state.json');
  const store = new ConversationStateStore(file, () => 10);
  store.hydrate({
    sessionId: 'jarvis-lab',
    projects: [{ slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_1', goalId: 'BUILD_WEBSITE' }],
    activePlanId: 'plan_1',
    activeGoalId: 'BUILD_WEBSITE',
  });
  const reloaded = new ConversationStateStore(file, () => 11);
  const state = reloaded.get('jarvis-lab');
  assert.equal(state.activeProjectSlug, 'portfolio');
  assert.equal(state.activePlanId, 'plan_1');
  const slug = uniqueSlugOrClarify(state);
  assert.ok('slug' in slug);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Presence forwards continue/status and unbound ทำเลย to Jarvis instead of swallowing them', () => {
  assert.equal(presenceShouldForwardToJarvis({ voiceFamily: 'WORK_CONTINUE', approval: { kind: 'not-approval' } }), true);
  assert.equal(presenceShouldForwardToJarvis({ voiceFamily: 'TASK_STATUS', approval: { kind: 'not-approval' } }), true);
  assert.equal(presenceShouldForwardToJarvis({ voiceFamily: 'UNKNOWN', approval: { kind: 'unbound' } }), true);
  assert.equal(presenceShouldForwardToJarvis({
    voiceFamily: 'PERMISSION_ALLOW',
    approval: { kind: 'allow', target: { kind: 'confirm', proposalId: 'ap-1', token: 't', label: 'apply' } },
  }), false);
});

test('file inspect does not bind preview, and history is not a preview request', () => {
  const state = softwareState();
  const file = bindDiscourseToIntent(interpretDiscourse('เปิดดู App.jsx', state), state, 'เปิดดู App.jsx');
  assert.equal(file?.capabilityId, 'project.readFile');
  assert.equal(file?.arguments?.relativePath, 'App.jsx');
  const history = interpretDiscourse('เปิด history ให้ดู', state);
  assert.notEqual(history.act, 'PREVIEW');
});

test('negation notes a constraint instead of mutating immediately', () => {
  const state = softwareState();
  const bound = bindDiscourseToIntent(interpretDiscourse('อย่าแตะ navbar', state), state, 'อย่าแตะ navbar');
  assert.equal(bound?.kind, 'CONVERSATION');
  assert.equal(bound?.reasonCode, 'CONSTRAINT_NOTED');
  assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('package inspect reads package.json of the active project', () => {
  const state = softwareState();
  const bound = bindDiscourseToIntent(interpretDiscourse('package อะไรติดตั้งอยู่', state), state, 'package อะไรติดตั้งอยู่');
  assert.equal(bound?.capabilityId, 'project.readFile');
  assert.equal(bound?.arguments?.relativePath, 'package.json');
});

test('looksLikeProjectFollowUp is semantic, not a single canned phrase', () => {
  const state = softwareState();
  assert.equal(looksLikeProjectFollowUp('เปิดให้ดู', state), true);
  assert.equal(looksLikeProjectFollowUp('add a hover state to the cards', state), true);
  assert.equal(looksLikeProjectFollowUp('open Chrome', state), false);
});

test('bare acknowledgement does not merge into a waiting plan', () => {
  const state = softwareState({
    pendingPlanReview: { planId: 'plan_portfolio', goalId: 'BUILD_WEBSITE', title: 'Portfolio' },
  });
  const discourse = interpretDiscourse('โอเค', state);
  assert.equal(discourse.act, 'ACKNOWLEDGE');
  const bound = bindDiscourseToIntent(discourse, state, 'โอเค');
  assert.notEqual(bound?.capabilityId, SOFTWARE_PLAN_BUILD);
  assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('preview port questions are status, not a new preview start', () => {
  const state = softwareState({
    activePreview: { url: 'http://127.0.0.1:4173', port: 4173, slug: 'portfolio' },
  });
  const discourse = interpretDiscourse('ตอนนี้ preview อยู่ port ไหน', state);
  assert.equal(discourse.act, 'STATUS_QUERY');
  const bound = bindDiscourseToIntent(discourse, state, 'ตอนนี้ preview อยู่ port ไหน');
  assert.equal(bound?.kind, 'CONVERSATION');
  assert.match(String(bound?.userMessage || ''), /4173/);
});

test('that-one after a research recommendation notes the choice instead of asking which list', () => {
  const state = softwareState({
    activeTopic: 'research',
    lastDiscourse: 'RESEARCH',
    offeredOptions: [{ index: 1, label: 'Framer Motion' }],
  });
  const bound = bindDiscourseToIntent(interpretDiscourse('โอเค ใช้อันนั้น', state), state, 'โอเค ใช้อันนั้น');
  assert.equal(bound?.reasonCode, 'ORDINAL_NOTED');
  assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('mission queue edits stay on the list until start, then bind the first pending item', () => {
  const queued = softwareState({
    activeTopic: 'queue',
    lastDiscourse: 'QUEUE',
    pendingChange: undefined,
    queue: [
      { id: 'q1', text: 'เพิ่มหน้า Blog', status: 'pending', act: 'MODIFY_PROJECT' },
      { id: 'q2', text: 'รัน test', status: 'pending', act: 'TEST' },
      { id: 'q3', text: 'build', status: 'pending', act: 'BUILD' },
    ],
  });
  const review = bindDiscourseToIntent(interpretDiscourse('ขอดู list ก่อน', queued), queued, 'ขอดู list ก่อน');
  assert.equal(review?.reasonCode, 'QUEUE_REVIEW');
  assert.match(String(review?.userMessage || ''), /Blog/);

  const swapped = interpretDiscourse('สลับข้อ 2 กับ 3', queued);
  assert.equal(swapped.queueOp?.kind, 'swap');

  const start = bindDiscourseToIntent(interpretDiscourse('โอเคเริ่ม', queued), queued, 'โอเคเริ่ม');
  assert.equal(start?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('recent-work bind is consumed context conversation so WorkAgent cannot steal ล่าสุด', async () => {
  const state = softwareState({
    lastOwnerIntent: 'เพิ่ม dark mode',
    recentOperation: { kind: 'write', ok: true, summary: 'UI edit complete', at: 8, slug: 'portfolio' },
  });
  const resolution = await resolve('แล้วเรื่องที่เราทำล่าสุดล่ะ', state);
  assert.equal(resolution.kind, 'CONVERSATION');
  assert.equal(resolution.consumed, true);
  assert.equal(resolution.source, 'context');
  assert.match(String(resolution.userMessage || ''), /Portfolio|dark mode|UI edit/i);
});

test('greetings and recap questions do not get swallowed as pending-goal answers', () => {
  const state = softwareState();
  assert.equal(discoursePreemptsPendingGoal(interpretDiscourse('สวัสดี Jarvis', state)), true);
  assert.equal(discoursePreemptsPendingGoal(interpretDiscourse('แล้วเรื่องที่เราทำล่าสุดล่ะ', state)), true);
  assert.equal(discoursePreemptsPendingGoal(interpretDiscourse('ตอนนี้ใช้โมเดลอะไรอยู่', state)), true);
  assert.equal(discoursePreemptsPendingGoal(interpretDiscourse('ถ้าไม่มีค้าง งั้นเริ่มงานใหม่กัน', state)), true);
  assert.equal(discoursePreemptsPendingGoal(interpretDiscourse('อนุญาตงานนี้', state)), false);
  assert.equal(discoursePreemptsPendingGoal(interpretDiscourse('ทำเลย', state)), false);
});

test('pending-work questions report the active goal instead of pretending the queue is empty', () => {
  const state = softwareState();
  const bound = bindDiscourseToIntent(interpretDiscourse('what is left', state), state, 'what is left');
  assert.match(String(bound?.userMessage || ''), /BUILD_WEBSITE|Portfolio/);
  assert.doesNotMatch(String(bound?.userMessage || ''), /ไม่มีคิวค้าง/);
});

test('start-new-work acknowledgements do not invent a website goal', () => {
  const state = softwareState();
  for (const phrase of ['ถ้าไม่มีค้าง งั้นเริ่มงานใหม่กัน', "let's start something new"]) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'START_FRESH', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.kind, 'CONVERSATION', phrase);
    assert.equal(bound?.reasonCode, 'START_FRESH', phrase);
    assert.notEqual(bound?.capabilityId, SOFTWARE_PLAN_BUILD, phrase);
    assert.match(String(bound?.userMessage || ''), /งานค้าง|Portfolio|BUILD_WEBSITE|อยากให้ทำอะไร/i, phrase);
  }
});

test('blocked WorkAgent dumps are not treated as recent owner work', () => {
  const state = softwareState({
    lastOwnerIntent: 'เพิ่ม dark mode',
    recentOperation: {
      kind: 'inspect',
      ok: false,
      summary: 'Blocked for “แล้วเรื่องที่เราทำล่าสุดล่ะ”. Current blocker: MISSING_CAPABILITY at unbound.apply.',
      at: 8,
      slug: 'portfolio',
    },
  });
  const bound = bindDiscourseToIntent(interpretDiscourse('แล้วเรื่องที่เราทำล่าสุดล่ะ', state), state, 'แล้วเรื่องที่เราทำล่าสุดล่ะ');
  assert.match(String(bound?.userMessage || ''), /Portfolio|dark mode/i);
  assert.doesNotMatch(String(bound?.userMessage || ''), /MISSING_CAPABILITY|unbound\.apply|Blocked for/);
});

test('recent-work follow-ups recap conversation state instead of researching the word ล่าสุด', () => {
  const state = softwareState({
    lastOwnerIntent: 'เพิ่ม dark mode',
    recentOperation: { kind: 'write', ok: true, summary: 'UI edit complete', at: 8, slug: 'portfolio' },
  });
  const phrase = 'แล้วเรื่องที่เราทำล่าสุดล่ะ';
  const discourse = interpretDiscourse(phrase, state);
  assert.equal(discourse.act, 'STATUS_QUERY');
  assert.equal(discourse.statusFocus, 'recent');
  const bound = bindDiscourseToIntent(discourse, state, phrase);
  assert.equal(bound?.kind, 'CONVERSATION');
  assert.match(String(bound?.userMessage || ''), /Portfolio|dark mode|UI edit/i);
  assert.notEqual(bound?.capabilityId, 'research.current');
});

test('readiness questions ask runtime status instead of dumping the active project list', () => {
  const state = softwareState();
  for (const phrase of ['พร้อมทำงานไหม', 'are you ready', 'ready to work']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'STATUS_QUERY', phrase);
    assert.equal(discourse.statusFocus, 'readiness', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.capabilityId, 'jarvis.runtimeStatus', phrase);
    assert.doesNotMatch(String(bound?.userMessage || ''), /โปรเจกต์|Todo|portfolio/i, phrase);
  }
  const pending = bindDiscourseToIntent(interpretDiscourse('ตอนนี้มีงานอะไรค้างอยู่', state), state, 'ตอนนี้มีงานอะไรค้างอยู่');
  assert.equal(pending?.kind, 'CONVERSATION');
  assert.match(String(pending?.userMessage || ''), /BUILD_WEBSITE|Portfolio/i);
  assert.doesNotMatch(String(pending?.userMessage || ''), /ไม่มีคิวค้าง|ยังไม่มีงานค้าง/);
  const idlePending = bindDiscourseToIntent(
    interpretDiscourse('ตอนนี้มีงานอะไรค้างอยู่', emptyConversationState('jarvis-lab')),
    emptyConversationState('jarvis-lab'),
    'ตอนนี้มีงานอะไรค้างอยู่',
  );
  assert.match(String(idlePending?.userMessage || ''), /ยังไม่มีงานค้าง/);
  const verified = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: 'smoke ok', at: 9, capabilityId: PROJECT_RUN_TESTS, slug: 'portfolio' },
  });
  const passed = bindDiscourseToIntent(interpretDiscourse('ผ่านไหม', verified), verified, 'ผ่านไหม');
  assert.match(String(passed?.userMessage || ''), /test.*ผ่าน|ผ่าน.*smoke/i);
});

test('vague help is not treated as continue-current-work', () => {
  const state = softwareState();
  assert.equal(interpretDiscourse('ช่วยทำหน่อย', state).act, 'UNKNOWN');
  assert.notEqual(interpretDiscourse('ถ้าไม่มี ทำต่อเลย', state).act, 'UNKNOWN');
});

test('only a brief greeting is consumed; longer hello sentences still reach the model', () => {
  assert.equal(interpretDiscourse('สวัสดี Jarvis', emptyConversationState('jarvis-lab')).act, 'GREET');
  assert.equal(interpretDiscourse('hello from keyboard', emptyConversationState('jarvis-lab')).act, 'UNKNOWN');
});

test('research follow-ups stay on research; choose-one recommends instead of a new dictionary search', () => {
  const state = softwareState({
    lastDiscourse: 'RESEARCH',
    activeTopic: 'research',
    lastResearchQuery: 'Framer Motion vs GSAP for this portfolio',
    lastOwnerIntent: 'ผมอยากรู้ว่า Framer Motion กับ GSAP อันไหนเหมาะกับเว็บนี้กว่า',
    offeredOptions: [
      { index: 1, label: 'Framer Motion' },
      { index: 2, label: 'GSAP' },
    ],
    pendingChange: 'เอาแบบที่เบากว่าและทำ animation หน้าเว็บได้สวย',
  });
  const criteria = 'เอาแบบที่เบากว่าและทำ animation หน้าเว็บได้สวย';
  const criteriaBound = bindDiscourseToIntent(interpretDiscourse(criteria, state), state, criteria);
  assert.equal(criteriaBound?.capabilityId, 'research.current');
  assert.match(String(criteriaBound?.arguments?.query || ''), /Framer|GSAP/i);
  assert.notEqual(criteriaBound?.capabilityId, SOFTWARE_APPLY_BUILD);

  const pick = bindDiscourseToIntent(interpretDiscourse('เลือกมาอันเดียว', state), state, 'เลือกมาอันเดียว');
  assert.equal(pick?.kind, 'CONVERSATION');
  assert.equal(pick?.reasonCode, 'RESEARCH_RECOMMEND');
  assert.notEqual(pick?.capabilityId, 'research.current');
  assert.match(String(pick?.userMessage || ''), /Framer|Motion/i);
  assert.doesNotMatch(String(pick?.userMessage || ''), /GSAP ครับ เหมาะ/i);
  assert.doesNotMatch(String(pick?.arguments?.query || ''), /อันเดียว/);

  const composed = bindDiscourseToIntent(
    interpretDiscourse(criteria, { ...state, lastResearchQuery: 'Framer Motion vs GSAP for this portfolio', offeredOptions: [] }),
    { ...state, lastResearchQuery: 'Framer Motion vs GSAP for this portfolio', offeredOptions: [] },
    criteria,
  );
  assert.match(String(composed?.arguments?.query || ''), /Framer|GSAP/i);

  const intoPlan = interpretDiscourse('เอาไปใส่ในแผนด้วย', state);
  assert.notEqual(intoPlan.act, 'RESEARCH');
});

test('negation plus a positive edit is a constrained modification, not a new goal', () => {
  const state = softwareState();
  const discourse = interpretDiscourse('เพิ่ม animation แต่ไม่เอาหน้า contact', state);
  assert.equal(discourse.act, 'MODIFY_PROJECT');
  assert.match(String(discourse.constraint || ''), /contact/i);
});

test('natural text grant binds the pending proposal instead of card-only talk', () => {
  const state = softwareState({
    pendingPermission: { proposalId: 'ap-grant-1', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' },
  });
  for (const phrase of ['อนุญาตงานนี้', 'allow this goal', 'อนุญาต']) {
    const bound = bindDiscourseToIntent(interpretDiscourse(phrase, state), state, phrase);
    assert.equal(bound?.reasonCode, 'GRANT_PENDING_PERMISSION', phrase);
    assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD, phrase);
  }
});

test('conditional chains bind test then build then preview and stop after a failed test', () => {
  const held = bindDiscourseToIntent(
    interpretDiscourse('ถ้า test ผ่านให้ build แล้วถ้า build ผ่านเปิด preview', softwareState({
      recentVerification: { kind: 'test', ok: false, summary: 'failed', at: 9, slug: 'portfolio' },
    })),
    softwareState({ recentVerification: { kind: 'test', ok: false, summary: 'failed', at: 9, slug: 'portfolio' } }),
    'ถ้า test ผ่านให้ build แล้วถ้า build ผ่านเปิด preview',
  );
  assert.equal(held?.reasonCode, 'CONDITIONAL_HELD');
  assert.equal(held?.extraCalls, undefined);

  const chain = bindDiscourseToIntent(
    interpretDiscourse('ถ้า test ผ่านให้ build แล้วถ้า build ผ่านเปิด preview', softwareState()),
    softwareState(),
    'ถ้า test ผ่านให้ build แล้วถ้า build ผ่านเปิด preview',
  );
  assert.equal(chain?.capabilityId, PROJECT_RUN_TESTS);
  assert.equal(chain?.extraCalls?.[0]?.id, PROJECT_BUILD);
  assert.equal(chain?.extraCalls?.[1]?.id, PROJECT_START_DEV_SERVER);

  for (const phrase of ['เสร็จแล้ว test build แล้วเปิดให้ดู', 'test then build then preview']) {
    const bound = bindDiscourseToIntent(interpretDiscourse(phrase, softwareState()), softwareState(), phrase);
    assert.equal(bound?.capabilityId, PROJECT_RUN_TESTS, phrase);
    assert.ok((bound?.extraCalls || []).some(item => item.id === PROJECT_BUILD), phrase);
    assert.ok((bound?.extraCalls || []).some(item => item.id === PROJECT_START_DEV_SERVER), phrase);
  }
});

test('code referents let a later edit target the inspected file', () => {
  const state = softwareState({
    activeProjectSlug: 'todo-modern',
    projects: [{ slug: 'todo-modern', label: 'Todo App', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_todo' }],
    referents: { this_project: 'todo-modern', this_app: 'todo-modern' },
  });
  const inspect = bindDiscourseToIntent(interpretDiscourse('function ไหนจัดการ todo', state), state, 'function ไหนจัดการ todo');
  assert.equal(inspect?.capabilityId, PROJECT_READ_FILE);
  assert.equal(inspect?.arguments?.relativePath, 'src/App.jsx');
  const next = applyTurnToConversation(state, {
    ownerText: 'function ไหนจัดการ todo',
    discourse: interpretDiscourse('function ไหนจัดการ todo', state),
    resolution: inspect!,
  });
  assert.equal(next.referents.this_file, 'src/App.jsx');
  const edit = bindDiscourseToIntent(interpretDiscourse('ตรงนั้นแหละ เพิ่ม filter completed', next), next, 'ตรงนั้นแหละ เพิ่ม filter completed');
  assert.equal(edit?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.match(String(edit?.arguments?.brief || ''), /filter completed/i);
  assert.match(String(edit?.arguments?.brief || ''), /App\.jsx/i);
});

test('resume-the-site wording stays on the active project across paraphrases', () => {
  const state = softwareState({
    projects: [
      { slug: 'todo-modern', label: 'Todo App', kind: 'website' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_portfolio' },
    ],
  });
  for (const phrase of ['กลับไปทำเว็บต่อ', 'กลับมาที่เว็บไซต์', 'มาทำเว็บต่อ']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'CONTINUE', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.doesNotMatch(String(bound?.userMessage || ''), /Todo/i, phrase);
  }
});
