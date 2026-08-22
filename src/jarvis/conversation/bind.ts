/**
 * Bind discourse + conversation state onto a normal IntentResolution.
 * Qwen/discourse output is interpretation only. Capability execution stays on the policy path.
 */

import { SOFTWARE_APPLY_BUILD, SOFTWARE_PLAN_BUILD } from '../build/constants';
import {
  PROJECT_BUILD,
  PROJECT_LIST_FILES,
  PROJECT_READ_FILE,
  PROJECT_RUN_TESTS,
  PROJECT_START_DEV_SERVER,
  PROJECT_STOP_DEV_SERVER,
} from '../project/constants';
import { DESKTOP_OPEN_SCOPED_RESOURCE, JARVIS_RUNTIME_STATUS } from '../capabilities/actions/constants';
import { RESEARCH_CURRENT } from '../research/constants';
import type { IntentResolution } from '../intent/types';
import type { ConversationState, DiscourseAct, DiscourseInterpretation } from './types';
import { uniqueSlugOrClarify, restoreProject } from './referents';
import { interpretDiscourse } from './discourse';
import { sanitizedRecent, isPermissionPrompt, extractComparisonOptions, pickRecommendedOption } from './view';

export function bindDiscourseToIntent(
  discourse: DiscourseInterpretation,
  state: ConversationState,
  text: string,
): IntentResolution | null {
  if (discourse.requiresClarification && discourse.clarification) {
    return clarify(discourse.clarification, 'CONVERSATION_CLARIFY');
  }

  switch (discourse.act) {
    case 'GREET':
    case 'ACKNOWLEDGE':
      return talk(discourse.act === 'GREET' ? 'สวัสดีครับ' : 'รับทราบครับ', discourse.act);
    case 'PAUSE':
      return talk('พักไว้ก่อนได้ครับ งานเดิมยังอยู่', 'PAUSE');
    case 'MODEL_QUERY':
      return null;
    case 'MEMORY_QUERY':
      return {
        kind: 'CONVERSATION',
        confidence: 'HIGH',
        reasonCode: 'ASK_MEMORY',
        consumed: true,
        source: 'context',
        actionClass: 'CONVERSATION',
      };
    case 'MEMORY_STORE':
      return {
        kind: 'CONVERSATION',
        confidence: 'HIGH',
        reasonCode: 'REMEMBER_PREFERENCE',
        arguments: { target: discourse.change || text },
        userMessage: 'จำไว้แล้วครับ จะไม่เก็บทั้ง transcript เป็น memory',
        consumed: true,
        source: 'context',
        actionClass: 'CONVERSATION',
      };
    case 'CORRECT':
      return talk('รับทราบครับ จะใช้ความหมายล่าสุด ไม่ได้เริ่มงานใหม่', 'CORRECTION_NOTED');
    case 'NEGATE':
      return talk('จำข้อจำกัดนั้นไว้แล้วครับ ยังไม่แก้ไฟล์จนกว่าจะให้ทำ', 'CONSTRAINT_NOTED');
    case 'STATUS_QUERY':
      return bindStatus(state, discourse);
    case 'SWITCH_TOPIC':
      return talk('ได้ครับ เรื่องอะไร?', 'SWITCH_TOPIC');
    case 'RESTORE_TOPIC':
      return restore(state, text);
    case 'START_FRESH':
      return talk(startFreshLine(state), 'START_FRESH');
    case 'GRANT_PERMISSION':
      return grantPending(state);
    case 'APPROVE_PLAN':
      return approve(state);
    case 'PLAN_REQUEST':
      return planRequest(state, text);
    case 'NEW_PROJECT':
      return capability(SOFTWARE_PLAN_BUILD, { brief: discourse.change || text }, 'CONVERSATION_NEW_PROJECT');
    case 'ACCUMULATE_REQUIREMENTS':
      return accumulate(state, discourse.change || text);
    case 'PREVIEW':
      return projectCall(state, PROJECT_START_DEV_SERVER, 'CONVERSATION_PREVIEW');
    case 'STOP_PREVIEW':
      return projectCall(state, PROJECT_STOP_DEV_SERVER, 'CONVERSATION_STOP_PREVIEW');
    case 'RESTART_PREVIEW':
      return restartPreview(state);
    case 'TEST':
      return projectCall(state, PROJECT_RUN_TESTS, 'CONVERSATION_TEST');
    case 'BUILD':
      return projectCall(state, PROJECT_BUILD, 'CONVERSATION_BUILD');
    case 'RERUN':
      return rerun(state);
    case 'INSPECT_PROJECT':
      return inspect(state, text);
    case 'MODIFY_PROJECT':
    case 'EXECUTE_NOW':
    case 'CONTINUE':
      return continueWork(state, text, discourse);
    case 'SELECT_ORDINAL':
      return selectOrdinal(state, discourse.ordinal);
    case 'CONDITIONAL':
      return bindConditional(state, discourse);
    case 'RESEARCH':
      if (discourse.recommend) return recommendResearch(state, text, discourse);
      return capability(RESEARCH_CURRENT, { query: researchQuery(state, text, discourse) }, 'CONVERSATION_RESEARCH');
    case 'QUEUE':
      return bindQueue(state, discourse, text);
    case 'AMBIGUOUS':
      return clarify(discourse.clarification || 'หมายถึงอันไหนครับ?', 'AMBIGUOUS_REFERENT');
    default:
      return null;
  }
}

