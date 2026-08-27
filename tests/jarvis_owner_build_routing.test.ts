import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindDiscourseToIntent,
  discoursePreemptsPendingGoal,
  emptyConversationState,
  interpretDiscourse,
} from '../src/jarvis/conversation';
import type { ConversationState } from '../src/jarvis/conversation';
import { SOFTWARE_PLAN_BUILD } from '../src/jarvis/build/constants';
import { createBuildPlan } from '../src/jarvis/build/planner';
import { PROJECT_START_DEV_SERVER } from '../src/jarvis/project/constants';
import { writeWebsite } from '../src/jarvis/project/siteRender';
import { ProjectWorkspace } from '../src/jarvis/project/workspace';
import { isBuildWebsiteIntent, isSoftwareWorkRequest } from '../src/jarvis/goals/resolver';
import { selfKnowledgeQuestionKind } from '../src/jarvis/intelligence/answer';
import { shouldUseOpenCodeHarness } from '../src/jarvis/coding/openCodeHarness';

const OWNER_PASTE = [
  'ตอนนี้คุณคือ JARVIS ตัวไหน และคุณทำอะไรให้ผมได้บ้าง',
  'ถ้าผมให้คุณสร้างโปรเจกต์จริง คุณสามารถวางแผน ขอ permission แล้วลงมือทำได้ไหม',
  'สร้างเว็บ todo แบบ modern ให้ผม',
  'เริ่มจากวางแผนก่อน แล้วค่อยขอ permission ก่อนลงมือทำจริง',
  'สร้างเว็บพรีเซนต์แบบ slide deck 7 สไลด์',
  'สำหรับนำเสนอความสามารถของ JARVIS ในตอนนี้',
  '',
  'นี่คือ BUILD_WEBSITE goal',
  'ให้สร้าง project จริงใน ProjectWorkspace ไม่ใช่แค่ตอบข้อความ',
  '',
  'ใช้ React + Vite',
  'มี motion และ 3D interactive feeling',
  'ดีไซน์ futuristic / clean / cinematic',
  'ภาษาไทย อ่านง่าย',
  '',
  'เริ่มจาก BuildPlan',
  'จากนั้นขอ Permission',
  'สร้างไฟล์ ติดตั้ง dependency ทดสอบ build',
  'และเปิด localhost preview ให้ผมดู',
].join('\n');

function leftoverPortfolio(): ConversationState {
  const base = emptyConversationState('jarvis-lab', 1);
  return {
    ...base,
    activeTopic: 'software',
    activeGoalId: 'BUILD_WEBSITE',
    activePlanId: 'plan_portfolio',
    activeProjectSlug: 'portfolio',
    activeWorkspace: 'data/jarvis/builds/portfolio',
    projects: [{ slug: 'portfolio', label: 'Portfolio', kind: 'website', goalId: 'BUILD_WEBSITE', planId: 'plan_portfolio' }],
    pendingPlanReview: { planId: 'plan_portfolio', goalId: 'BUILD_WEBSITE', title: 'Portfolio' },
    referents: { this_project: 'portfolio', this_site: 'portfolio', this_plan: 'plan_portfolio' },
  };
}

test('mixed Thai BUILD_WEBSITE paste is software work, not a self-knowledge shortcut', () => {
  assert.equal(selfKnowledgeQuestionKind(OWNER_PASTE), undefined);
  assert.equal(isBuildWebsiteIntent(OWNER_PASTE), true);
  assert.equal(isSoftwareWorkRequest(OWNER_PASTE), true);
  assert.equal(shouldUseOpenCodeHarness(OWNER_PASTE), true);
  assert.equal(selfKnowledgeQuestionKind('What can you do?'), 'CAPABILITY_SUMMARY');
});

test('leftover Portfolio waiting-plan yields NEW_PROJECT for the owner deck brief', () => {
  const leftover = leftoverPortfolio();
  const discourse = interpretDiscourse(OWNER_PASTE, leftover);
  assert.equal(discourse.act, 'NEW_PROJECT');
  assert.equal(discoursePreemptsPendingGoal(discourse), true);
  const bound = bindDiscourseToIntent(discourse, leftover, OWNER_PASTE);
  assert.equal(bound?.capabilityId, SOFTWARE_PLAN_BUILD);
  assert.match(String(bound?.arguments?.brief || ''), /React \+ Vite/);
  assert.match(String(bound?.arguments?.brief || ''), /7 สไลด์|slide deck/i);
  assert.match(String(bound?.arguments?.brief || ''), /BUILD_WEBSITE/);
  assert.equal(interpretDiscourse('เปิด preview', leftover).act, 'PREVIEW');
  const preview = bindDiscourseToIntent(interpretDiscourse('เปิด preview', leftover), leftover, 'เปิด preview');
  assert.equal(preview?.capabilityId, PROJECT_START_DEV_SERVER);
});

test('createBuildPlan keeps the 7-slide deck brief and slug', () => {
  const plan = createBuildPlan({ brief: OWNER_PASTE });
  assert.equal(plan.slug, 'jarvis-capability-deck');
  assert.match(plan.title, /Capability Deck/i);
  assert.ok(plan.brief.length > 400);
  assert.match(plan.brief, /React \+ Vite/);
  assert.ok(plan.requirements.some(item => /7|Seven/i.test(item)));
});

test('writeWebsite prefers the cinematic 7-slide deck over todo when both appear', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-deck-'));
  try {
    const workspace = new ProjectWorkspace(dir);
    const plan = createBuildPlan({ brief: OWNER_PASTE });
    writeWebsite(plan, workspace);
    const app = fs.readFileSync(path.join(workspace.rootOf(plan.slug), 'src/App.jsx'), 'utf8');
    assert.match(app, /className="slide"/);
    assert.match(app, /const SLIDES = \[/);
    assert.equal((app.match(/"kicker":/g) || []).length, 7);
    assert.match(app, /วางแผน|permission|ProjectWorkspace/);
    assert.doesNotMatch(app, /STARTER = \[/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
