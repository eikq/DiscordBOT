import type { IntentResolution } from '../intent/types';
import type { ConversationState, DiscourseAct, DiscourseInterpretation, ProjectRecord, QueueItem } from './types';
import { activeProject, restoreProject } from './referents';
import { optionsFromReply, isOperationalNoise, isPermissionPrompt, extractComparisonOptions, pickRecommendedOption } from './view';
import { interpretDiscourse } from './discourse';

export function applyTurnToConversation(
  state: ConversationState,
  input: {
    ownerText: string;
    discourse: DiscourseInterpretation;
    resolution: IntentResolution;
    replyText?: string;
    preview?: ConversationState['activePreview'];
    operation?: ConversationState['recentOperation'];
    pendingPermission?: ConversationState['pendingPermission'] | null;
    pendingPlanReview?: ConversationState['pendingPlanReview'] | null;
    project?: Partial<ProjectRecord> & { slug: string };
  },
): ConversationState {
  const next: ConversationState = structuredClone(state);
  next.lastOwnerIntent = input.ownerText;
  next.lastDiscourse = input.discourse.act;
  next.lastJarvisAction = input.resolution.capabilityId || input.resolution.reasonCode;
  if (input.pendingPermission === null) next.pendingPermission = undefined;
  else if (input.pendingPermission) next.pendingPermission = input.pendingPermission;
  if (input.pendingPlanReview === null) next.pendingPlanReview = undefined;
  else if (input.pendingPlanReview) next.pendingPlanReview = input.pendingPlanReview;

  if (input.discourse.act === 'PAUSE') {
    next.paused = true;
    next.queuePaused = true;
  }
  if (input.discourse.act === 'CANCEL') {
    next.pendingChange = undefined;
    next.pendingConditional = undefined;
    next.selectedOption = undefined;
    next.paused = false;
  }
  if (input.discourse.act === 'CORRECT' && input.discourse.change) {
    next.pendingChange = [next.pendingChange, input.discourse.change].filter(Boolean).join('\n').slice(0, 400);
    next.constraints = next.constraints.filter(item => !constraintRetractedBy(item, input.ownerText));
  }
  if (input.discourse.act === 'RESEARCH') {
    if (next.activeTopic === 'software') {
      next.topicStack = [
        ...next.topicStack,
        {
          topic: next.activeTopic,
          projectSlug: next.activeProjectSlug,
          goalId: next.activeGoalId,
          planId: next.activePlanId,
          label: activeProject(next)?.label,
        },
      ].slice(-8);
    }
    next.activeTopic = 'research';
    const query = typeof input.resolution.arguments?.query === 'string'
      ? String(input.resolution.arguments.query)
      : '';
    if (query && !input.discourse.recommend) {
      if (!next.lastResearchQuery || extractComparisonOptions(query).length >= 2) {
        next.lastResearchQuery = query;
      }
      const extracted = extractComparisonOptions(query);
      if (extracted.length && !next.offeredOptions.length) next.offeredOptions = extracted;
    }
    if (input.discourse.recommend || input.resolution.reasonCode === 'RESEARCH_RECOMMEND') {
      const options = next.offeredOptions.length
        ? next.offeredOptions
        : extractComparisonOptions(next.lastResearchQuery || next.lastOwnerIntent);
      const picked = pickRecommendedOption(options, `${next.lastOwnerIntent || ''} ${next.pendingChange || ''} ${input.ownerText}`);
      if (picked) next.selectedOption = picked;
    }
  }
  if (input.discourse.act === 'CONTINUE' || input.discourse.act === 'EXECUTE_NOW' || input.discourse.act === 'RESTORE_TOPIC') {
    next.paused = false;
    next.queuePaused = false;
  }
  if (input.discourse.act === 'SWITCH_TOPIC') {
    next.topicStack = [
      ...next.topicStack,
      {
        topic: next.activeTopic,
        projectSlug: next.activeProjectSlug,
        goalId: next.activeGoalId,
        planId: next.activePlanId,
        label: activeProject(next)?.label,
      },
    ].slice(-8);
    next.activeTopic = 'chat';
  }
  if (input.discourse.act === 'RESTORE_TOPIC') {
    const project = restoreProject(next, input.ownerText);
    if (project) {
      next.activeTopic = 'software';
      next.activeProjectSlug = project.slug;
      next.activeGoalId = project.goalId || next.activeGoalId;
      next.activePlanId = project.planId || next.activePlanId;
      next.activeWorkspace = project.workspace || `data/jarvis/builds/${project.slug}`;
      next.referents.this_project = project.slug;
      next.referents.this_site = project.slug;
      next.referents.this_app = project.slug;
    }
  }
  if (input.discourse.act === 'SELECT_ORDINAL' && input.discourse.ordinal) {
    const option = next.offeredOptions.find(item => item.index === input.discourse.ordinal)
      || next.offeredOptions[(input.discourse.ordinal || 1) - 1];
    if (option) {
      next.selectedOption = option;
      next.pendingChange = option.payload || option.label;
    }
    if (!next.offeredOptions.length) {
      const project = restoreProject(next, input.ownerText);
      if (project && /อันแรก|portfolio|เว็บ/iu.test(input.ownerText)) {
        next.activeProjectSlug = project.slug;
        next.activePlanId = project.planId;
        next.activeGoalId = project.goalId;
      }
    }
  }
  if (input.discourse.act === 'NEGATE' && input.discourse.constraint) {
    next.constraints = unique([...next.constraints, input.discourse.constraint.slice(0, 160)]);
  }
  if (input.discourse.constraint && input.discourse.act === 'MODIFY_PROJECT') {
    next.constraints = unique([...next.constraints, input.discourse.constraint.slice(0, 160)]);
  }
  if (input.discourse.change && (input.discourse.act === 'MODIFY_PROJECT' || input.discourse.act === 'ACCUMULATE_REQUIREMENTS')) {
    next.pendingChange = input.discourse.change;
  }
  if (input.discourse.act === 'CONDITIONAL' && input.discourse.ifKind && input.discourse.thenAct) {
    const stopOnFail = input.discourse.change === 'STOP_ON_FAIL' || input.discourse.thenAct === 'PAUSE';
    next.pendingConditional = {
      ifKind: input.discourse.ifKind,
      thenAct: input.discourse.thenAct === 'PAUSE' ? (next.pendingConditional?.thenAct || 'PREVIEW') : input.discourse.thenAct,
      thenActs: (input.discourse.thenActs?.filter(item => item !== 'PAUSE').length
        ? input.discourse.thenActs.filter(item => item !== 'PAUSE')
        : next.pendingConditional?.thenActs)
        || [input.discourse.thenAct],
      stopOnFail: stopOnFail || next.pendingConditional?.stopOnFail,
    };
  }
  if (input.discourse.queueItems?.length) {
    next.queue = input.discourse.queueItems.map((text, index) => ({
      id: `q_${next.revision}_${index}`,
      text,
      act: queueItemAct(text, next),
      status: 'pending' as const,
    }));
    next.activeTopic = 'queue';
  }
  if (input.discourse.queueOp) {
    next.queue = applyQueueOp(next.queue, input.discourse.queueOp, next);
    next.activeTopic = 'queue';
  }
  if (
    input.resolution.kind === 'CAPABILITY'
    && (input.discourse.act === 'CONTINUE' || input.discourse.act === 'EXECUTE_NOW' || input.discourse.queueOp?.kind === 'start')
    && next.queue.some(item => item.status === 'pending' || item.status === 'running')
  ) {
    const index = next.queue.findIndex(item => item.status === 'pending' || item.status === 'running');
    if (index >= 0) next.queue[index] = { ...next.queue[index]!, status: 'running' };
  }
  if (input.project?.slug) {
    const existing = next.projects.findIndex(item => item.slug === input.project!.slug);
    const record: ProjectRecord = {
      ...(existing >= 0 ? next.projects[existing]! : { slug: input.project.slug, label: input.project.label || input.project.slug, kind: input.project.kind || 'website' }),
      ...input.project,
    };
    if (existing >= 0) next.projects[existing] = record;
    else next.projects.push(record);
    const topicLocked = input.discourse.act === 'RESTORE_TOPIC'
      && next.activeProjectSlug
      && next.activeProjectSlug !== record.slug;
    if (input.discourse.act === 'NEW_PROJECT' && next.activeProjectSlug && next.activeProjectSlug !== record.slug) {
      next.topicStack.push({
        topic: 'software',
        projectSlug: next.activeProjectSlug,
        goalId: next.activeGoalId,
        planId: next.activePlanId,
        label: activeProject(next)?.label,
      });
    }
    if (!topicLocked) {
      next.activeProjectSlug = record.slug;
      next.activeGoalId = record.goalId || next.activeGoalId;
      next.activePlanId = record.planId || next.activePlanId;
      next.activeWorkspace = record.workspace || `data/jarvis/builds/${record.slug}`;
      if (!['RESEARCH', 'SWITCH_TOPIC', 'STATUS_QUERY', 'MEMORY_QUERY', 'MEMORY_STORE'].includes(input.discourse.act)) {
        next.activeTopic = 'software';
      }
      next.referents.this_project = record.slug;
      next.referents.this_site = record.slug;
      next.referents.this_app = record.slug;
    }
  }
  const slug = typeof input.resolution.arguments?.slug === 'string' ? String(input.resolution.arguments.slug) : undefined;
  const planId = typeof input.resolution.arguments?.planId === 'string' ? String(input.resolution.arguments.planId) : undefined;
  const relativePath = typeof input.resolution.arguments?.relativePath === 'string'
    ? String(input.resolution.arguments.relativePath)
    : undefined;
  if (slug) next.activeProjectSlug = slug;
  if (planId) next.activePlanId = planId;
  if (relativePath) next.referents.this_file = relativePath;
  if (input.preview) {
    next.activePreview = input.preview;
    next.referents.this_preview = input.preview.url;
  }
  if (input.operation && !isOperationalNoise(input.operation.summary)) {
    next.recentOperation = input.operation;
    if (input.operation.kind === 'test' || input.operation.kind === 'build') {
      next.recentVerification = input.operation;
    }
    if (input.operation.ok === false && !isPermissionPrompt(input.operation.summary)) {
      next.lastError = { summary: input.operation.summary || input.operation.kind, at: input.operation.at };
      next.referents.this_error = next.lastError.summary;
    }
    const running = next.queue.findIndex(item => item.status === 'running');
    if (running >= 0) {
      next.queue[running] = {
        ...next.queue[running]!,
        status: input.operation.ok === false ? 'failed' : 'done',
      };
    }
  }
  if (input.replyText) {
    const offered = optionsFromReply(input.replyText);
    if (offered.length) next.offeredOptions = offered;
  }
  if (input.discourse.act === 'ACCUMULATE_REQUIREMENTS' && /สี|palette|โทน|animation เบา|ไม่รก/iu.test(input.ownerText)) {
    next.remembered = unique([...next.remembered, summarizeMemory(input.ownerText)]).slice(-12);
  }
  if (input.discourse.act === 'MEMORY_STORE' && input.discourse.change) {
    next.remembered = unique([...next.remembered, summarizeMemory(input.discourse.change)]).slice(-12);
  }
  return next;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}