export function rewriteWrongRoute(
  resolution: IntentResolution,
  state: ConversationState,
  text: string,
): IntentResolution {
  const id = resolution.capabilityId || '';
  if (id === DESKTOP_OPEN_SCOPED_RESOURCE && looksLikeProjectFollowUp(text, state)) {
    const preview = bindDiscourseToIntent({
      act: /preview|เปิดให้ดู|เปิดดู/iu.test(text) ? 'PREVIEW' : 'MODIFY_PROJECT',
      change: text,
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
    }, state, text);
    if (preview) return preview;
  }
  if (id === 'project.createWorkspace' && state.activeProjectSlug && !/สร้างโฟลเดอร์|create workspace|อีกอัน/iu.test(text)) {
    const rebuilt = projectCall(state, PROJECT_BUILD, 'CONVERSATION_REBUILD');
    if (rebuilt) return rebuilt;
  }
  if (id.startsWith('project.') && resolution.kind === 'CAPABILITY') {
    const args = { ...(resolution.arguments || {}) };
    if (typeof args.slug !== 'string' || !args.slug.trim()) {
      const resolved = uniqueSlugOrClarify(state);
      if ('message' in resolved) return clarify(resolved.message, 'NEED_PROJECT');
      args.slug = resolved.slug;
      return {
        ...resolution,
        arguments: args,
        confidence: 'HIGH',
        reasonCode: resolution.reasonCode || 'CONVERSATION_SLUG_BOUND',
        contextEvidence: { contextSource: 'working-memory', resolvedReferent: resolved.slug },
      };
    }
  }
  return resolution;
}

export function looksLikeProjectFollowUp(text: string, state: ConversationState): boolean {
  if (!state.activeProjectSlug && !state.activePlanId && !state.pendingPlanReview) return false;
  return /เปิดให้ดู|เปิดดู|preview|เพิ่มปุ่ม|dark mode|animation|navbar|hover|เว็บนี้|โปรเจกต์นี้|\b(it|this|that)\b|มัน|อันนี้|รันใหม่|build ใหม่|\badd\b|\bchange\b|\bmake\b/iu.test(text)
    && !/chrome|youtube|notepad|spotify|cursor|vscode/iu.test(text);
}

