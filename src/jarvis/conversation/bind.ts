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
import type { ConversationState, DiscourseAct, DiscourseInterpretation, OfferedOption } from './types';
import { uniqueSlugOrClarify, restoreProject, projectForOwnerText, activeProject, isLeftoverWaitingPlan } from './referents';
import { interpretDiscourse } from './discourse';
import { sanitizedRecent, isPermissionPrompt, isReportableFailure, extractComparisonOptions, pickRecommendedOption } from './view';

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
      return talk('สวัสดีครับ', discourse.act);
    case 'ACKNOWLEDGE':
      if (discourse.change === 'HOLD_MUTATION') {
        return talk('ยังไม่แก้เว็บตามที่เลือกไว้ครับ', 'HOLD_MUTATION');
      }
      return talk('รับทราบครับ', discourse.act);
    case 'PAUSE':
      return talk('พักไว้ก่อนได้ครับ งานเดิมยังอยู่', 'PAUSE');
    case 'CANCEL':
      return talk('ยกเลิกงานค้างล่าสุดแล้วครับ ยังไม่แก้ไฟล์', 'CANCEL_PENDING');
    case 'MODEL_QUERY':
      return capability(JARVIS_RUNTIME_STATUS, {}, 'CONVERSATION_MODEL');
    case 'MEMORY_QUERY':
      return bindMemoryQuery(state, text);
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
      return bindStatus(state, discourse, text);
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
      return projectCall(state, PROJECT_START_DEV_SERVER, 'CONVERSATION_PREVIEW', text);
    case 'STOP_PREVIEW':
      return projectCall(state, PROJECT_STOP_DEV_SERVER, 'CONVERSATION_STOP_PREVIEW', text);
    case 'RESTART_PREVIEW':
      return restartPreview(state);
    case 'TEST':
      return projectCall(state, PROJECT_RUN_TESTS, 'CONVERSATION_TEST', text);
    case 'BUILD':
      return projectCall(state, PROJECT_BUILD, 'CONVERSATION_BUILD', text);
    case 'RERUN':
      return rerun(state);
    case 'INSPECT_PROJECT':
      return inspect(state, text);
    case 'MODIFY_PROJECT':
    case 'EXECUTE_NOW':
    case 'CONTINUE':
      return continueWork(state, text, discourse);
    case 'SELECT_ORDINAL':
      return selectOrdinal(state, discourse);
    case 'CONDITIONAL':
      return bindConditional(state, discourse);
    case 'RESEARCH':
      if (discourse.change === 'RECALL') return recallResearch(state, text);
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
  if (id === DESKTOP_OPEN_SCOPED_RESOURCE && looksLikeResearchApply(text, state)) {
    return recallResearch(state, text);
  }
  if (id === DESKTOP_OPEN_SCOPED_RESOURCE && looksLikeMemoryRecall(text)) {
    const recalled = bindDiscourseToIntent({
      act: 'MEMORY_QUERY',
      change: text,
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
    }, state, text);
    if (recalled) return recalled;
  }
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
  if (looksLikeMemoryRecall(text)) return false;
  return /เปิดให้ดู|เปิดดู|preview|เพิ่มปุ่ม|dark mode|animation|navbar|hover|เว็บนี้|เว็บเรา|โปรเจกต์นี้|\b(it|this|that)\b|มัน|อันนี้|รันใหม่|build ใหม่|\badd\b|\bchange\b|\bmake\b|ขาวหมด|blank|console|สมมติ/iu.test(text)
    && !/chrome|youtube|notepad|spotify|cursor|vscode/iu.test(text);
}

function looksLikeMemoryRecall(text: string): boolean {
  return /สีเว็บ|สีที่เราคุย|สีที่ผมเลือก|สีของเว็บ|เราคุยอะไร|เราคุยกัน|จำอะไรเกี่ยวกับ|เมื่อกี้เราคุย|เมื่อกี้เราทำอะไร/iu.test(text);
}

function looksLikeResearchApply(text: string, state: ConversationState): boolean {
  return Boolean(
    (state.lastResearchQuery || state.selectedOption)
    && /ใช้ตัวนั้น|ได้ตรงไหน|ย้อนกลับไปเรื่อง|ตัวที่นายแนะนำ|ที่แนะนำชื่อ/iu.test(text),
  );
}