function summarizeMemory(text: string): string {
  return text.replace(/จำไว้ว่า|remember that|งั้นเก็บไว้/giu, '').trim().slice(0, 140);
}

function queueItemAct(text: string, state: ConversationState): DiscourseAct | undefined {
  const act = interpretDiscourse(text, { ...state, queue: [] }).act;
  return act === 'UNKNOWN' ? undefined : act;
}

function applyQueueOp(
  queue: QueueItem[],
  op: NonNullable<DiscourseInterpretation['queueOp']>,
  state: ConversationState,
): QueueItem[] {
  const next = queue.map(item => ({ ...item }));
  const findIndex = (needle?: string) => next.findIndex(item => (
    needle && item.text.toLocaleLowerCase().includes(needle.toLocaleLowerCase())
  ));
  if (op.kind === 'swap' && op.a && op.b) {
    const left = next[op.a - 1];
    const right = next[op.b - 1];
    if (left && right) {
      next[op.a - 1] = right;
      next[op.b - 1] = left;
    }
    return next;
  }
  if (op.kind === 'remove' && op.text) {
    const index = findIndex(op.text);
    if (index >= 0 && next[index]?.status === 'pending') next.splice(index, 1);
    return next;
  }
  if (op.kind === 'skip' && op.text) {
    const index = findIndex(op.text);
    if (index >= 0 && next[index]?.status === 'pending') next[index] = { ...next[index]!, status: 'skipped' };
    return next;
  }
  if (op.kind === 'append' && op.text) {
    next.push({
      id: `q_append_${next.length}`,
      text: op.text,
      status: 'pending',
      act: queueItemAct(op.text, state),
    });
    return next;
  }
  if (op.kind === 'move') {
    const afterKey = op.after?.trim();
    const beforeKey = op.before?.trim();
    if (afterKey && findIndex(afterKey) < 0) {
      next.push({ id: `q_anchor_${next.length}`, text: afterKey, status: 'pending', act: queueItemAct(afterKey, state) });
    }
    if (beforeKey && findIndex(beforeKey) < 0) {
      next.push({ id: `q_anchor_${next.length}`, text: beforeKey, status: 'pending', act: queueItemAct(beforeKey, state) });
    }
    let from = op.text ? findIndex(op.text) : -1;
    if (from < 0) {
      from = [...next.keys()].reverse().find(index => {
        const item = next[index]!;
        if (item.status === 'running') return false;
        const hay = item.text.toLocaleLowerCase();
        if (afterKey && hay.includes(afterKey.toLocaleLowerCase())) return false;
        if (beforeKey && hay.includes(beforeKey.toLocaleLowerCase())) return false;
        return item.status === 'pending';
      }) ?? -1;
    }
    if (from >= 0) {
      const [item] = next.splice(from, 1);
      const after = afterKey ? findIndex(afterKey) : -1;
      const before = beforeKey ? findIndex(beforeKey) : -1;
      let dest = before >= 0 ? before : next.length;
      if (after >= 0) dest = Math.max(dest, after + 1);
      if (item) next.splice(Math.min(dest, next.length), 0, item);
    }
    return next;
  }
  if (op.kind === 'insert' && op.text) {
    const before = op.before ? findIndex(op.before) : next.length;
    next.splice(before < 0 ? next.length : before, 0, {
      id: `q_insert_${next.length}`,
      text: op.text,
      status: 'pending',
      act: queueItemAct(op.text, state),
    });
    return next;
  }
  return next;
}

function constraintRetractedBy(constraint: string, correction: string): boolean {
  if (!/เปลี่ยนใจ|actually |เอา.+ด้วย/iu.test(correction)) return false;
  const tokens = ['contact', 'navbar', 'testimonial', 'สี', 'color'];
  return tokens.some(token => new RegExp(token, 'iu').test(constraint) && new RegExp(token, 'iu').test(correction));
}