function continueWork(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): IntentResolution | null {
  if (state.pendingPermission) {
    return talk('งานนี้รออนุญาตอยู่ครับ กดอนุญาตงานนี้ได้เลย', 'WAITING_PERMISSION');
  }
  if (state.pendingPlanReview && discourse.act !== 'MODIFY_PROJECT') return approve(state);
  const fromRecentEdit = /MODIFY_PROJECT|ACCUMULATE_REQUIREMENTS|NEGATE|CORRECT|SELECT_ORDINAL/.test(state.lastDiscourse || '');
  if (discourse.act === 'MODIFY_PROJECT' || discourse.change || (state.pendingChange && fromRecentEdit && discourse.act !== 'CONTINUE')) {
    if (!state.activePlanId && !state.activeProjectSlug) {
      return capability(SOFTWARE_PLAN_BUILD, { brief: discourse.change || text }, 'CONVERSATION_MODIFY_NEEDS_PLAN');
    }
    return capability(SOFTWARE_APPLY_BUILD, {
      planId: state.activePlanId,
      goalId: state.activeGoalId,
      brief: changeBrief(state, text, discourse),
      merge: true,
    }, 'CONVERSATION_MODIFY');
  }
  if (state.pendingChange && fromRecentEdit) {
    return capability(SOFTWARE_APPLY_BUILD, {
      planId: state.activePlanId,
      goalId: state.activeGoalId,
      brief: changeBrief(state, text, discourse),
      merge: true,
    }, 'CONVERSATION_MODIFY');
  }
  if (state.queue.some(item => item.status === 'pending' || item.status === 'running')) {
    const next = state.queue.find(item => item.status === 'pending' || item.status === 'running');
    if (next) {
      const itemAct = next.act && next.act !== 'CONTINUE' && next.act !== 'QUEUE' && next.act !== 'UNKNOWN'
        ? next.act
        : interpretQueueItemAct(next.text, state);
      if (itemAct && itemAct !== 'CONTINUE' && itemAct !== 'QUEUE' && itemAct !== 'UNKNOWN') {
        return bindDiscourseToIntent({
          act: itemAct,
          change: next.text,
          confidence: 'HIGH',
          requiresClarification: false,
          source: 'discourse',
        }, state, next.text);
      }
    }
  }
  if (state.activePlanId && (state.lastJarvisAction === SOFTWARE_PLAN_BUILD || state.pendingPlanReview)) {
    return approve(state);
  }
  if (state.activeProjectSlug) {
    const last = state.recentVerification || state.recentOperation;
    if (last?.kind === 'test') return projectCall(state, PROJECT_RUN_TESTS, 'CONVERSATION_CONTINUE_TEST');
    if (last?.kind === 'build') return projectCall(state, PROJECT_BUILD, 'CONVERSATION_CONTINUE_BUILD');
    if (last?.kind === 'preview') return projectCall(state, PROJECT_START_DEV_SERVER, 'CONVERSATION_CONTINUE_PREVIEW');
    if (discourse.act === 'CONTINUE' || (discourse.act === 'EXECUTE_NOW' && !state.pendingChange)) {
      const preview = state.activePreview?.url ? ` Preview ${state.activePreview.url}` : '';
      const project = state.projects.find(item => item.slug === state.activeProjectSlug)?.label || state.activeProjectSlug;
      return talk(
        last?.kind === 'write' && last.ok !== false
          ? `งาน ${project} ทำล่าสุดแล้วครับ${preview} ถ้าจะ test/build หรือแก้ต่อ บอกได้เลย`
          : `งาน ${project} ยังอยู่ครับ${preview} บอกได้เลยว่าจะให้ทำอะไรต่อ`,
        'CONTINUE_IDLE',
      );
    }
    return capability(SOFTWARE_APPLY_BUILD, {
      planId: state.activePlanId,
      goalId: state.activeGoalId,
      brief: changeBrief(state, text, discourse),
      merge: true,
    }, 'CONVERSATION_CONTINUE_APPLY');
  }
  return talk('ตอนนี้ยังไม่มีงานค้างที่ต่อได้ทันที บอกได้เลยว่าให้ทำอะไรต่อ', 'NOTHING_TO_CONTINUE');
}

function approve(state: ConversationState): IntentResolution {
  const planId = state.pendingPlanReview?.planId || state.activePlanId;
  if (!planId) return clarify('ยังไม่มีแผนที่รออนุมัติครับ', 'NO_PLAN');
  return capability(SOFTWARE_APPLY_BUILD, {
    planId,
    goalId: state.pendingPlanReview?.goalId || state.activeGoalId,
    brief: state.pendingPlanReview?.title || 'approved plan',
  }, 'CONVERSATION_APPROVE_PLAN');
}

function accumulate(state: ConversationState, brief: string): IntentResolution {
  const planId = state.pendingPlanReview?.planId || state.activePlanId;
  if (!planId) return capability(SOFTWARE_PLAN_BUILD, { brief }, 'CONVERSATION_PLAN');
  return capability(SOFTWARE_PLAN_BUILD, { brief, planId, merge: true }, 'CONVERSATION_MERGE_PLAN');
}