function continueWork(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): IntentResolution | null {
  if (permissionBlocksCurrentWork(state)) {
    if (discourse.act === 'MODIFY_PROJECT' || discourse.act === 'ACCUMULATE_REQUIREMENTS' || discourse.change) {
      return talk(
        `จำไว้แล้วครับ: ${discourse.change || text} — งานนี้ยังรออนุญาตอยู่ กดอนุญาตงานนี้ได้เลย`,
        'WAITING_PERMISSION_NOTED',
      );
    }
    return talk('งานนี้รออนุญาตอยู่ครับ กดอนุญาตงานนี้ได้เลย', 'WAITING_PERMISSION');
  }
  if (
    state.pendingPlanReview
    && !isLeftoverWaitingPlan(state)
    && discourse.act !== 'MODIFY_PROJECT'
    && discourse.act !== 'EXECUTE_NOW'
  ) {
    return approve(state);
  }
  if (discourse.act === 'EXECUTE_NOW' && state.pendingChange) {
    return applyChange(state, text, discourse);
  }
  if (discourse.act === 'EXECUTE_NOW' && state.pendingConditional?.thenActs?.length) {
    return bindConditional(state, {
      act: 'CONDITIONAL',
      ifKind: state.pendingConditional.ifKind,
      thenAct: state.pendingConditional.thenAct,
      thenActs: state.pendingConditional.thenActs,
      confidence: 'HIGH',
      requiresClarification: false,
      source: 'discourse',
      change: text,
    });
  }
  const fromRecentEdit = /MODIFY_PROJECT|ACCUMULATE_REQUIREMENTS|NEGATE|CORRECT|SELECT_ORDINAL/.test(state.lastDiscourse || '');
  if (discourse.act === 'MODIFY_PROJECT' || discourse.change) {
    if (!state.activePlanId && !state.activeProjectSlug) {
      return capability(SOFTWARE_PLAN_BUILD, { brief: discourse.change || text }, 'CONVERSATION_MODIFY_NEEDS_PLAN');
    }
    return applyChange(state, text, discourse);
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
  if (
    state.activePlanId
    && (state.lastJarvisAction === SOFTWARE_PLAN_BUILD || state.pendingPlanReview)
    && !isLeftoverWaitingPlan(state)
  ) {
    return approve(state);
  }
  if (state.activeProjectSlug) {
    const last = state.recentVerification || state.recentOperation;
    if (discourse.act === 'EXECUTE_NOW' && (state.pendingChange || state.selectedOption || fromRecentEdit)) {
      return applyChange(state, text, discourse);
    }
    if (last?.kind === 'test' && discourse.act !== 'EXECUTE_NOW' && discourse.act !== 'CONTINUE') {
      return projectCall(state, PROJECT_RUN_TESTS, 'CONVERSATION_CONTINUE_TEST');
    }
    if (last?.kind === 'build' && discourse.act !== 'EXECUTE_NOW' && discourse.act !== 'CONTINUE') {
      return projectCall(state, PROJECT_BUILD, 'CONVERSATION_CONTINUE_BUILD');
    }
    if (last?.kind === 'preview' && discourse.act !== 'EXECUTE_NOW' && discourse.act !== 'CONTINUE') {
      return projectCall(state, PROJECT_START_DEV_SERVER, 'CONVERSATION_CONTINUE_PREVIEW');
    }
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
    return applyChange(state, text, discourse);
  }
  return talk('ตอนนี้ยังไม่มีงานค้างที่ต่อได้ทันที บอกได้เลยว่าให้ทำอะไรต่อ', 'NOTHING_TO_CONTINUE');
}

function applyChange(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): IntentResolution {
  const project = projectForOwnerText(state, text);
  return capability(SOFTWARE_APPLY_BUILD, {
    planId: project?.planId || currentPlanId(state),
    goalId: project?.goalId || state.activeGoalId,
    brief: changeBrief(state, text, discourse),
    merge: true,
  }, 'CONVERSATION_MODIFY');
}

function currentPlanId(state: ConversationState): string | undefined {
  return activeProject(state)?.planId || state.activePlanId;
}

function approve(state: ConversationState): IntentResolution {
  const planId = isLeftoverWaitingPlan(state)
    ? currentPlanId(state)
    : (state.pendingPlanReview?.planId || currentPlanId(state));
  if (!planId) return clarify('ยังไม่มีแผนที่รออนุมัติครับ', 'NO_PLAN');
  return capability(SOFTWARE_APPLY_BUILD, {
    planId,
    goalId: state.pendingPlanReview?.goalId || state.activeGoalId,
    brief: state.pendingPlanReview?.title || 'approved plan',
  }, 'CONVERSATION_APPROVE_PLAN');
}

function accumulate(state: ConversationState, brief: string): IntentResolution {
  const planId = isLeftoverWaitingPlan(state)
    ? currentPlanId(state)
    : (state.pendingPlanReview?.planId || currentPlanId(state));
  if (!planId) return capability(SOFTWARE_PLAN_BUILD, { brief }, 'CONVERSATION_PLAN');
  return capability(SOFTWARE_PLAN_BUILD, { brief, planId, merge: true }, 'CONVERSATION_MERGE_PLAN');
}

function planRequest(state: ConversationState, text: string): IntentResolution {
  if (/เพิ่มอะไรดี|what should we add|what to add/iu.test(text) && (state.activeProjectSlug || state.activePlanId)) {
    return talk(suggestAdditions(state), 'SUGGEST_ADDITIONS');
  }
  if (/ก่อนแก้|บอกแผนสั้น|plan first|short plan/iu.test(text) && (state.activeProjectSlug || state.referents.this_file)) {
    const target = state.referents.this_file || state.activeProjectSlug || 'โปรเจกต์นี้';
    const change = state.pendingChange || 'ตามที่ชี้ไว้';
    const blocked = state.constraints.slice(-3).join(' · ');
    return talk(
      `แผนสั้น: แก้ ${target} — ${change}${blocked ? ` ข้อจำกัด: ${blocked}` : ''} ยังไม่เขียนไฟล์จนกว่าจะให้ทำ`,
      'PLAN_SUMMARY',
    );
  }
  if (/แผนเปลี่ยนจากเดิม|แผนต่างจาก|ต่างจากแผนเดิม|plan (?:changed|differ)/iu.test(text)) {
    const project = activeProject(state);
    const leftover = isLeftoverWaitingPlan(state);
    return talk(
      leftover
        ? `แผนหลักยังเป็นของ ${project?.label || 'โปรเจกต์ปัจจุบัน'} ครับ แผนรอรีวิวที่ค้างอยู่ยังไม่ได้แทนที่งานนี้`
        : `แผนหลักยังเป็นของ ${project?.label || 'โปรเจกต์ปัจจุบัน'} ครับ ยังไม่มีแผนใหม่ที่นำมาใช้แทน`,
      'PLAN_DIFF',
    );
  }
  if (state.pendingPlanReview || state.activePlanId) {
    const title = isLeftoverWaitingPlan(state)
      ? (activeProject(state)?.label || 'แผนปัจจุบัน')
      : (state.pendingPlanReview?.title || 'แผนปัจจุบัน');
    if (/สั้น/iu.test(text)) {
      return talk(`สรุปสั้นๆ: ${title} ยังเป็นแผนเดิมครับ อนุมัติได้เลยหรือจะเพิ่มอะไร`, 'PLAN_SUMMARY');
    }
    return talk(`ใช้แผน ${title} ได้ครับ บอกได้เลยว่าจะให้อนุมัติ หรือจะเพิ่มอะไรในแผน`, 'PLAN_SUMMARY');
  }
  return capability(SOFTWARE_PLAN_BUILD, { brief: text }, 'CONVERSATION_PLAN_REQUEST');
}

function suggestAdditions(state: ConversationState): string {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const blocked = state.constraints.join(' ');
  if (project?.kind === 'software' || /todo/i.test(project?.label || project?.slug || '')) {
    return ['1. Clear completed', '2. Filter by status', '3. Dark mode'].join('\n');
  }
  const options = [
    '1. Hero stats',
    '2. Featured project section',
    /testimonial/i.test(blocked) ? null : '3. Testimonials',
  ].filter(Boolean);
  if (!options.some(item => /Testimonials/i.test(item || ''))) {
    options.push('3. Skills grid');
  }
  return options.join('\n');
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
  if (/เมื่อกี้แก้อะไร|ไฟล์ไหนเปลี่ยน|what changed|which files? changed/iu.test(text)) {
    const files = state.recentOperation?.files?.filter(Boolean) || [];
    if (files.length) {
      return talk(files.slice(0, 12).join(', '), 'INSPECT_RECENT_FILES');
    }
    const recent = sanitizedRecent(state.recentOperation?.summary);
    const change = state.pendingChange || state.selectedOption?.label;
    if (change || recent) {
      return talk(`ล่าสุดแก้: ${[change, recent].filter(Boolean).join(' · ')}`, 'INSPECT_RECENT_CHANGE');
    }
  }
  if (/มีหน้าอะไร|which pages|what pages/iu.test(text)) {
    return capability(PROJECT_READ_FILE, { slug: resolved.slug, relativePath: 'src/App.jsx' }, 'CONVERSATION_READ_PAGES');
  }
  if (/package\.json|package อะไร|ติดตั้งแล้วหรือยัง|ใช้จริงไหม/iu.test(text)) {
    const file = /ใช้จริงไหม/iu.test(text) ? (state.referents.this_file || 'src/App.jsx') : 'package.json';
    return capability(PROJECT_READ_FILE, { slug: resolved.slug, relativePath: file }, 'CONVERSATION_READ_PACKAGE');
  }
  if (/function ไหน|ฟังก์ชันไหน|ส่วนไหน|which (?:function|part)|ไฟล์ไหน.*(จัดการ|todo)/iu.test(text)) {
    const file = state.referents.this_file || 'src/App.jsx';
    return capability(PROJECT_READ_FILE, { slug: resolved.slug, relativePath: file }, 'CONVERSATION_READ_SYMBOL');
  }
  if (/\.jsx?|\.tsx?|\.css|\.json|App\.jsx/iu.test(text)) {
    const matched = text.match(/([\w./-]+\.(?:jsx?|tsx?|css|json))/iu)?.[1] || 'src/App.jsx';
    const file = matched.includes('/') ? matched : `src/${matched}`;
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

function selectOrdinal(state: ConversationState, discourse: DiscourseInterpretation): IntentResolution | null {
  const ordinals = (discourse.ordinals?.length ? discourse.ordinals : discourse.ordinal ? [discourse.ordinal] : [])
    .filter((item): item is number => Number.isFinite(item) && item > 0);
  const ordinal = ordinals[0];
  if (!ordinal) return clarify('อันไหนที่หมายถึงครับ?', 'ORDINAL_MISSING');
  const pool = usableChoiceOptions(state, discourse.change || '');
  const source = pool.length ? pool : state.offeredOptions;
  if (source.length) {
    const picked = ordinals
      .map(index => source.find(item => item.index === index) || source[index - 1])
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!picked.length) return clarify('ไม่มีตัวเลือกนั้นครับ', 'ORDINAL_UNKNOWN');
    const labels = picked.map(item => item.label);
    if (/คืออะไร|what is/iu.test(discourse.change || '')) {
      return talk(ordinals.length > 1 ? labels.join(' · ') : labels[0]!, 'ORDINAL_RECALL');
    }
    if (state.lastDiscourse === 'RESEARCH' || state.activeTopic === 'research') {
      return talk(`เอา${labels.join(' และ ')} ครับ`, 'ORDINAL_NOTED');
    }
    if (state.activeProjectSlug || state.activePlanId) {
      return talk(`เอา${labels.join(' และ ')} ครับ`, 'ORDINAL_NOTED');
    }
    return talk(`เอา${labels.join(' และ ')} ครับ`, 'ORDINAL_NOTED');
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
  const thenActs = nextActsForConditional(discourse);
  if (discourse.change === 'CONTINUE_IF_HEALTHY' || discourse.thenAct === 'CONTINUE') {
    if (last?.ok === false) {
      return talk('ขั้นตอนล่าสุดยังไม่ผ่าน เลยยังไม่ไปต่อครับ', 'CONDITIONAL_HELD');
    }
    const stored = (state.pendingConditional?.thenActs || []).filter(item => item !== 'CONTINUE' && item !== 'PAUSE');
    if (stored.length) {
      return bindConditional(state, {
        ...discourse,
        act: 'CONDITIONAL',
        change: discourse.change === 'CONTINUE_IF_HEALTHY' ? 'ทำเลย' : discourse.change,
        thenAct: stored[stored.length - 1],
        thenActs: stored,
        ifKind: state.pendingConditional?.ifKind || discourse.ifKind,
      });
    }
    if (state.queue.some(item => item.status === 'pending' || item.status === 'running')) {
      return continueWork(state, discourse.change || '', { ...discourse, act: 'CONTINUE' });
    }
    return talk('ขั้นตอนล่าสุดไม่พังครับ พร้อมไปขั้นถัดไปเมื่อมีงานค้าง', 'CONDITIONAL_READY');
  }
  if (discourse.change === 'STOP_ON_FAIL' || thenActs.includes('PAUSE') || discourse.thenAct === 'PAUSE') {
    return talk('จำไว้ครับ ถ้าขั้นตอนไหน fail จะหยุดแล้วบอกสาเหตุ ไม่ทำขั้นถัดไป', 'CONDITIONAL_STOP_ON_FAIL');
  }
  if (thenActs.includes('MODIFY_PROJECT')) {
    const problem = (last && last.ok === false) || isReportableFailure(state.lastError?.summary);
    if (!problem) return talk('ยังไม่เจอปัญหาที่ต้องแก้ครับ', 'CONDITIONAL_HELD');
    return applyChange(state, discourse.change || '', discourse);
  }
  if (shouldStoreChain(discourse.change || '', last, thenActs)) {
    return talk(
      `จำลำดับไว้แล้ว: ${thenActs.join(' → ').toLowerCase()} ยังไม่รันจนกว่าจะให้เริ่ม`,
      'CONDITIONAL_STORED',
    );
  }
  if (discourse.ifKind === 'test' && last?.kind === 'test' && last.ok === false) {
    return talk('test ยังไม่ผ่าน เลยยังไม่ทำขั้นตอนถัดไปครับ', 'CONDITIONAL_HELD');
  }
  if (discourse.ifKind === 'build' && last?.kind === 'build' && last.ok === false) {
    return talk('build ยังไม่ผ่าน เลยยังไม่เปิด preview ครับ', 'CONDITIONAL_HELD');
  }
  const resolved = uniqueSlugOrClarify(state);
  if ('message' in resolved) return clarify(resolved.message, 'NEED_PROJECT');
  let acts = thenActs;
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

function shouldStoreChain(
  text: string,
  last: ConversationState['recentVerification'] | undefined,
  acts: DiscourseAct[],
): boolean {
  if (last?.ok === false) return false;
  if (/ทำเลย|เริ่มเลย|ไปเลย|ต่อเลย|do it|go ahead|execute/iu.test(text)) return false;
  if (/ถ้า.{0,24}(?:ผ่าน|โอเค)|if .{0,24}(?:pass|ok(?:ay)?)/iu.test(text)) return false;
  if (last?.ok && preconditionAlreadyMet(last, acts)) return false;
  return acts.length >= 2;
}

function preconditionAlreadyMet(
  last: NonNullable<ConversationState['recentVerification']>,
  acts: DiscourseAct[],
): boolean {
  if (last.kind === 'test' && acts.includes('TEST')) return true;
  if (last.kind === 'build' && acts.includes('BUILD')) return true;
  return false;
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

function projectCall(state: ConversationState, capabilityId: string, reasonCode: string, text = ''): IntentResolution {
  const targeted = projectForOwnerText(state, text);
  if (targeted?.slug) return capability(capabilityId, { slug: targeted.slug }, reasonCode, targeted.slug);
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

function bindMemoryQuery(state: ConversationState, text: string): IntentResolution {
  if (/เปิด history|show history|open history|เปิดประวัติ/iu.test(text)) {
    return talk('เปิดแผง History ได้จาก Presence แล้วครับ', 'OPEN_HISTORY');
  }
  if (/จำบทสนทนา|ได้ทั้งหมดไหม|whole conversation|entire (?:chat|conversation)/iu.test(text)) {
    return talk(
      'จำ working context ของ session นี้ครับ ไม่ได้เก็บ transcript ทั้งก้อนเป็น memory ถาวร เว้นแต่คุณสั่งจำ',
      'CONVERSATION_MEMORY',
    );
  }
  if (/สีที่ผมเลือก|ตอนแรกผมบอกสี|สีอะไร|สีเว็บ|สีที่เราคุย|สีของเว็บ/iu.test(text)) {
    const color = [...state.remembered, ...state.constraints, state.pendingChange || '', state.lastOwnerIntent || '']
      .find(item => /ดำ|ฟ้า|ม่วง|black|blue|purple|palette|โทน|สีหลัก/iu.test(item));
    return talk(
      color ? `สีที่คุยกันไว้: ${color}` : 'ยังไม่มีสีที่จำเป็น memory ชัดเจนครับ ถ้าจะย้ำโทนเดิมบอกได้เลย',
      'CONVERSATION_MEMORY',
    );
  }
  if (/เปลี่ยนใจตรงไหน/iu.test(text)) {
    const bits = [...state.constraints, state.pendingChange || ''].filter(item => /ไม่|อย่า|เปลี่ยนใจ|หมายถึง/u.test(item));
    return talk(bits.length ? `จุดที่ปรับความหมาย: ${bits.slice(-3).join(' · ')}` : 'ยังไม่บันทึกจุดเปลี่ยนใจไว้ครับ', 'CONVERSATION_MEMORY');
  }
  if (/ย้อนแค่เรื่องเว็บ|memory ของ project/iu.test(text)) {
    return talk(progressLine(state), 'CONVERSATION_MEMORY');
  }
  if (/ถ้าผมกลับมาพรุ่งนี้/iu.test(text)) {
    return talk(
      state.remembered.length
        ? 'ควรรู้ preference ที่สั่งจำไว้ครับ งานโปรเจกต์ยัง restore จาก working context ได้'
        : 'working context ของ session ยังอยู่ครับ preference ถาวรมีเมื่อคุณสั่งจำ',
      'CONVERSATION_MEMORY',
    );
  }
  if (/เราคุยอะไร|เราคุยกัน|เมื่อกี้เราคุย|เมื่อกี้เราทำอะไร/iu.test(text)) {
    return talk(recentWorkLine(state), 'CONVERSATION_MEMORY');
  }
  return talk(rememberedLine(state), 'CONVERSATION_MEMORY');
}

function rememberedLine(state: ConversationState): string {
  const bits = [
    ...state.remembered.slice(-4),
    ...state.constraints.slice(-3).map(item => `don't: ${item}`),
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'ยังไม่มี memory ที่เลือกจำไว้ครับ';
}

function bindStatus(state: ConversationState, discourse: DiscourseInterpretation, text = ''): IntentResolution {
  const focus = discourse.statusFocus || 'progress';
  if (focus === 'readiness') {
    return capability(JARVIS_RUNTIME_STATUS, {}, 'CONVERSATION_READINESS');
  }
  if (focus === 'recent') {
    return talk(recentWorkLine(state), 'STATUS_QUERY');
  }
  if (focus === 'verification') {
    const last = state.recentVerification;
    const wantBuild = /build/iu.test(text) && !/test/iu.test(text);
    const wantTest = /test/iu.test(text) && !/build/iu.test(text);
    if (wantBuild && last?.kind !== 'build') {
      return talk('ยังไม่มีผล build ล่าสุดครับ', 'STATUS_QUERY');
    }
    if (wantTest && last?.kind !== 'test') {
      return talk(last ? `${last.kind} ล่าสุดไม่ใช่ test ครับ` : 'ยังไม่มีผล test ล่าสุดครับ', 'STATUS_QUERY');
    }
    if (!last) return talk('ยังไม่มีผล test หรือ build ล่าสุดครับ', 'STATUS_QUERY');
    const verdict = last.ok === true ? 'ผ่าน' : last.ok === false ? 'ยังไม่ผ่าน' : 'ยังไม่ทราบผล';
    return talk(`${last.kind} ล่าสุด${last.slug ? ` ของ ${last.slug}` : ''} ${verdict}${last.summary ? ` · ${last.summary}` : ''}`, 'STATUS_QUERY');
  }
  if (focus === 'failure') {
    if (isReportableFailure(state.lastError?.summary) && state.lastError) {
      return talk(state.lastError.summary, 'STATUS_QUERY');
    }
    if (state.recentVerification?.ok === false) {
      return talk(`${state.recentVerification.kind} ล่าสุดยังไม่ผ่าน${state.recentVerification.summary ? ` · ${state.recentVerification.summary}` : ''}`, 'STATUS_QUERY');
    }
    return talk('ตอนนี้ยังไม่มี failure ที่บันทึกไว้ครับ', 'STATUS_QUERY');
  }
  if (focus === 'recovery') {
    if (/สมมติ/.test(text)) {
      return talk(
        'ถ้าหน้าเว็บขาว ผมจะเช็กว่า preview ยังรัน, ดู test/build error ล่าสุด, อ่านไฟล์หลักในโปรเจกต์นี้ แล้วแก้ใน sandbox นี้ — ไม่เปิดแอปนอกโปรเจกต์',
        'RECOVERY_PLAN',
      );
    }
    const cause = isReportableFailure(state.lastError?.summary) && state.lastError
      ? state.lastError.summary
      : state.recentVerification?.ok === false
        ? `${state.recentVerification.kind}: ${state.recentVerification.summary || 'ยังไม่ผ่าน'}`
        : '';
    if (!cause) return talk('ตอนนี้ยังไม่มี failure ที่บันทึกไว้ครับ จึงยังไม่มีวิธีแก้จาก error จริง', 'STATUS_QUERY');
    if (/มีโอกาสเกิดอีก/.test(text)) {
      return talk(`ถ้าไม่กันด้วย test/constraint เดิม อาจเกิดซ้ำได้ครับ สาเหตุล่าสุด: ${cause}`, 'STATUS_QUERY');
    }
    return talk(`แก้จากสาเหตุจริง: ${cause}`, 'STATUS_QUERY');
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
    const active = state.projects.find(item => item.slug === state.activeProjectSlug);
    if (/หลัก|main project|current project|กำลังทำอยู่|project ที่(?:เรา)?กำลังทำ|which project/iu.test(text) && active) {
      return talk(`โปรเจกต์หลักคือ ${active.label} (${active.slug})`, 'STATUS_QUERY');
    }
    if (!state.projects.length) return talk('ยังไม่มีโปรเจกต์ในบริบทนี้ครับ', 'STATUS_QUERY');
    const lines = state.projects.map((item, index) => `${index + 1}. ${item.label} (${item.slug})${item.slug === state.activeProjectSlug ? ' · active' : ''}`);
    return talk(lines.join('\n'), 'STATUS_QUERY');
  }
  if (focus === 'permission') {
    if (discourse.change === 'REFUSE_GLOBAL') {
      return talk(
        'ทำไม่ได้ครับ ไม่มีสิทธิ์แก้ทุกไฟล์ในเครื่อง จำกัดเฉพาะ project workspace ที่เปิดอยู่',
        'FORBIDDEN_SCOPE',
      );
    }
    if (discourse.change === 'QWEN_CANNOT_GRANT') {
      return talk('Qwen เพิ่มสิทธิ์เองไม่ได้ครับ ต้องเป็น owner อนุญาตตามคำขอที่ค้างอยู่เท่านั้น', 'QWEN_CANNOT_GRANT');
    }
    if (discourse.change === 'SCOPE_PROJECT') {
      const project = state.projects.find(item => item.slug === state.activeProjectSlug);
      return talk(
        `จำกัดสิทธิ์ไว้ที่ ${project?.label || 'โปรเจกต์ที่เปิดอยู่'} ครับ ไม่ขยายออกนอก sandbox นี้`,
        'PERMISSION_SCOPED',
      );
    }
    if (state.pendingPermission) {
      return talk(`มีคำขอสิทธิ์ค้างอยู่ proposal ${state.pendingPermission.proposalId} ขอบเขต THIS_GOAL ของโปรเจกต์นี้`, 'STATUS_QUERY');
    }
    const named = state.projects.find(item => {
      const hay = `${item.label} ${item.slug} ${item.kind}`;
      return /portfolio|เว็บ/iu.test(text) && /portfolio|website|เว็บ/iu.test(hay)
        || (item.slug && text.toLocaleLowerCase().includes(item.slug.toLocaleLowerCase()))
        || (item.label && text.toLocaleLowerCase().includes(item.label.toLocaleLowerCase()));
    });
    const project = named || state.projects.find(item => item.slug === state.activeProjectSlug);
    return talk(
      project
        ? `สิทธิ์ของ ${project.label} จำกัดที่ plan/test/build/preview ใน sandbox นี้ ไม่ครอบคลุมทั้งเครื่อง`
        : 'ตอนนี้ไม่มีคำขอสิทธิ์ค้าง และไม่มีสิทธิ์ทั้งเครื่อง',
      'STATUS_QUERY',
    );
  }
  if (focus === 'capability') {
    if (discourse.change === 'DEPLOY_GAP') {
      return talk(
        'ตอนนี้ deploy Vercel ยังทำไม่ได้ครับ ไม่มีสิทธิ์ปล่อยขึ้น production — ทำได้แค่ test/build/preview ในเครื่อง',
        'DEPLOY_UNSUPPORTED',
      );
    }
    if (discourse.change === 'PREPARE_DEPLOY') {
      return talk(
        'เตรียมในเครื่องได้ครับ: ตรวจ test, production build, และ preview ท้องถิ่น — ยังไม่มี Vercel token/สิทธิ์ deploy',
        'DEPLOY_PREPARE',
      );
    }
    return talk(
      'ทำได้ในโปรเจกต์ที่เปิดอยู่: แก้ไฟล์ใน sandbox, test, build, preview, แผน, research แบบอ่านอย่างเดียว — ยัง deploy Vercel / คลิกเดสก์ท็อป / shell อิสระไม่ได้',
      'STATUS_QUERY',
    );
  }
  if (focus === 'summary') {
    return talk(dailySummaryLine(state), 'STATUS_QUERY');
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
    state.pendingPlanReview
      ? `${isLeftoverWaitingPlan(state) ? 'แผนรอรีวิวที่ไม่ใช่งานปัจจุบัน' : 'แผนรอรีวิว'}: ${state.pendingPlanReview.title || state.pendingPlanReview.planId}`
      : '',
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

function dailySummaryLine(state: ConversationState): string {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const done = [
    project ? `โปรเจกต์ ${project.label}` : '',
    state.recentVerification?.ok === true ? `${state.recentVerification.kind} ผ่าน` : '',
    state.activePreview?.url ? `preview ${state.activePreview.url}` : '',
  ].filter(Boolean);
  const pending = pendingWorkBits(state);
  const failed = isReportableFailure(state.lastError?.summary) && state.lastError
    ? state.lastError.summary
    : state.recentVerification?.ok === false
      ? `${state.recentVerification.kind} ยังไม่ผ่าน`
      : '';
  const bits = [
    done.length ? `สำเร็จ: ${done.join(' · ')}` : 'ยังไม่มีรายการที่ปิดจบวันนี้',
    pending.length ? `ค้าง: ${pending.join(' · ')}` : 'ไม่มีคิวค้าง',
    failed ? `fail: ${failed}` : 'ไม่มี failure ที่บันทึก',
  ];
  return bits.join(' · ');
}

function recentWorkLine(state: ConversationState): string {
  const project = state.projects.find(item => item.slug === state.activeProjectSlug);
  const recent = sanitizedRecent(state.recentOperation?.summary);
  const research = state.lastResearchQuery ? `คุยเรื่อง ${state.lastResearchQuery.slice(0, 80)}` : '';
  const bits = [
    research,
    project && !research ? `งานล่าสุดคือ ${project.label}` : '',
    recent ? `เพิ่ง ${recent}` : '',
    !research && state.lastOwnerIntent ? `คำขอล่าสุด: ${state.lastOwnerIntent}` : '',
    !research && state.lastJarvisAction && !/MISSING_CAPABILITY|unbound\.apply|desktop\.open/i.test(state.lastJarvisAction)
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
  if (discourse.queueOp?.kind === 'append') {
    return talk(`เพิ่มท้ายคิว: ${discourse.queueOp.text}`, 'QUEUE_CAPTURED');
  }
  if (discourse.queueOp && discourse.queueOp.kind !== 'review') {
    return talk('ปรับคิวแล้วครับ', 'QUEUE_UPDATED');
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

function permissionBlocksCurrentWork(state: ConversationState): boolean {
  const pending = state.pendingPermission;
  if (!pending) return false;
  if (pending.goalId && state.activeGoalId && pending.goalId !== state.activeGoalId) return false;
  if (pending.planId && state.activePlanId && pending.planId !== state.activePlanId) return false;
  return true;
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
  return [discourse.change || state.pendingChange || text, selected, here, ...state.constraints]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8_000);
}

function researchQuery(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): string {
  const next = (discourse.researchQuery || text).trim();
  if (extractComparisonOptions(next).length >= 2) return next.slice(0, 200);
  const stem = state.lastResearchQuery
    || (extractComparisonOptions(state.lastOwnerIntent).length ? state.lastOwnerIntent : '');
  if (stem && stem !== next) {
    return `${stem} | ${next}`.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return next.slice(0, 200);
}

function recallResearch(state: ConversationState, text: string): IntentResolution {
  const label = state.selectedOption?.label
    || extractComparisonOptions(state.lastResearchQuery)[0]?.label
    || state.lastResearchQuery
    || 'ตัวที่แนะนำไว้';
  const project = activeProject(state)?.label || state.activeProjectSlug || 'เว็บนี้';
  if (/ชื่ออะไร|what (?:was|is) (?:it )?called|เรียกว่าอะไร/iu.test(text)) {
    return talk(`ตัวที่แนะนำไว้คือ ${label} ครับ`, 'RESEARCH_RECALL');
  }
  if (/ตรงไหน|where (?:can|could)|ใช้ตัวนั้นกับเว็บ/iu.test(text)) {
    return talk(`ใช้ ${label} กับ ${project} ได้ครับ ยังไม่ได้ลงในไฟล์ไหน`, 'RESEARCH_APPLY_HINT');
  }
  return talk(
    state.lastResearchQuery
      ? `เรื่องที่คุยไว้: ${state.lastResearchQuery}`
      : `เรื่องที่แนะนำไว้คือ ${label} ครับ`,
    'RESEARCH_RECALL',
  );
}

function recommendResearch(
  state: ConversationState,
  text: string,
  discourse: DiscourseInterpretation,
): IntentResolution {
  const options = usableChoiceOptions(state, text);
  const wantCount = Number((text.match(/เลือก\s*(\d+)\s*อย่าง/u) || [])[1] || 0);
  if (wantCount >= 2 && options.length >= wantCount) {
    const picked = options.slice(0, wantCount);
    return talk(
      picked.map((item, index) => `${index + 1}. ${item.label}`).join('\n'),
      'RESEARCH_RECOMMEND',
    );
  }
  if (wantCount >= 2 && state.lastResearchQuery) {
    return capability(
      RESEARCH_CURRENT,
      { query: `${state.lastResearchQuery} list ${wantCount} concise numbered recommendations for this portfolio`.slice(0, 200) },
      'CONVERSATION_RESEARCH_RECOMMEND',
    );
  }
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
      { query: `${state.lastResearchQuery} recommend one lightweight option for a portfolio website`.slice(0, 200) },
      'CONVERSATION_RESEARCH_RECOMMEND',
    );
  }
  return capability(RESEARCH_CURRENT, { query: researchQuery(state, text, discourse) }, 'CONVERSATION_RESEARCH');
}

function usableChoiceOptions(state: ConversationState, text = ''): OfferedOption[] {
  const research = extractComparisonOptions(state.lastResearchQuery || state.lastOwnerIntent);
  const askingResearch = state.activeTopic === 'research'
    || state.lastDiscourse === 'RESEARCH'
    || /แนะนำ|เทียบ|framer|gsap|library|animation/iu.test(text);
  if (askingResearch && research.length) return research;
  const options = state.offeredOptions.filter(item => !looksLikeInventoryOption(item.label));
  if (options.length) return options;
  return research;
}

function looksLikeInventoryOption(label: string): boolean {
  return /\([a-z0-9-]+\)(?:\s*·\s*active)?$/iu.test(label.trim()) || / · active$/iu.test(label);
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
