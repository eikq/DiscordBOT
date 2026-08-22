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
  optionsFromReply,
  sanitizedRecent,
  compactResearchSpeak,
  compactOwnerSpeak,
} from '../src/jarvis/conversation';
import type { ConversationState } from '../src/jarvis/conversation';
import { DESKTOP_OPEN_SCOPED_RESOURCE } from '../src/jarvis/capabilities/actions/constants';
import { PROJECT_BUILD, PROJECT_READ_FILE, PROJECT_RUN_TESTS, PROJECT_START_DEV_SERVER, PROJECT_STOP_DEV_SERVER } from '../src/jarvis/project/constants';
import { SOFTWARE_APPLY_BUILD, SOFTWARE_PLAN_BUILD } from '../src/jarvis/build/constants';
import { RESEARCH_CURRENT } from '../src/jarvis/research/constants';
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
  assert.equal(first?.kind, 'CONVERSATION');
  assert.equal(first?.reasonCode, 'ORDINAL_NOTED');
  assert.match(String(first?.userMessage || ''), /featured project/i);
  const second = bindDiscourseToIntent(interpretDiscourse('เอาอันที่สอง', state), state, 'เอาอันที่สอง');
  assert.equal(second?.reasonCode, 'ORDINAL_NOTED');
  assert.match(String(second?.userMessage || ''), /bio strip/i);
  const noted = applyTurnToConversation(state, {
    ownerText: 'เอาอันที่สอง',
    discourse: interpretDiscourse('เอาอันที่สอง', state),
    resolution: second!,
  });
  assert.equal(noted.selectedOption?.label, 'Add a short bio strip');
  const doIt = bindDiscourseToIntent(interpretDiscourse('ทำเลย', noted), noted, 'ทำเลย');
  assert.equal(doIt?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.match(String(doIt?.arguments?.brief || ''), /bio strip/i);
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

test('hydrate does not let a leftover draft replace the stacked site plan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-conversation-'));
  const file = path.join(dir, 'conversation-state.json');
  const store = new ConversationStateStore(file, () => 12);
  store.put(softwareState({
    topicStack: [
      { topic: 'software', projectSlug: 'portfolio', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio', label: 'Portfolio' },
      { topic: 'software', projectSlug: 'portfolio', goalId: 'BUILD_WEBSITE', planId: 'plan_leftover', label: 'Portfolio' },
    ],
    activePlanId: 'plan_leftover',
    projects: [{ slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_leftover', goalId: 'BUILD_WEBSITE' }],
  }));
  const next = store.hydrate({
    sessionId: 'jarvis-lab',
    projects: [{ slug: 'portfolio', label: 'Leftover', kind: 'website', planId: 'plan_leftover', goalId: 'BUILD_WEBSITE' }],
    activePlanId: 'plan_leftover',
    pendingPlanReview: { planId: 'plan_leftover', goalId: 'BUILD_WEBSITE', title: 'Leftover' },
  });
  assert.equal(next.activePlanId, 'plan_portfolio');
  assert.equal(next.projects.find(item => item.slug === 'portfolio')?.planId, 'plan_portfolio');
  assert.equal(next.pendingPlanReview, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Presence forwards continue/status and unbound ทำเลย to Jarvis instead of swallowing them', () => {
  assert.equal(presenceShouldForwardToJarvis({ voiceFamily: 'WORK_CONTINUE', approval: { kind: 'not-approval' } }), true);
  assert.equal(presenceShouldForwardToJarvis({ voiceFamily: 'TASK_STATUS', approval: { kind: 'not-approval' } }), true);
  assert.equal(presenceShouldForwardToJarvis({ voiceFamily: 'WAKE', approval: { kind: 'not-approval' } }), true);
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
  assert.equal(file?.arguments?.relativePath, 'src/App.jsx');
  const cards = bindDiscourseToIntent(
    interpretDiscourse('ส่วนไหนจัดการ project cards', state),
    state,
    'ส่วนไหนจัดการ project cards',
  );
  assert.equal(cards?.capabilityId, 'project.readFile');
  assert.equal(cards?.arguments?.relativePath, 'src/App.jsx');
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
  const later = bindDiscourseToIntent(interpretDiscourse('queue เมื่อกี้ล่ะ', queued), queued, 'queue เมื่อกี้ล่ะ');
  assert.equal(later?.reasonCode, 'QUEUE_REVIEW');
  assert.match(String(later?.userMessage || ''), /Blog|test|build/i);

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

test('a leftover waiting plan does not swallow tests, holds, or resume-the-site', () => {
  const waiting = softwareState({
    pendingPlanReview: { planId: 'plan_new', goalId: 'BUILD_WEBSITE', title: 'New leftover' },
  });
  const resume = interpretDiscourse('มาทำ portfolio ของเราต่อกัน', waiting);
  assert.equal(resume.act, 'RESTORE_TOPIC');
  assert.equal(discoursePreemptsPendingGoal(resume), true);
  const testIt = interpretDiscourse('ลองเทสให้ที', waiting);
  assert.equal(testIt.act, 'TEST');
  assert.equal(discoursePreemptsPendingGoal(testIt), true);
  const buildAsk = interpretDiscourse('ล่าสุด build ผ่านไหม', waiting);
  assert.equal(buildAsk.act, 'STATUS_QUERY');
  assert.equal(discoursePreemptsPendingGoal(buildAsk), true);
  const navbar = interpretDiscourse('ส่วนเมนูด้านบนอย่าเปลี่ยนนะ', waiting);
  assert.equal(navbar.act, 'NEGATE');
  assert.equal(discoursePreemptsPendingGoal(navbar), true);
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
  assert.equal(interpretDiscourse('Jarvis', softwareState()).act, 'GREET');
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
    const stored = bindDiscourseToIntent(interpretDiscourse(phrase, softwareState()), softwareState(), phrase);
    assert.equal(stored?.reasonCode, 'CONDITIONAL_STORED', phrase);
    assert.equal(stored?.capabilityId, undefined, phrase);
  }
  const armed = applyTurnToConversation(softwareState(), {
    ownerText: 'เสร็จแล้ว test build แล้วเปิดให้ดู',
    discourse: interpretDiscourse('เสร็จแล้ว test build แล้วเปิดให้ดู', softwareState()),
    resolution: bindDiscourseToIntent(
      interpretDiscourse('เสร็จแล้ว test build แล้วเปิดให้ดู', softwareState()),
      softwareState(),
      'เสร็จแล้ว test build แล้วเปิดให้ดู',
    )!,
  });
  const start = bindDiscourseToIntent(interpretDiscourse('เริ่มเลย', armed), armed, 'เริ่มเลย');
  assert.equal(start?.capabilityId, PROJECT_RUN_TESTS);
  assert.ok((start?.extraCalls || []).some(item => item.id === PROJECT_BUILD));
  assert.ok((start?.extraCalls || []).some(item => item.id === PROJECT_START_DEV_SERVER));
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

test('ellipsis if-pass then build uses last verification instead of running build blindly', () => {
  const failed = softwareState({
    recentVerification: { kind: 'test', ok: false, summary: 'Typed test runner is not attached.', at: 9, slug: 'portfolio' },
  });
  for (const phrase of ['ถ้าผ่านก็ build', 'แล้ว build ต่อเลยถ้าผ่าน', 'if it passes then build']) {
    const discourse = interpretDiscourse(phrase, failed);
    assert.equal(discourse.act, 'CONDITIONAL', phrase);
    const bound = bindDiscourseToIntent(discourse, failed, phrase);
    assert.equal(bound?.reasonCode, 'CONDITIONAL_HELD', phrase);
    assert.notEqual(bound?.capabilityId, PROJECT_BUILD, phrase);
  }

  const passed = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: '12/12', at: 9, slug: 'portfolio' },
  });
  const go = bindDiscourseToIntent(interpretDiscourse('ถ้าผ่านก็ build', passed), passed, 'ถ้าผ่านก็ build');
  assert.equal(go?.capabilityId, PROJECT_BUILD);
});

test('intensity and layout follow-ups stay on the active project', () => {
  const state = softwareState({ pendingPermission: { proposalId: 'ap-hover', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' } });
  const light = interpretDiscourse('อย่าเยอะเกินไปนะ', state);
  assert.equal(light.act, 'NEGATE');
  assert.match(String(light.constraint || ''), /เยอะ|overdo|light/i);

  const sparse = interpretDiscourse('หน้า home ยังดูโล่งไป', softwareState());
  assert.equal(sparse.act, 'MODIFY_PROJECT');

  const hover = bindDiscourseToIntent(
    interpretDiscourse('แล้ว project card ให้ hover นิดหน่อย', state),
    state,
    'แล้ว project card ให้ hover นิดหน่อย',
  );
  assert.equal(hover?.reasonCode, 'WAITING_PERMISSION_NOTED');
  assert.match(String(hover?.userMessage || ''), /hover/i);
});

test('what-to-add offers numbered options and the second choice binds that option', () => {
  const state = softwareState();
  for (const phrase of ['เพิ่มอะไรดี', 'what should we add', 'what to add']) {
    const bound = bindDiscourseToIntent(interpretDiscourse(phrase, state), state, phrase);
    assert.equal(bound?.reasonCode, 'SUGGEST_ADDITIONS', phrase);
    assert.match(String(bound?.userMessage || ''), /2\.\s+Featured project section/i, phrase);
    assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD, phrase);
  }

  const suggested = bindDiscourseToIntent(interpretDiscourse('เพิ่มอะไรดี', state), state, 'เพิ่มอะไรดี');
  const next = applyTurnToConversation(state, {
    ownerText: 'เพิ่มอะไรดี',
    discourse: interpretDiscourse('เพิ่มอะไรดี', state),
    resolution: suggested!,
    replyText: suggested?.userMessage,
  });
  assert.equal(next.offeredOptions[1]?.label, 'Featured project section');
  const picked = bindDiscourseToIntent(interpretDiscourse('เอาอันที่สอง', next), next, 'เอาอันที่สอง');
  assert.equal(picked?.reasonCode, 'ORDINAL_NOTED');
  assert.match(String(picked?.userMessage || ''), /Featured project section/i);
  const chosen = applyTurnToConversation(next, {
    ownerText: 'เอาอันที่สอง',
    discourse: interpretDiscourse('เอาอันที่สอง', next),
    resolution: picked!,
  });
  const doIt = bindDiscourseToIntent(interpretDiscourse('ทำเลย', chosen), chosen, 'ทำเลย');
  assert.equal(doIt?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.match(String(doIt?.arguments?.brief || ''), /Featured project section/i);
});

test('do-it after a correction applies the pending change instead of rerunning tests', () => {
  const state = softwareState({
    pendingChange: 'ไม่ใช่ หมายถึงทั้งเว็บ ไม่ใช่แค่หน้า home',
    lastDiscourse: 'CORRECT',
    recentVerification: { kind: 'test', ok: false, summary: 'not attached', at: 9, slug: 'portfolio' },
  });
  for (const phrase of ['ทำเลย', 'do it', 'go ahead']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'EXECUTE_NOW', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.capabilityId, SOFTWARE_APPLY_BUILD, phrase);
    assert.match(String(bound?.arguments?.brief || ''), /ทั้งเว็บ|home/i, phrase);
  }
});

test('mobile and check-it follow-ups are status, not unsupported or a new apply', () => {
  const state = softwareState({
    activePreview: { url: 'http://127.0.0.1:4174', port: 4174, slug: 'portfolio' },
  });
  for (const phrase of ['แล้วมือถือเป็นไง', 'เช็กให้หน่อย', 'ดีขึ้นไหม']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'STATUS_QUERY', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD, phrase);
    assert.match(String(bound?.userMessage || ''), /Portfolio|4174|preview/i, phrase);
  }
});

test('short-answer preference is remembered, not applied as a rewrite', () => {
  const state = softwareState();
  for (const phrase of ['เสร็จแล้วบอกสั้นๆ', 'ตอบสั้น', 'จำไว้ว่าผมไม่ชอบให้ถามซ้ำถ้ารู้ context อยู่แล้ว']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'MEMORY_STORE', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.reasonCode, 'REMEMBER_PREFERENCE', phrase);
    assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD, phrase);
  }
});

test('recent-change inspect recaps the last edit instead of listing the whole tree', () => {
  const state = softwareState({
    pendingChange: 'เพิ่ม hero section, project highlights',
    recentOperation: {
      kind: 'write',
      ok: true,
      summary: 'สร้างโปรเจกต์ Portfolio แล้ว Preview http://127.0.0.1:4174',
      at: 8,
      files: ['src/App.jsx', 'src/styles.css'],
    },
  });
  const files = bindDiscourseToIntent(interpretDiscourse('ไฟล์ไหนเปลี่ยน', state), state, 'ไฟล์ไหนเปลี่ยน');
  assert.equal(files?.reasonCode, 'INSPECT_RECENT_FILES');
  assert.match(String(files?.userMessage || ''), /App\.jsx/);
  assert.doesNotMatch(String(files?.userMessage || ''), /package-lock/);

  const recapState = softwareState({ pendingChange: 'dark mode ทั้งเว็บ' });
  const recap = bindDiscourseToIntent(interpretDiscourse('เมื่อกี้แก้อะไรไปบ้าง', recapState), recapState, 'เมื่อกี้แก้อะไรไปบ้าง');
  assert.equal(recap?.reasonCode, 'INSPECT_RECENT_CHANGE');
  assert.match(String(recap?.userMessage || ''), /dark mode/i);
});

test('comma-separated assistant suggestions become ordinal options', () => {
  const options = optionsFromReply('จะปรับหน้า home ให้แน่นขึ้น: เพิ่ม hero section, project highlights, skills grid และ CTA button — รอ confirm แล้วเริ่มแก้');
  assert.equal(options[1]?.label, 'project highlights');
  assert.ok(options.length >= 3);
});

test('if-there-is-a-problem-then-fix only mutates when a real failure exists', () => {
  const healthy = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: '12/12', at: 9 },
  });
  const held = bindDiscourseToIntent(interpretDiscourse('ถ้ามีปัญหาก็แก้', healthy), healthy, 'ถ้ามีปัญหาก็แก้');
  assert.equal(held?.reasonCode, 'CONDITIONAL_HELD');
  assert.notEqual(held?.capabilityId, SOFTWARE_APPLY_BUILD);

  const broken = softwareState({
    recentVerification: { kind: 'test', ok: false, summary: 'smoke failed', at: 9, slug: 'portfolio' },
  });
  const fix = bindDiscourseToIntent(interpretDiscourse('ถ้ามีปัญหาก็แก้', broken), broken, 'ถ้ามีปัญหาก็แก้');
  assert.equal(fix?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('research dumps are not shown as the recent working-context line', () => {
  assert.equal(
    sanitizedRecent('ผมหาข้อมูลจาก 6 แหล่ง แหล่งทางการ: google.com, gemini.google.com - [google.com] Googl'),
    'research complete',
  );
});

test('memory recap answers working context instead of dumping every preference', () => {
  const state = softwareState({
    remembered: ['สีหลักเอาประมาณดำ ฟ้า ม่วง', 'animation เบาๆ ไม่รก'],
    constraints: ['แต่ไม่เอาส่วน testimonial'],
    lastOwnerIntent: 'เพิ่ม dark mode ทั้งเว็บ',
  });
  for (const phrase of ['แล้วสีที่ผมเลือกคืออะไร', 'ตอนแรกผมบอกสีอะไร']) {
    const bound = bindDiscourseToIntent(interpretDiscourse(phrase, state), state, phrase);
    assert.equal(bound?.reasonCode, 'CONVERSATION_MEMORY', phrase);
    assert.match(String(bound?.userMessage || ''), /ดำ|ฟ้า|ม่วง/i, phrase);
    assert.doesNotMatch(String(bound?.userMessage || ''), /You asked me to remember/i, phrase);
  }
  const recap = bindDiscourseToIntent(interpretDiscourse('เมื่อกี้เราคุยอะไรกันมาบ้าง', state), state, 'เมื่อกี้เราคุยอะไรกันมาบ้าง');
  assert.match(String(recap?.userMessage || ''), /Portfolio|dark mode|ล่าสุด/i);
  const demoRecap = bindDiscourseToIntent(interpretDiscourse('เมื่อกี้เราทำอะไรไปบ้าง', state), state, 'เมื่อกี้เราทำอะไรไปบ้าง');
  assert.equal(interpretDiscourse('เมื่อกี้เราทำอะไรไปบ้าง', state).statusFocus, 'recent');
  assert.match(String(demoRecap?.userMessage || ''), /Portfolio|dark mode|ล่าสุด/i);
  const history = bindDiscourseToIntent(interpretDiscourse('เปิด history ให้ดู', state), state, 'เปิด history ให้ดู');
  assert.equal(history?.reasonCode, 'OPEN_HISTORY');
  assert.notEqual(history?.kind, 'UNSUPPORTED');
});

test('then-test and look-at-build bind operations, and a blank-page hypothetical does not open desktop', () => {
  const state = softwareState({
    recentVerification: { kind: 'build', ok: true, summary: 'Ran build', at: 9, slug: 'portfolio' },
  });
  assert.equal(interpretDiscourse('แล้ว test', state).act, 'TEST');
  assert.equal(interpretDiscourse('ดู build ก่อน', state).act, 'BUILD');
  assert.equal(interpretDiscourse('แล้ว build', state).act, 'BUILD');
  const hypo = bindDiscourseToIntent(
    interpretDiscourse('สมมติผมบอกว่าหน้าเว็บเปิดแล้วขาวหมด คุณจะทำยังไง', state),
    state,
    'สมมติผมบอกว่าหน้าเว็บเปิดแล้วขาวหมด คุณจะทำยังไง',
  );
  assert.equal(hypo?.reasonCode, 'RECOVERY_PLAN');
  assert.notEqual(hypo?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
});

test('install-if-missing and page inspect stay on the active project files', () => {
  const state = softwareState();
  const install = bindDiscourseToIntent(interpretDiscourse('ถ้ายังติดตั้งให้เลย', state), state, 'ถ้ายังติดตั้งให้เลย');
  assert.equal(install?.capabilityId, SOFTWARE_APPLY_BUILD);
  const pages = bindDiscourseToIntent(interpretDiscourse('ตอนนี้โปรเจกต์นี้มีหน้าอะไรบ้าง', state), state, 'ตอนนี้โปรเจกต์นี้มีหน้าอะไรบ้าง');
  assert.equal(pages?.capabilityId, PROJECT_READ_FILE);
  assert.equal(pages?.arguments?.relativePath, 'src/App.jsx');
});

test('preview-of-it follows the restored project, and a clarified old-preview delete stops the process', () => {
  const restored = softwareState({ lastDiscourse: 'RESTORE_TOPIC' });
  for (const phrase of ['เปิด preview ของมัน', 'open its preview']) {
    const discourse = interpretDiscourse(phrase, restored);
    assert.equal(discourse.act, 'PREVIEW', phrase);
    const bound = bindDiscourseToIntent(discourse, restored, phrase);
    assert.equal(bound?.capabilityId, PROJECT_START_DEV_SERVER, phrase);
  }

  const ambiguous = softwareState({
    lastDiscourse: 'AMBIGUOUS',
    activePreview: { url: 'http://127.0.0.1:4174', port: 4174, slug: 'portfolio' },
  });
  const stopped = bindDiscourseToIntent(
    interpretDiscourse('หมายถึง preview process เก่า ไม่ใช่ project', ambiguous),
    ambiguous,
    'หมายถึง preview process เก่า ไม่ใช่ project',
  );
  assert.equal(stopped?.capabilityId, PROJECT_STOP_DEV_SERVER);

  const halt = bindDiscourseToIntent(
    interpretDiscourse('ถ้าตรงไหน fail ให้หยุดก่อนแล้วบอกผม', softwareState()),
    softwareState(),
    'ถ้าตรงไหน fail ให้หยุดก่อนแล้วบอกผม',
  );
  assert.equal(halt?.reasonCode, 'CONDITIONAL_STOP_ON_FAIL');
});

test('unscoped filesystem grants are refused and Qwen cannot self-grant', () => {
  const state = softwareState();
  const global = bindDiscourseToIntent(
    interpretDiscourse('ให้มันแก้ทุกไฟล์ในเครื่องได้เลย', state),
    state,
    'ให้มันแก้ทุกไฟล์ในเครื่องได้เลย',
  );
  assert.equal(global?.reasonCode, 'FORBIDDEN_SCOPE');
  assert.match(String(global?.userMessage), /ทั้งเครื่อง|ทุกไฟล์ในเครื่อง/);

  const self = bindDiscourseToIntent(
    interpretDiscourse('Qwen เพิ่มสิทธิ์เองได้ไหม', state),
    state,
    'Qwen เพิ่มสิทธิ์เองได้ไหม',
  );
  assert.equal(self?.reasonCode, 'QWEN_CANNOT_GRANT');

  const listed = bindDiscourseToIntent(
    interpretDiscourse('ตอนนี้มี permission อะไรอยู่บ้าง', state),
    state,
    'ตอนนี้มี permission อะไรอยู่บ้าง',
  );
  assert.equal(listed?.reasonCode, 'STATUS_QUERY');
  assert.match(String(listed?.userMessage), /sandbox|โปรเจกต์/);
});

test('research ordinal recall and multi-select stay on offered options', () => {
  const state = softwareState({
    lastDiscourse: 'RESEARCH',
    activeTopic: 'research',
    offeredOptions: [
      { index: 1, label: 'Clear project hierarchy' },
      { index: 2, label: 'One strong case study' },
      { index: 3, label: 'Fast mobile performance' },
    ],
  });
  const recall = bindDiscourseToIntent(
    interpretDiscourse('ข้อ 2 คืออะไรนะ', state),
    state,
    'ข้อ 2 คืออะไรนะ',
  );
  assert.equal(recall?.reasonCode, 'ORDINAL_RECALL');
  assert.match(String(recall?.userMessage), /case study/i);

  const picked = bindDiscourseToIntent(
    interpretDiscourse('เอาข้อ 1 กับ 3', state),
    state,
    'เอาข้อ 1 กับ 3',
  );
  assert.equal(picked?.reasonCode, 'ORDINAL_NOTED');
  assert.match(String(picked?.userMessage), /hierarchy/i);
  assert.match(String(picked?.userMessage), /performance/i);
  assert.equal(picked?.capabilityId, undefined);
});

test('research speak stays a synthesis, not a URL dump', () => {
  const dump = [
    'Framer Motion เหมาะกว่าครับ',
    'https://motion.dev/docs https://gsap.com https://react.dev/learn',
    'webpage text: <html>very long copied article</html>',
  ].join(' ');
  const spoken = compactResearchSpeak(dump);
  assert.match(spoken, /Framer Motion/);
  assert.doesNotMatch(spoken, /https:\/\//);
  assert.ok(spoken.length < dump.length);
});

test('a numbered mission list is a queue even if the last line is preview', () => {
  const list = [
    'เพิ่มหน้า Blog',
    'เพิ่ม search project',
    'ปรับ footer',
    'รัน test',
    'build',
    'เปิด preview',
  ].join('\n');
  const discourse = interpretDiscourse(list, softwareState());
  assert.equal(discourse.act, 'QUEUE');
  assert.equal(discourse.queueItems?.length, 6);
  const bound = bindDiscourseToIntent(discourse, softwareState(), list);
  assert.equal(bound?.reasonCode, 'QUEUE_CAPTURED');
  assert.match(String(bound?.userMessage), /รับคิว 6/);
});

test('scope-to-this-project is a permission bound, not official-source research', () => {
  const state = softwareState({ lastResearchQuery: 'framer vs gsap'.repeat(40) });
  const scoped = bindDiscourseToIntent(
    interpretDiscourse('งั้นเอาเฉพาะ project นี้', state),
    state,
    'งั้นเอาเฉพาะ project นี้',
  );
  assert.equal(scoped?.reasonCode, 'PERMISSION_SCOPED');
  assert.equal(scoped?.capabilityId, undefined);
});

test('research recommendations ignore leftover project-inventory options', () => {
  const state = softwareState({
    lastDiscourse: 'RESEARCH',
    activeTopic: 'research',
    lastResearchQuery: 'portfolio best practice 2026',
    offeredOptions: [
      { index: 1, label: 'Todo App (todo-modern)' },
      { index: 2, label: 'Todo App (todo)' },
      { index: 3, label: 'Portfolio (jarvis-portfolio-modern)' },
    ],
  });
  const picked = bindDiscourseToIntent(
    interpretDiscourse('เลือก 3 อย่างที่คุ้มสุด', state),
    state,
    'เลือก 3 อย่างที่คุ้มสุด',
  );
  assert.notEqual(picked?.reasonCode, 'RESEARCH_RECOMMEND');
  assert.equal(picked?.capabilityId, RESEARCH_CURRENT);
  assert.ok(String(picked?.arguments?.query || '').length <= 200);
});

test('queue append speaks the new item instead of an empty-queue review', () => {
  const state = softwareState({ queue: [] });
  const text = 'เสร็จแล้วเพิ่ม loading animation ต่อท้ายด้วย';
  const discourse = interpretDiscourse(text, state);
  assert.equal(discourse.act, 'QUEUE');
  assert.equal(discourse.queueOp?.kind, 'append');
  const bound = bindDiscourseToIntent(discourse, state, text);
  assert.equal(bound?.reasonCode, 'QUEUE_CAPTURED');
  assert.match(String(bound?.userMessage), /loading animation/i);
  assert.doesNotMatch(String(bound?.userMessage), /ยังไม่มีคิว/);
});

test('principal-project status names the active project instead of leftover inventory', () => {
  const state = softwareState({
    activeProjectSlug: 'todo-app',
    projects: [
      { slug: 'todo-modern', label: 'Todo App', kind: 'website' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website' },
      { slug: 'todo-app', label: 'Todo App', kind: 'website' },
    ],
  });
  for (const phrase of ['project หลักตอนนี้คืออันไหน', 'which is the main project']) {
    const bound = bindDiscourseToIntent(interpretDiscourse(phrase, state), state, phrase);
    assert.match(String(bound?.userMessage), /todo-app/i, phrase);
    assert.doesNotMatch(String(bound?.userMessage), /todo-modern/i, phrase);
  }
});

test('bare pass follow-up is verification after punctuation strip', () => {
  const state = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: '12/12', at: 9, slug: 'todo-app' },
  });
  for (const phrase of ['ผ่าน?', 'ผ่าน']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'STATUS_QUERY', phrase);
    assert.equal(discourse.statusFocus, 'verification', phrase);
  }
});