function planRequest(state: ConversationState, text: string): IntentResolution {
  if (state.pendingPlanReview || state.activePlanId) {
    const title = state.pendingPlanReview?.title || 'แผนปัจจุบัน';
    if (/สั้น/iu.test(text)) {
      return talk(`สรุปสั้นๆ: ${title} ยังเป็นแผนเดิมครับ อนุมัติได้เลยหรือจะเพิ่มอะไร`, 'PLAN_SUMMARY');
    }
    return talk(`ใช้แผน ${title} ได้ครับ บอกได้เลยว่าจะให้อนุมัติ หรือจะเพิ่มอะไรในแผน`, 'PLAN_SUMMARY');
  }
  return capability(SOFTWARE_PLAN_BUILD, { brief: text }, 'CONVERSATION_PLAN_REQUEST');
}

function rerun(state: ConversationState): IntentResolution {
  const last = state.recentVerification || state.recentOperation;
  if (last?.kind === 'test') return projectCall(state, PROJECT_RUN_TESTS, 'CONVERSATION_RERUN_TEST');
  if (last?.kind === 'build') return projectCall(state, PROJECT_BUILD, 'CONVERSATION_RERUN_BUILD');
  if (last?.kind === 'preview') return projectCall(state, PROJECT_START_DEV_SERVER, 'CONVERSATION_RERUN_PREVIEW');
  if (state.activeProjectSlug) {
    return clarify('รัน test, build, หรือ preview ครับ?', 'RERUN_AMBIGUOUS');
  }
  return clarify('รันอะไรใหม่ครับ?', 'RERUN_NO_CONTEXT');
}

function inspect(state: ConversationState, text: string): IntentResolution {
  const resolved = uniqueSlugOrClarify(state);
  if ('message' in resolved) return clarify(resolved.message, 'NEED_PROJECT');
  if (/package\.json|package อะไร/iu.test(text)) {
    return capability(PROJECT_READ_FILE, { slug: resolved.slug, relativePath: 'package.json' }, 'CONVERSATION_READ_PACKAGE');
  }
  if (/function ไหน|ฟังก์ชันไหน|which function|ไฟล์ไหน.*(จัดการ|todo)/iu.test(text)) {
    const file = state.referents.this_file || 'src/App.jsx';
    return capability(PROJECT_READ_FILE, { slug: resolved.slug, relativePath: file }, 'CONVERSATION_READ_SYMBOL');
  }
  if (/\.jsx?|\.tsx?|\.css|\.json|App\.jsx/iu.test(text)) {
    const file = text.match(/([\w./-]+\.(?:jsx?|tsx?|css|json))/iu)?.[1] || 'src/App.jsx';
    return capability(PROJECT_READ_FILE, { slug: resolved.slug, relativePath: file }, 'CONVERSATION_READ_FILE');
  }
  return capability(PROJECT_LIST_FILES, { slug: resolved.slug }, 'CONVERSATION_LIST_FILES');
}

function restartPreview(state: ConversationState): IntentResolution {
  const resolved = uniqueSlugOrClarify(state);
  if ('message' in resolved) return clarify(resolved.message, 'NEED_PROJECT');
  return {
    kind: 'CAPABILITY',
    capabilityId: PROJECT_STOP_DEV_SERVER,
    arguments: { slug: resolved.slug },
    extraCalls: [{ id: PROJECT_START_DEV_SERVER, input: { slug: resolved.slug } }],
    confidence: 'HIGH',
    reasonCode: 'CONVERSATION_RESTART_PREVIEW',
    consumed: true,
    source: 'context',
    actionClass: 'ACTIONABLE',
    contextEvidence: { contextSource: 'working-memory', resolvedReferent: resolved.slug },
  };
}

