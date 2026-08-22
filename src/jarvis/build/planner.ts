import { randomUUID } from 'node:crypto';
import type { BuildPlan, BuildProjectType, BuildStage } from './types';

export function inferProjectType(brief: string): BuildProjectType {
  if (/สร้างเว็บ|ทำเว็บ|เว็บไซต์|website|portfolio|landing|ร้าน(?:ค้า)?/iu.test(brief)) {
    return 'WEBSITE';
  }
  return 'SOFTWARE';
}

export function slugFromBrief(brief: string): string {
  const ascii = brief
    .normalize('NFKD')
    .replace(/[^\w\s-]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  if (ascii.length >= 3) return ascii;
  if (/portfolio/iu.test(brief)) return 'portfolio';
  if (/รองเท้า|shoe/iu.test(brief)) return 'shoe-store';
  if (/todo/iu.test(brief)) return 'todo-app';
  if (/dashboard/iu.test(brief)) return 'dashboard';
  return inferProjectType(brief) === 'WEBSITE' ? 'website' : 'software';
}

export function isPlanApprovalUtterance(text: string): boolean {
  return /เอาตามแผนนี้|ตามแผนนี้|อนุมัติแผน|เริ่มตามแผน|approve (?:the )?plan|use this plan|go with this plan|looks good,? (?:go|ship)/iu.test(text.trim());
}

export function spokenPlanSummary(plan: BuildPlan): string {
  const parts = plan.projectType === 'WEBSITE' ? 'แนะนำตัว ผลงาน ติดต่อ และ responsive' : 'โครงสร้างโปรเจกต์ หน้าหลัก และการทดสอบเบื้องต้น';
  return `ได้ครับ ผมวางแผนเป็น${plan.projectType === 'WEBSITE' ? 'เว็บ' : 'ซอฟต์แวร์'} ${plan.title} ใช้ ${plan.suggestedStack} ก่อน มี${parts} ผมยังไม่สร้างไฟล์จนกว่าคุณจะอนุมัติแผน`;
}

export function createBuildPlan(input: {
  brief: string;
  goalId?: string;
  sessionId?: string;
}): BuildPlan {
  const brief = input.brief.trim().slice(0, 400);
  const projectType = inferProjectType(brief);
  const slug = slugFromBrief(brief);
  const title = titleFrom(brief, projectType);
  const now = Date.now();
  const stages = defaultStages(projectType);
  return {
    id: `plan_${randomUUID()}`,
    goalId: input.goalId || (projectType === 'WEBSITE' ? 'BUILD_WEBSITE' : 'BUILD_SOFTWARE'),
    sessionId: input.sessionId,
    title,
    summary: `${title} planned for the Jarvis sandbox. Plan is not execution permission.`,
    brief,
    slug,
    requirements: requirementsFor(brief, projectType),
    assumptions: [
      'React/Vite starter unless the owner names another stack.',
      'Files stay inside data/jarvis/builds/<slug>/ until a later export task.',
      'Install, build, test, and localhost preview use typed project capabilities. No unrestricted shell.',
    ],
    projectType,
    suggestedStack: projectType === 'WEBSITE' ? 'React/Vite' : 'React/Vite app',
    stages,
    permissionsNeeded: ['WRITE_PROJECT', 'INSTALL_PROJECT_DEPENDENCIES', 'RUN_PROJECT_COMMANDS', 'START_DEV_SERVER'],
    artifactsExpected: [`${slug}/`, `${slug}/package.json`, `${slug}/src/App.jsx`, `${slug}/tests/smoke.test.mjs`],
    acceptanceCriteria: [
      'Owner can review the plan before any files exist.',
      'After approval and a bounded lease, sandbox files exist under data/jarvis/builds/.',
      'CLICK / TYPE / SUBMIT remain unavailable.',
    ],
    risks: [
      'Scope stays inside the Jarvis sandbox.',
      'PLAN != EXECUTION PERMISSION.',
    ],
    status: 'READY_FOR_REVIEW',
    createdAt: now,
    updatedAt: now,
  };
}

function titleFrom(brief: string, projectType: BuildProjectType): string {
  if (/portfolio/iu.test(brief)) return 'Portfolio';
  if (/รองเท้า|shoe/iu.test(brief)) return 'Shoe Store';
  if (/todo/iu.test(brief)) return 'Todo App';
  if (/dashboard/iu.test(brief)) return 'Server Dashboard';
  const clipped = brief.replace(/jarvis|สร้าง|ทำ|ให้ผม|ให้หน่อย|build|create|a |an /giu, ' ').replace(/\s+/gu, ' ').trim();
  return (clipped.slice(0, 48) || (projectType === 'WEBSITE' ? 'Website' : 'Software')).replace(/^./u, ch => ch.toUpperCase());
}

function requirementsFor(brief: string, projectType: BuildProjectType): string[] {
  if (projectType === 'WEBSITE') {
    return [
      `Owner brief: ${brief.slice(0, 160)}`,
      'Intro, work, and contact sections.',
      'Responsive layout.',
    ];
  }
  return [
    `Owner brief: ${brief.slice(0, 160)}`,
    'Runnable local project skeleton.',
    'A smoke test file for later verification.',
  ];
}

function defaultStages(projectType: BuildProjectType): BuildStage[] {
  const uiTitle = projectType === 'WEBSITE' ? 'UI pages' : 'App UI';
  return [
    stage('requirements', 'Requirements', 'Capture the owner brief and defaults.', [], ['brief.md']),
    stage('architecture', 'Architecture', 'Choose a bounded stack and folder layout.', ['requirements'], ['README.md']),
    stage('scaffold', 'Scaffold', 'Create the workspace and source files after permission.', ['architecture'], ['package.json', 'src/App.jsx']),
    stage('install', 'Install', 'Run npm install inside the project workspace.', ['scaffold'], ['node_modules']),
    stage('ui', uiTitle, 'Keep the first visible screens in the workspace.', ['install'], ['src/App.jsx']),
    stage('build', 'Build', 'Run the registered build script.', ['ui'], ['dist']),
    stage('tests', 'Tests', 'Run the registered test script or bounded Node smoke test.', ['build'], ['tests/smoke.test.mjs']),
    stage('preview', 'Preview', 'Start the registered dev script on localhost only.', ['tests'], ['preview-url']),
    stage('verify', 'Final Verify', 'Confirm exit-code evidence and localhost preview.', ['preview'], ['sandbox']),
  ];
}

function stage(
  id: string,
  title: string,
  shortDescription: string,
  dependencies: string[],
  expectedArtifacts: string[],
): BuildStage {
  return {
    id,
    title,
    shortDescription,
    status: 'pending',
    dependencies,
    expectedArtifacts,
    verification: [`Confirm ${expectedArtifacts.join(', ')} stay inside the sandbox.`],
  };
}