test('queue append and after-build-before-preview reposition the last pending item', () => {
  let state = softwareState({
    queue: [
      { id: 'q1', text: 'ปรับ footer', status: 'pending', act: 'MODIFY_PROJECT' },
      { id: 'q2', text: 'build', status: 'pending', act: 'BUILD' },
      { id: 'q3', text: 'เปิด preview', status: 'pending', act: 'PREVIEW' },
    ],
  });
  const appendText = 'เสร็จแล้วเพิ่ม loading animation ต่อท้ายด้วย';
  const append = interpretDiscourse(appendText, state);
  assert.equal(append.act, 'QUEUE');
  assert.equal(append.queueOp?.kind, 'append');
  state = applyTurnToConversation(state, {
    ownerText: appendText,
    discourse: append,
    resolution: bindDiscourseToIntent(append, state, appendText)!,
  });
  assert.ok(state.queue.some(item => /loading animation/i.test(item.text)));

  const moveText = 'แต่ทำหลัง build ก่อน preview';
  const move = interpretDiscourse(moveText, state);
  assert.equal(move.queueOp?.kind, 'move');
  assert.match(String(move.queueOp?.after), /build/i);
  assert.match(String(move.queueOp?.before), /preview/i);
  state = applyTurnToConversation(state, {
    ownerText: moveText,
    discourse: move,
    resolution: bindDiscourseToIntent(move, state, moveText)!,
  });
  const labels = state.queue.map(item => item.text.toLocaleLowerCase());
  const loading = labels.findIndex(item => item.includes('loading'));
  const build = labels.findIndex(item => item === 'build');
  const preview = labels.findIndex(item => item.includes('preview'));
  assert.ok(build < loading && loading < preview, labels.join(' | '));
});