function selectOrdinal(state: ConversationState, ordinal: number | undefined): IntentResolution | null {
  if (!ordinal) return clarify('อันไหนที่หมายถึงครับ?', 'ORDINAL_MISSING');
  if (state.offeredOptions.length) {
    const option = state.offeredOptions.find(item => item.index === ordinal) || state.offeredOptions[ordinal - 1];
    if (!option) return clarify('ไม่มีตัวเลือกนั้นครับ', 'ORDINAL_UNKNOWN');
    if (state.lastDiscourse === 'RESEARCH' || state.activeTopic === 'research') {
      return talk(`เอา${option.label} ครับ`, 'ORDINAL_NOTED');
    }
    if (state.activeProjectSlug || state.activePlanId) {
      return capability(SOFTWARE_APPLY_BUILD, {
        planId: state.activePlanId,
        goalId: state.activeGoalId,
        brief: [option.payload || option.label, ...state.constraints].filter(Boolean).join('\n'),
        merge: true,
      }, 'CONVERSATION_ORDINAL_APPLY');
    }
    return talk(`เอา${option.label} ครับ`, 'ORDINAL_NOTED');
  }
  if (state.lastDiscourse === 'RESEARCH' || state.pendingChange) {
    return talk('เอาอันนั้นครับ', 'ORDINAL_NOTED');
  }
  if (state.projects.length >= ordinal) {
    const project = state.projects[ordinal - 1]!;
    return talk(`กลับไปที่ ${project.label} ครับ`, 'ORDINAL_PROJECT');
  }
  return clarify('อันแรกของอะไรครับ?', 'ORDINAL_NO_CONTEXT');
}

function bindConditional(state: ConversationState, discourse: DiscourseInterpretation): IntentResolution {
  const last = state.recentVerification;
  if (discourse.ifKind === 'test' && last?.kind === 'test' && last.ok === false) {
    return talk('test ยังไม่ผ่าน เลยยังไม่ทำขั้นตอนถัดไปครับ', 'CONDITIONAL_HELD');
  }
  if (discourse.ifKind === 'build' && last?.kind === 'build' && last.ok === false) {
    return talk('build ยังไม่ผ่าน เลยยังไม่เปิด preview ครับ', 'CONDITIONAL_HELD');
  }
  const resolved = uniqueSlugOrClarify(state);
  if ('message' in resolved) return clarify(resolved.message, 'NEED_PROJECT');
  let acts = nextActsForConditional(discourse);
  if (discourse.ifKind === 'test' && last?.kind === 'test' && last.ok) {
    acts = acts.filter(item => item !== 'TEST');
  }
  if (discourse.ifKind === 'build' && last?.kind === 'build' && last.ok) {
    acts = acts.filter(item => item !== 'BUILD');
  }
  const calls = acts
    .map(act => callForAct(act, state, resolved.slug, discourse))
    .filter((item): item is { id: string; input: Record<string, unknown> } => Boolean(item));
  if (!calls.length) return talk('จำเงื่อนไขนั้นไว้ครับ', 'CONDITIONAL_STORED');
  return {
    kind: 'CAPABILITY',
    capabilityId: calls[0]!.id,
    arguments: calls[0]!.input,
    extraCalls: calls.slice(1),
    confidence: 'HIGH',
    reasonCode: 'CONDITIONAL_CHAIN',
    consumed: true,
    source: 'context',
    actionClass: 'ACTIONABLE',
    contextEvidence: { contextSource: 'working-memory', resolvedReferent: resolved.slug },
  };
}

function callForAct(
  act: DiscourseAct,
  state: ConversationState,
  slug: string,
  discourse: DiscourseInterpretation,
): { id: string; input: Record<string, unknown> } | undefined {
  if (act === 'MODIFY_PROJECT' || act === 'EXECUTE_NOW') {
    return {
      id: SOFTWARE_APPLY_BUILD,
      input: {
        planId: state.activePlanId,
        goalId: state.activeGoalId,
        brief: changeBrief(state, discourse.change || '', discourse),
        merge: true,
      },
    };
  }
  if (act === 'TEST') return { id: PROJECT_RUN_TESTS, input: { slug } };
  if (act === 'BUILD') return { id: PROJECT_BUILD, input: { slug } };
  if (act === 'PREVIEW') return { id: PROJECT_START_DEV_SERVER, input: { slug } };
  return undefined;
}

function grantPending(state: ConversationState): IntentResolution {
  if (!state.pendingPermission) {
    return talk('ตอนนี้ไม่มีคำขอสิทธิ์ค้างครับ', 'NO_PENDING_PERMISSION');
  }
  return {
    kind: 'CONVERSATION',
    confidence: 'HIGH',
    reasonCode: 'GRANT_PENDING_PERMISSION',
    consumed: true,
    source: 'context',
    actionClass: 'CONVERSATION',
    userMessage: 'อนุญาตงานนี้ตามคำขอที่ค้างอยู่ครับ',
  };
}