test('deploy vercel is an honest gap and prepare-deploy does not fake a release', () => {
  const gap = bindDiscourseToIntent(
    interpretDiscourse('ถ้าผมบอกให้ deploy ขึ้น vercel ตอนนี้ล่ะ', softwareState()),
    softwareState(),
    'ถ้าผมบอกให้ deploy ขึ้น vercel ตอนนี้ล่ะ',
  );
  assert.equal(gap?.reasonCode, 'DEPLOY_UNSUPPORTED');
  assert.match(String(gap?.userMessage), /vercel/i);
  assert.notEqual(gap?.capabilityId, SOFTWARE_APPLY_BUILD);

  const prepare = bindDiscourseToIntent(
    interpretDiscourse('งั้นเตรียมให้พร้อม deploy ก่อน', softwareState()),
    softwareState(),
    'งั้นเตรียมให้พร้อม deploy ก่อน',
  );
  assert.equal(prepare?.reasonCode, 'DEPLOY_PREPARE');
  assert.notEqual(prepare?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('missing recent errors are not invented, and cancel clears a pending rewrite', () => {
  const none = bindDiscourseToIntent(
    interpretDiscourse('error เมื่อกี้เกิดจากอะไร', softwareState()),
    softwareState(),
    'error เมื่อกี้เกิดจากอะไร',
  );
  assert.match(String(none?.userMessage), /ยังไม่มี failure/);

  const noise = softwareState({
    lastError: { summary: 'A scoped open needs an application or URL.', at: 9 },
  });
  const realCheck = bindDiscourseToIntent(
    interpretDiscourse('โอเค ตอนนี้เช็กของจริงว่ามีปัญหาไหม', noise),
    noise,
    'โอเค ตอนนี้เช็กของจริงว่ามีปัญหาไหม',
  );
  assert.match(String(realCheck?.userMessage || ''), /ยังไม่มี failure/);
  assert.doesNotMatch(String(realCheck?.userMessage || ''), /scoped open/i);

  const pending = softwareState({ pendingChange: 'เพิ่ม animation แต่ไม่เอาหน้า contact', lastDiscourse: 'MODIFY_PROJECT' });
  const cancel = interpretDiscourse('เมื่อกี้ cancel ก่อน', pending);
  assert.equal(cancel.act, 'CANCEL');
  const next = applyTurnToConversation(pending, {
    ownerText: 'เมื่อกี้ cancel ก่อน',
    discourse: cancel,
    resolution: bindDiscourseToIntent(cancel, pending, 'เมื่อกี้ cancel ก่อน')!,
  });
  assert.equal(next.pendingChange, undefined);
});

test('change of mind retracts a matching constraint without a phrase dictionary', () => {
  const state = softwareState({
    constraints: ['เพิ่ม animation แต่ไม่เอาหน้า contact', 'อย่าแตะ navbar'],
    pendingChange: 'เพิ่ม animation แต่ไม่เอาหน้า contact',
  });
  const discourse = interpretDiscourse('เปลี่ยนใจ เอา animation contact ด้วย', state);
  assert.equal(discourse.act, 'CORRECT');
  const next = applyTurnToConversation(state, {
    ownerText: 'เปลี่ยนใจ เอา animation contact ด้วย',
    discourse,
    resolution: bindDiscourseToIntent(discourse, state, 'เปลี่ยนใจ เอา animation contact ด้วย')!,
  });
  assert.equal(next.constraints.some(item => /contact/i.test(item)), false);
  assert.equal(next.constraints.some(item => /navbar/i.test(item)), true);
});

test('fail-stop annotates a stored chain instead of replacing it', () => {
  const stored = applyTurnToConversation(softwareState(), {
    ownerText: 'เสร็จแล้ว test build แล้วเปิดให้ดูด้วย',
    discourse: interpretDiscourse('เสร็จแล้ว test build แล้วเปิดให้ดูด้วย', softwareState()),
    resolution: bindDiscourseToIntent(
      interpretDiscourse('เสร็จแล้ว test build แล้วเปิดให้ดูด้วย', softwareState()),
      softwareState(),
      'เสร็จแล้ว test build แล้วเปิดให้ดูด้วย',
    )!,
  });
  const halt = interpretDiscourse('ถ้าพังก็หยุดแล้วบอก', stored);
  assert.equal(halt.change, 'STOP_ON_FAIL');
  const next = applyTurnToConversation(stored, {
    ownerText: 'ถ้าพังก็หยุดแล้วบอก',
    discourse: halt,
    resolution: bindDiscourseToIntent(halt, stored, 'ถ้าพังก็หยุดแล้วบอก')!,
  });
  assert.equal(next.pendingConditional?.stopOnFail, true);
  assert.deepEqual(next.pendingConditional?.thenActs, ['TEST', 'BUILD', 'PREVIEW']);
});

test('opening App.jsx by basename reads src/App.jsx in the active project', () => {
  const state = softwareState({
    activeProjectSlug: 'todo-app',
    projects: [{ slug: 'todo-app', label: 'Todo App', kind: 'website' }],
  });
  const bound = bindDiscourseToIntent(interpretDiscourse('เปิดดู App.jsx หน่อย', state), state, 'เปิดดู App.jsx หน่อย');
  assert.equal(bound?.capabilityId, PROJECT_READ_FILE);
  assert.equal(bound?.arguments?.relativePath, 'src/App.jsx');
});

test('ok-do-it executes a pending change even when a queue is waiting', () => {
  const state = softwareState({
    pendingChange: 'เพิ่ม filter completed',
    queue: [{ id: 'q1', text: 'build', status: 'pending', act: 'BUILD' }],
  });
  for (const phrase of ['โอเคทำ', 'ทำ']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'EXECUTE_NOW', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.capabilityId, SOFTWARE_APPLY_BUILD, phrase);
  }
});

test('named resume restores the named project even if a later plan snapshot is leftover', () => {
  const onTodo = softwareState({
    activeProjectSlug: 'todo-app',
    activeGoalId: 'BUILD_SOFTWARE',
    activePlanId: 'plan_todo',
    pendingPermission: { proposalId: 'ap-todo', goalId: 'BUILD_SOFTWARE', planId: 'plan_todo' },
    queue: [{ id: 'q1', text: 'loading animation', status: 'pending', act: 'MODIFY_PROJECT' }],
    topicStack: [
      { topic: 'software', projectSlug: 'portfolio', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio', label: 'Portfolio' },
    ],
    projects: [
      { slug: 'todo-app', label: 'Todo App', kind: 'software', goalId: 'BUILD_SOFTWARE', planId: 'plan_todo' },
      { slug: 'jarvis-portfolio-modern', label: 'Portfolio', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_old_portfolio' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' },
    ],
  });
  for (const phrase of ['กลับไปทำเว็บ portfolio ต่อ', 'มาทำ portfolio ของเราต่อกัน']) {
    const discourse = interpretDiscourse(phrase, onTodo);
    assert.equal(discourse.act, 'RESTORE_TOPIC', phrase);
    const bound = bindDiscourseToIntent(discourse, onTodo, phrase);
    assert.equal(bound?.reasonCode, 'RESTORE_TOPIC', phrase);
    assert.match(String(bound?.userMessage || ''), /Portfolio/i, phrase);
    const next = applyTurnToConversation(onTodo, {
      ownerText: phrase,
      discourse,
      resolution: bound!,
      project: { slug: 'todo-app', label: 'Todo App', kind: 'software', goalId: 'BUILD_SOFTWARE', planId: 'plan_todo' },
    });
    assert.equal(next.activeProjectSlug, 'portfolio', phrase);
    assert.notEqual(next.activeProjectSlug, 'jarvis-portfolio-modern', phrase);
    assert.equal(next.activePlanId, 'plan_portfolio', phrase);
    const edit = bindDiscourseToIntent(interpretDiscourse('หน้า home ยังโล่งไปนิด', next), next, 'หน้า home ยังโล่งไปนิด');
    assert.notEqual(edit?.reasonCode, 'WAITING_PERMISSION', phrase);
    assert.notEqual(edit?.reasonCode, 'WAITING_PERMISSION_NOTED', phrase);
  }
  const alreadyOnSite = interpretDiscourse('มาทำ portfolio ของเราต่อกัน', softwareState());
  assert.equal(alreadyOnSite.act, 'RESTORE_TOPIC');
  assert.notEqual(alreadyOnSite.act, 'NEW_PROJECT');
});

test('what-to-add stays a plan request even when a leftover queue is waiting', () => {
  const state = softwareState({
    queue: [{ id: 'q1', text: 'loading animation', status: 'pending', act: 'MODIFY_PROJECT' }],
  });
  const discourse = interpretDiscourse('เพิ่มอะไรดี', state);
  assert.equal(discourse.act, 'PLAN_REQUEST');
  const bound = bindDiscourseToIntent(discourse, state, 'เพิ่มอะไรดี');
  assert.equal(bound?.reasonCode, 'SUGGEST_ADDITIONS');
  assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('short-answer preference compresses successful speak but keeps failure causes', () => {
  assert.equal(
    compactOwnerSpeak('ผ่านครับ Test 12/12 รายละเอียดอยู่ใน log ที่ยาวมาก', ['ตอบสั้นกว่านี้ได้ไหม']),
    'ผ่านครับ',
  );
  const failure = compactOwnerSpeak('test ยังไม่ผ่าน เพราะ smoke failed on App.jsx', ['ตอบสั้น']);
  assert.match(failure, /smoke failed/);
  const options = compactOwnerSpeak('1. Hero stats\n2. Featured project section\n3. Testimonials', ['ตอบสั้นกว่านี้ได้ไหม']);
  assert.match(options, /Featured project section/);
});

test('research choose-one uses the comparison set, not leftover plan options', () => {
  const state = softwareState({
    lastDiscourse: 'RESEARCH',
    activeTopic: 'research',
    lastResearchQuery: 'Framer Motion vs GSAP for this portfolio',
    lastOwnerIntent: 'เดี๋ยวก่อน Framer Motion กับ GSAP ถ้าเป็นเว็บนี้อันไหนเหมาะกว่า',
    offeredOptions: [
      { index: 1, label: 'Hero stats' },
      { index: 2, label: 'Featured project section' },
      { index: 3, label: 'Skills grid' },
    ],
    pendingChange: 'เอาแบบเบาๆ และไม่รก',
  });
  const pick = bindDiscourseToIntent(interpretDiscourse('เลือกมาอันเดียว', state), state, 'เลือกมาอันเดียว');
  assert.equal(pick?.reasonCode, 'RESEARCH_RECOMMEND');
  assert.match(String(pick?.userMessage || ''), /Framer|Motion/i);
  assert.doesNotMatch(String(pick?.userMessage || ''), /Hero stats|Skills grid/i);
});

test('accepting a research pick without editing is hold, not another research call', () => {
  const state = softwareState({
    lastDiscourse: 'RESEARCH',
    activeTopic: 'research',
    lastResearchQuery: 'Framer Motion vs GSAP',
    selectedOption: { index: 1, label: 'Framer Motion' },
  });
  for (const phrase of ['โอเค เอาตามนั้น แต่ยังไม่ต้องแก้เว็บ', 'เอาตามที่แนะนำ ยังไม่ต้องแตะโค้ด']) {
    const discourse = interpretDiscourse(phrase, state);
    assert.equal(discourse.act, 'ACKNOWLEDGE', phrase);
    assert.equal(discourse.change, 'HOLD_MUTATION', phrase);
    const bound = bindDiscourseToIntent(discourse, state, phrase);
    assert.equal(bound?.reasonCode, 'HOLD_MUTATION', phrase);
    assert.equal(bound?.capabilityId, undefined, phrase);
    assert.match(String(bound?.userMessage || ''), /ยังไม่แก้เว็บ/i, phrase);
  }
});

test('site color recall is memory, not a desktop open', async () => {
  const state = softwareState({
    remembered: ['สีหลักเอาประมาณดำ ฟ้า ม่วง'],
    lastResearchQuery: 'Framer Motion vs GSAP',
  });
  const phrase = 'สีเว็บที่เราคุยกันคืออะไร';
  const discourse = interpretDiscourse(phrase, state);
  assert.equal(discourse.act, 'MEMORY_QUERY');
  const bound = bindDiscourseToIntent(discourse, state, phrase);
  assert.equal(bound?.reasonCode, 'CONVERSATION_MEMORY');
  assert.match(String(bound?.userMessage || ''), /ดำ|ฟ้า|ม่วง/i);
  assert.notEqual(bound?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  const rewritten = rewriteWrongRoute({
    kind: 'CAPABILITY',
    capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE,
    arguments: {},
    confidence: 'HIGH',
    reasonCode: 'SEMANTIC_SCOPED_WEB',
    consumed: true,
    source: 'semantic',
    actionClass: 'ACTIONABLE',
  }, state, phrase);
  assert.notEqual(rewritten.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  const recap = bindDiscourseToIntent(interpretDiscourse('เมื่อกี้เราคุยอะไรกัน', state), state, 'เมื่อกี้เราคุยอะไรกัน');
  assert.match(String(recap?.userMessage || ''), /Framer|GSAP/i);
  assert.doesNotMatch(String(recap?.userMessage || ''), /scoped open/i);
});

test('inventory and current-project status stay on conversation projects', () => {
  const state = softwareState({
    projects: [
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_portfolio' },
      { slug: 'todo-app', label: 'Todo App', kind: 'software', planId: 'plan_todo' },
    ],
  });
  const list = bindDiscourseToIntent(
    interpretDiscourse('ตอนนี้มี project อะไรบ้าง', state),
    state,
    'ตอนนี้มี project อะไรบ้าง',
  );
  assert.match(String(list?.userMessage || ''), /1\. Portfolio/);
  assert.match(String(list?.userMessage || ''), /Todo App/);
  const current = bindDiscourseToIntent(
    interpretDiscourse('แต่ project ที่เรากำลังทำอยู่คืออันไหน', state),
    state,
    'แต่ project ที่เรากำลังทำอยู่คืออันไหน',
  );
  assert.match(String(current?.userMessage || ''), /Portfolio \(portfolio\)/);
  assert.doesNotMatch(String(current?.userMessage || ''), /jarvis-project/i);
});

test('first-project restore stays on the original site, not the leftover previous app', () => {
  const onSite = softwareState({
    topicStack: [
      { topic: 'software', projectSlug: 'todo-app', goalId: 'BUILD_SOFTWARE', planId: 'plan_todo', label: 'Todo App' },
    ],
    projects: [
      { slug: 'todo-app', label: 'Todo App', kind: 'software', planId: 'plan_todo' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', planId: 'plan_portfolio' },
    ],
  });
  const stay = bindDiscourseToIntent(interpretDiscourse('กลับไปอันแรก', onSite), onSite, 'กลับไปอันแรก');
  assert.match(String(stay?.userMessage || ''), /Portfolio/i);
  assert.doesNotMatch(String(stay?.userMessage || ''), /Todo/i);
});

test('this-site edits bind the website even if a software app is active', () => {
  const onTodo = softwareState({
    activeProjectSlug: 'todo-app',
    activeGoalId: 'BUILD_SOFTWARE',
    activePlanId: 'plan_todo',
    referents: { this_project: 'todo-app', this_app: 'todo-app', this_site: 'portfolio' },
    projects: [
      { slug: 'todo-app', label: 'Todo App', kind: 'software', goalId: 'BUILD_SOFTWARE', planId: 'plan_todo' },
      { slug: 'portfolio', label: 'Portfolio', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' },
    ],
  });
  const phrase = 'เพิ่มหน้า skills ให้เว็บนี้';
  const discourse = interpretDiscourse(phrase, onTodo);
  assert.equal(discourse.act, 'MODIFY_PROJECT');
  const bound = bindDiscourseToIntent(discourse, onTodo, phrase);
  assert.equal(bound?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.equal(bound?.arguments?.planId, 'plan_portfolio');
  const next = applyTurnToConversation(onTodo, {
    ownerText: phrase,
    discourse,
    resolution: bound!,
    project: { slug: 'todo-app', label: 'Todo App', kind: 'software', goalId: 'BUILD_SOFTWARE', planId: 'plan_todo' },
  });
  assert.equal(next.activeProjectSlug, 'portfolio');
  assert.equal(next.activePlanId, 'plan_portfolio');
});

test('queue progress, pause, and no-problem hold stay conversational', () => {
  const queued = softwareState({
    lastDiscourse: 'QUEUE',
    queue: [
      { id: 'q1', text: 'เพิ่มหน้า Contact', status: 'running', act: 'MODIFY_PROJECT' },
      { id: 'q2', text: 'รัน test', status: 'pending', act: 'TEST' },
    ],
  });
  const progress = bindDiscourseToIntent(interpretDiscourse('ตอนนี้ถึงข้อไหน', queued), queued, 'ตอนนี้ถึงข้อไหน');
  assert.equal(progress?.reasonCode, 'QUEUE_REVIEW');
  assert.match(String(progress?.userMessage || ''), /Contact|test/i);
  assert.doesNotMatch(String(progress?.userMessage || ''), /jarvis-lab|Edge-TTS/i);

  const paused = interpretDiscourse('pause', queued);
  assert.equal(paused.act, 'PAUSE');
  const held = bindDiscourseToIntent(interpretDiscourse('ถ้าไม่มีปัญหาก็ไม่ต้องแก้อะไร', softwareState()), softwareState(), 'ถ้าไม่มีปัญหาก็ไม่ต้องแก้อะไร');
  assert.equal(held?.reasonCode, 'HOLD_MUTATION');
  assert.notEqual(held?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('ok-follow-that after a permission status is ack, not leftover execute', () => {
  const state = softwareState({
    lastDiscourse: 'STATUS_QUERY',
    pendingChange: 'เพิ่มหน้า skills',
  });
  const discourse = interpretDiscourse('โอเคตามนั้น', state);
  assert.equal(discourse.act, 'ACKNOWLEDGE');
  const bound = bindDiscourseToIntent(discourse, state, 'โอเคตามนั้น');
  assert.notEqual(bound?.capabilityId, SOFTWARE_APPLY_BUILD);
});

test('daily fail, hold-in-plan, and build verification stay honest', () => {
  const state = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: 'Tests passed for portfolio', at: 9, slug: 'portfolio' },
    lastResearchQuery: 'Framer Motion vs GSAP',
    pendingPlanReview: { planId: 'plan_new', goalId: 'BUILD_WEBSITE', title: 'Leftover' },
  });
  const daily = interpretDiscourse('วันนี้มีอะไร fail จริงบ้าง', state);
  assert.equal(daily.act, 'STATUS_QUERY');
  assert.equal(daily.statusFocus, 'summary');
  const hold = interpretDiscourse('ใส่ไว้ในแผนก่อน ยังไม่ต้องแตะโค้ด', state);
  assert.equal(hold.act, 'ACKNOWLEDGE');
  assert.equal(hold.change, 'HOLD_MUTATION');
  const buildAsk = bindDiscourseToIntent(interpretDiscourse('ล่าสุด build ผ่านไหม', state), state, 'ล่าสุด build ผ่านไหม');
  assert.match(String(buildAsk?.userMessage || ''), /ยังไม่มีผล build/);
  assert.doesNotMatch(String(buildAsk?.userMessage || ''), /Tests passed/i);
  const previewAsk = interpretDiscourse('ตอนนี้ preview ใช้งานได้ไหม', softwareState({
    activePreview: { slug: 'portfolio', url: 'http://127.0.0.1:4174', port: 4174 },
  }));
  assert.equal(previewAsk.act, 'STATUS_QUERY');
  assert.equal(previewAsk.statusFocus, 'preview');
});

test('if-build-passed-then-preview does not rerun build when the last build already passed', () => {
  const state = softwareState({
    recentVerification: { kind: 'build', ok: true, summary: 'Ran build', at: 9, slug: 'portfolio' },
  });
  const phrase = 'ถ้า build ผ่านเปิด preview ต่อเลย';
  const discourse = interpretDiscourse(phrase, state);
  assert.equal(discourse.act, 'CONDITIONAL');
  assert.equal(discourse.ifKind, 'build');
  const bound = bindDiscourseToIntent(discourse, state, phrase);
  assert.equal(bound?.capabilityId, PROJECT_START_DEV_SERVER);
  assert.notEqual(bound?.capabilityId, PROJECT_BUILD);
  assert.equal((bound?.extraCalls || []).length, 0);
});

test('leftover plans do not steal research recall, in-sentence ordinals, or healthy continue', () => {
  const leftover = softwareState({
    pendingPlanReview: { planId: 'plan_leftover', goalId: 'BUILD_WEBSITE', title: 'Leftover hero options' },
    lastResearchQuery: 'Framer Motion vs GSAP for this portfolio',
    selectedOption: { index: 1, label: 'Framer Motion' },
    lastDiscourse: 'PREVIEW',
    activeTopic: 'software',
    offeredOptions: [
      { index: 1, label: 'Hero stats' },
      { index: 2, label: 'Featured project section' },
    ],
    recentVerification: { kind: 'test', ok: true, summary: 'Tests passed for portfolio', at: 9, slug: 'portfolio' },
  });

  const ordinalText = 'อันที่เมื่อกี้แนะนำข้อสองน่าสนใจ เอาตัวนั้น';
  const ordinal = interpretDiscourse(ordinalText, leftover);
  assert.equal(ordinal.act, 'SELECT_ORDINAL');
  assert.equal(ordinal.ordinal, 2);
  const picked = bindDiscourseToIntent(ordinal, leftover, ordinalText);
  assert.match(String(picked?.userMessage || ''), /GSAP/i);
  assert.doesNotMatch(String(picked?.userMessage || ''), /Hero stats|Featured project/i);

  const recallText = 'ย้อนกลับไปเรื่อง animation เมื่อกี้';
  const recall = interpretDiscourse(recallText, leftover);
  assert.equal(recall.act, 'RESEARCH');
  assert.equal(recall.change, 'RECALL');
  const recalled = bindDiscourseToIntent(recall, leftover, recallText);
  assert.equal(recalled?.reasonCode, 'RESEARCH_RECALL');
  assert.match(String(recalled?.userMessage || ''), /Framer|GSAP|animation/i);
  assert.notEqual(recalled?.capabilityId, SOFTWARE_APPLY_BUILD);

  const nameText = 'ตัวที่นายแนะนำชื่ออะไรนะ';
  const named = bindDiscourseToIntent(interpretDiscourse(nameText, leftover), leftover, nameText);
  assert.equal(named?.reasonCode, 'RESEARCH_RECALL');
  assert.match(String(named?.userMessage || ''), /Framer Motion/i);
  assert.notEqual(named?.capabilityId, SOFTWARE_APPLY_BUILD);

  const whereText = 'ใช้ตัวนั้นกับเว็บเราได้ตรงไหนบ้าง';
  const where = bindDiscourseToIntent(interpretDiscourse(whereText, leftover), leftover, whereText);
  assert.equal(where?.reasonCode, 'RESEARCH_APPLY_HINT');
  assert.notEqual(where?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  assert.notEqual(where?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.match(String(where?.userMessage || ''), /Framer|Portfolio/i);

  const rewritten = rewriteWrongRoute({
    kind: 'CAPABILITY',
    capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE,
    arguments: {},
    confidence: 'HIGH',
    reasonCode: 'SEMANTIC_SCOPED_WEB',
    consumed: true,
    source: 'semantic',
    actionClass: 'ACTIONABLE',
  }, leftover, whereText);
  assert.notEqual(rewritten.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);

  const pickText = 'เลือกจุดที่คุ้มสุดมาหนึ่งจุด';
  const pick = interpretDiscourse(pickText, leftover);
  assert.equal(pick.act, 'RESEARCH');
  assert.equal(pick.recommend, true);

  const diffText = 'ตอนนี้แผนเปลี่ยนจากเดิมยังไง';
  const diff = interpretDiscourse(diffText, leftover);
  assert.equal(diff.act, 'PLAN_REQUEST');
  const diffBound = bindDiscourseToIntent(diff, leftover, diffText);
  assert.equal(diffBound?.reasonCode, 'PLAN_DIFF');
  assert.notEqual(diffBound?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.match(String(diffBound?.userMessage || ''), /Portfolio|แผนหลัก/i);

  const healthyText = 'ถ้าไม่พังก็ไปขั้นต่อไปเอง';
  const healthy = interpretDiscourse(healthyText, leftover);
  assert.equal(healthy.act, 'CONDITIONAL');
  assert.equal(healthy.change, 'CONTINUE_IF_HEALTHY');
  const healthyBound = bindDiscourseToIntent(healthy, leftover, healthyText);
  assert.equal(healthyBound?.reasonCode, 'CONDITIONAL_READY');
  assert.notEqual(healthyBound?.capabilityId, SOFTWARE_APPLY_BUILD);

  const stolen = applyTurnToConversation(leftover, {
    ownerText: recallText,
    discourse: recall,
    resolution: recalled!,
    pendingPlanReview: { planId: 'plan_leftover', goalId: 'BUILD_WEBSITE', title: 'Leftover hero options' },
    project: { slug: 'portfolio', label: 'Portfolio', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_leftover' },
  });
  assert.equal(stolen.activePlanId, 'plan_portfolio');
  assert.equal(stolen.projects.find(item => item.slug === 'portfolio')?.planId, 'plan_portfolio');
  assert.notEqual(stolen.pendingPlanReview?.planId, 'plan_leftover');

  const resumeText = 'มาทำ portfolio ของเราต่อกัน';
  const restored = applyTurnToConversation(leftover, {
    ownerText: resumeText,
    discourse: interpretDiscourse(resumeText, leftover),
    resolution: bindDiscourseToIntent(interpretDiscourse(resumeText, leftover), leftover, resumeText)!,
  });
  assert.equal(restored.activeProjectSlug, 'portfolio');
  assert.equal(restored.activePlanId, 'plan_portfolio');
  assert.equal(restored.pendingPlanReview, undefined);

  const compile = interpretDiscourse('ถ้าโอเค compile/build ต่อ', leftover);
  assert.equal(compile.act, 'CONDITIONAL');
  assert.equal(compile.thenAct, 'BUILD');
  const afterPassedTest = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: 'Tests passed for portfolio', at: 9, slug: 'portfolio' },
  });
  const compileNow = bindDiscourseToIntent(compile, afterPassedTest, 'ถ้าโอเค compile/build ต่อ');
  assert.notEqual(compileNow?.reasonCode, 'CONDITIONAL_STORED');
  assert.equal(compileNow?.capabilityId, PROJECT_BUILD);

  const armed = softwareState({
    recentVerification: { kind: 'test', ok: true, summary: 'Tests passed for portfolio', at: 9, slug: 'portfolio' },
    pendingConditional: { ifKind: 'build', thenAct: 'PREVIEW', thenActs: ['BUILD', 'PREVIEW'], stopOnFail: true },
  });
  const go = bindDiscourseToIntent(
    interpretDiscourse('ถ้าไม่พังก็ไปขั้นต่อไปเอง', armed),
    armed,
    'ถ้าไม่พังก็ไปขั้นต่อไปเอง',
  );
  assert.notEqual(go?.reasonCode, 'CONDITIONAL_STORED');
  assert.ok(go?.capabilityId === PROJECT_BUILD || go?.capabilityId === PROJECT_START_DEV_SERVER);

  const longState = softwareState({
    selectedOption: { index: 1, label: 'Framer Motion' },
    pendingChange: 'z'.repeat(180),
    constraints: ['อย่าแตะ navbar', 'x'.repeat(180)],
  });
  const home = 'ปรับหน้า home ให้ดูแพงขึ้น แต่ห้ามแตะ navbar และอย่าเปลี่ยนสีหลัก';
  const applyHome = bindDiscourseToIntent(interpretDiscourse(home, longState), longState, home);
  assert.equal(applyHome?.capabilityId, SOFTWARE_APPLY_BUILD);
  assert.ok(String(applyHome?.arguments?.brief || '').length <= 400);
});