function restore(state: ConversationState, text = ''): IntentResolution {
  const project = restoreProject(state, text);
  const label = project?.label || 'งานเว็บเดิม';
  return talk(`กลับไปที่ ${label} ครับ`, 'RESTORE_TOPIC');
}

function projectCall(state: ConversationState, capabilityId: string, reasonCode: string): IntentResolution {
  const resolved = uniqueSlugOrClarify(state);
  if ('message' in resolved) return clarify(resolved.message, 'NEED_PROJECT');
  return capability(capabilityId, { slug: resolved.slug }, reasonCode, resolved.slug);
}

function capability(
  capabilityId: string,
  args: Record<string, unknown>,
  reasonCode: string,
  referent?: string,
): IntentResolution {
  return {
    kind: 'CAPABILITY',
    capabilityId,
    arguments: args,
    confidence: 'HIGH',
    reasonCode,
    consumed: true,
    source: 'context',
    actionClass: 'ACTIONABLE',
    ...(referent ? { contextEvidence: { contextSource: 'working-memory', resolvedReferent: referent } } : {}),
  };
}

function talk(userMessage: string, reasonCode: string): IntentResolution {
  return {
    kind: 'CONVERSATION',
    confidence: 'HIGH',
    reasonCode,
    userMessage,
    consumed: true,
    source: 'context',
    actionClass: 'CONVERSATION',
  };
}

function clarify(userMessage: string, reasonCode: string): IntentResolution {
  return {
    kind: 'CLARIFICATION',
    confidence: 'HIGH',
    reasonCode,
    userMessage,
    consumed: true,
    source: 'context',
    actionClass: 'AMBIGUOUS',
  };
}

function bindStatus(state: ConversationState, discourse: DiscourseInterpretation): IntentResolution {
  const focus = discourse.statusFocus || 'progress';
  if (focus === 'readiness') {
    return capability(JARVIS_RUNTIME_STATUS, {}, 'CONVERSATION_READINESS');
  }
  if (focus === 'recent') {
    return talk(recentWorkLine(state), 'STATUS_QUERY');
  }
  if (focus === 'verification') {
    const last = state.recentVerification;
    if (!last) return talk('ยังไม่มีผล test หรือ build ล่าสุดครับ', 'STATUS_QUERY');
    const verdict = last.ok === true ? 'ผ่าน' : last.ok === false ? 'ยังไม่ผ่าน' : 'ยังไม่ทราบผล';
    return talk(`${last.kind} ล่าสุด${last.slug ? ` ของ ${last.slug}` : ''} ${verdict}${last.summary ? ` · ${last.summary}` : ''}`, 'STATUS_QUERY');
  }
  if (focus === 'failure') {
    if (state.lastError && !isPermissionPrompt(state.lastError.summary)) {
      return talk(state.lastError.summary, 'STATUS_QUERY');
    }
    if (state.recentVerification?.ok === false) {
      return talk(`${state.recentVerification.kind} ล่าสุดยังไม่ผ่าน${state.recentVerification.summary ? ` · ${state.recentVerification.summary}` : ''}`, 'STATUS_QUERY');
    }
    return talk('ตอนนี้ยังไม่มี failure ที่บันทึกไว้ครับ', 'STATUS_QUERY');
  }
  if (focus === 'preview') {
    if (state.activePreview?.url) {
      return talk(
        `preview ของ ${state.activePreview.slug || state.activeProjectSlug || 'โปรเจกต์นี้'} อยู่ที่ ${state.activePreview.url}${state.activePreview.port ? ` port ${state.activePreview.port}` : ''}`,
        'STATUS_QUERY',
      );
    }
    return talk('ตอนนี้ยังไม่มี preview ที่เปิดอยู่ครับ', 'STATUS_QUERY');
  }
  if (focus === 'inventory') {
    if (!state.projects.length) return talk('ยังไม่มีโปรเจกต์ในบริบทนี้ครับ', 'STATUS_QUERY');
    const lines = state.projects.map((item, index) => `${index + 1}. ${item.label} (${item.slug})${item.slug === state.activeProjectSlug ? ' · active' : ''}`);
    return talk(lines.join('\n'), 'STATUS_QUERY');
  }
  if (focus === 'preference') {
    const remembered = state.remembered.slice(-4);
    return talk(remembered.length ? `ตอบตามที่จำไว้: ${remembered.join(' · ')}` : 'ยังไม่มี preference การตอบที่จำไว้ครับ', 'STATUS_QUERY');
  }
  if (focus === 'pending') {
    return talk(pendingWorkLine(state), 'STATUS_QUERY');
  }
  if (focus === 'progress' || focus === 'project') {
    return talk(progressLine(state), 'STATUS_QUERY');
  }
  return talk(statusLine(state), 'STATUS_QUERY');
}

function progressLine(state: ConversationState): string {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const recent = sanitizedRecent(state.recentOperation?.summary);
  const bits = [
    project ? `โปรเจกต์ ${project.label}` : '',
    state.pendingPlanReview ? 'แผนรอรีวิว' : '',
    state.pendingPermission ? 'รออนุญาตงานนี้' : '',
    recent ? `ล่าสุด ${recent}` : '',
    state.activePreview?.url
      ? `preview ${state.activePreview.url}${state.activePreview.port ? ` port ${state.activePreview.port}` : ''}`
      : '',
  ].filter(Boolean);
  return bits.join(' · ') || 'ยังไม่มีงานค้างครับ';
}

function pendingWorkBits(state: ConversationState): string[] {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const queue = state.queue.filter(item => item.status === 'pending' || item.status === 'running');
  return [
    state.pendingPermission ? 'รออนุญาตงานนี้' : '',
    state.pendingPlanReview ? `แผนรอรีวิว: ${state.pendingPlanReview.title || state.pendingPlanReview.planId}` : '',
    queue.length ? `คิว ${queue.map(item => item.text).join(' · ')}` : '',
    state.activeGoalId ? `เป้าหมาย ${state.activeGoalId}` : '',
    project ? `โปรเจกต์ ${project.label}` : state.activeProjectSlug ? `โปรเจกต์ ${state.activeProjectSlug}` : '',
    state.paused ? 'พักไว้ชั่วคราว' : '',
  ].filter(Boolean);
}

function pendingWorkLine(state: ConversationState): string {
  const bits = pendingWorkBits(state);
  return bits.length ? bits.join(' · ') : 'ยังไม่มีงานค้างครับ';
}

function startFreshLine(state: ConversationState): string {
  const bits = pendingWorkBits(state);
  if (bits.length) {
    return `ยังมีงานค้างอยู่: ${bits.join(' · ')} ถ้าจะเริ่มเรื่องใหม่ บอกได้เลยครับว่าอยากทำอะไร`;
  }
  return 'ได้ครับ พร้อมเริ่มงานใหม่ อยากให้ทำอะไร?';
}

function recentWorkLine(state: ConversationState): string {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const recent = sanitizedRecent(state.recentOperation?.summary);
  const bits = [
    project ? `งานล่าสุดคือ ${project.label}` : state.activeTopic !== 'idle' ? `หัวข้อล่าสุดคือ ${state.activeTopic}` : '',
    recent ? `เพิ่ง ${recent}` : '',
    state.lastOwnerIntent ? `คำขอล่าสุด: ${state.lastOwnerIntent}` : '',
    state.lastJarvisAction && !/MISSING_CAPABILITY|unbound\.apply/i.test(state.lastJarvisAction)
      ? `JARVIS ทำ: ${state.lastJarvisAction}`
      : '',
  ].filter(Boolean);
  return bits.join(' · ') || 'ยังไม่มีงานล่าสุดในบริบทนี้ครับ';
}

function statusLine(state: ConversationState): string {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const running = state.queue.find(item => item.status === 'running');
  const pending = state.queue.filter(item => item.status === 'pending');
  const bits = [
    project ? `โปรเจกต์ ${project.label}` : state.activeTopic !== 'idle' ? `หัวข้อ ${state.activeTopic}` : 'ยังไม่มีโปรเจกต์ค้าง',
    state.projects.length > 1 ? `ทั้งหมด ${state.projects.length} โปรเจกต์` : '',
    state.pendingPlanReview ? 'แผนรอรีวิว' : '',
    state.pendingPermission ? 'รออนุญาต' : '',
    state.recentVerification ? `ล่าสุด ${state.recentVerification.kind}${state.recentVerification.ok === false ? ' ยังไม่ผ่าน' : state.recentVerification.ok ? ' ผ่าน' : ''}` : '',
    state.activePreview?.url
      ? `preview ${state.activePreview.url}${state.activePreview.port ? ` port ${state.activePreview.port}` : ''}`
      : '',
    running ? `คิวกำลังทำ: ${running.text}` : '',
    pending.length ? `คิวเหลือ ${pending.length} ข้อ` : '',
  ].filter(Boolean);
  return bits.join(' · ') || 'ยังไม่มีงานค้างครับ';
}

function bindQueue(
  state: ConversationState,
  discourse: DiscourseInterpretation,
  text: string,
): IntentResolution {
  if (discourse.queueOp?.kind === 'start') {
    return continueWork(state, text, { ...discourse, act: 'CONTINUE' });
  }
  if (discourse.queueOp?.kind === 'review' || !discourse.queueItems?.length) {
    const items = state.queue.length
      ? state.queue.map((item, index) => `${index + 1}. ${item.text} (${item.status})`)
      : (discourse.queueItems || []).map((item, index) => `${index + 1}. ${item}`);
    return talk(items.length ? `คิวตอนนี้:\n${items.join('\n')}` : 'ยังไม่มีคิวครับ', 'QUEUE_REVIEW');
  }
  return talk(queuePreview(discourse.queueItems), 'QUEUE_CAPTURED');
}

function interpretQueueItemAct(text: string, state: ConversationState): DiscourseAct {
  return interpretDiscourse(text, { ...state, queue: [] }).act;
}

function queuePreview(items: string[]): string {
  return `รับคิว ${items.length} ข้อแล้ว:\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
}

function changeBrief(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): string {
  const selected = state.selectedOption?.payload || state.selectedOption?.label;
  const here = /ตรงนั้น|ตรงนี้|this file|that function|ตรงนั้นแหละ/iu.test(text) && state.referents.this_file
    ? `in ${state.referents.this_file}`
    : '';
  return [discourse.change || state.pendingChange || text, selected, here, ...state.constraints].filter(Boolean).join('\n');
}

function researchQuery(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): string {
  const next = (discourse.researchQuery || text).trim();
  if (extractComparisonOptions(next).length >= 2) return next.slice(0, 240);
  const stem = state.lastResearchQuery
    || (extractComparisonOptions(state.lastOwnerIntent).length ? state.lastOwnerIntent : '');
  if (stem && stem !== next) {
    return `${stem} | ${next}`.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  return next.slice(0, 200);
}

function recommendResearch(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): IntentResolution {
  const options = state.offeredOptions.length
    ? state.offeredOptions
    : extractComparisonOptions(state.lastResearchQuery || state.lastOwnerIntent);
  const picked = pickRecommendedOption(options, `${state.lastOwnerIntent || ''} ${state.pendingChange || ''} ${text}`);
  if (picked) {
    return talk(
      `เอา${picked.label} ครับ เหมาะกับเกณฑ์ที่คุยกันกว่า ถ้าจะใส่ในแผนบอกได้เลย`,
      'RESEARCH_RECOMMEND',
    );
  }
  if (state.lastResearchQuery) {
    return capability(
      RESEARCH_CURRENT,
      { query: `${state.lastResearchQuery} recommend one lightweight option for a portfolio website`.slice(0, 240) },
      'CONVERSATION_RESEARCH_RECOMMEND',
    );
  }
  return capability(RESEARCH_CURRENT, { query: researchQuery(state, text, discourse) }, 'CONVERSATION_RESEARCH');
}

export function nextActsForConditional(discourse: DiscourseInterpretation | DiscourseAct): DiscourseAct[] {
  if (typeof discourse === 'string') {
    return discourse === 'CONDITIONAL' ? ['TEST', 'BUILD', 'PREVIEW'] : [discourse];
  }
  if (discourse.thenActs?.length) return discourse.thenActs;
  if (discourse.ifKind === 'test' && discourse.thenAct === 'PREVIEW') return ['TEST', 'BUILD', 'PREVIEW'];
  if (discourse.ifKind === 'test') return ['TEST', discourse.thenAct || 'BUILD'];
  if (discourse.ifKind === 'build') return ['BUILD', discourse.thenAct || 'PREVIEW'];
  return ['TEST', 'BUILD'];
}
