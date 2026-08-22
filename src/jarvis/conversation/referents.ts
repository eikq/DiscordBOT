import type { ConversationState, ProjectRecord, ReferentSlot, ResolvedReferent } from './types';

export function activeProject(state: ConversationState | null | undefined): ProjectRecord | undefined {
  if (!state?.activeProjectSlug) return state?.projects[0];
  return state.projects.find(item => item.slug === state.activeProjectSlug) || state.projects[0];
}

export function projectByOrdinal(state: ConversationState, ordinal: number): ProjectRecord | undefined {
  const index = ordinal - 1;
  if (index < 0 || index >= state.projects.length) return undefined;
  return state.projects[index];
}

export function resolveReferent(
  slot: ReferentSlot | 'ACTIVE_PROJECT' | 'ACTIVE_PLAN' | 'NONE',
  state: ConversationState,
): ResolvedReferent | { ambiguous: string[]; message: string } | null {
  if (slot === 'NONE') return null;
  if (slot === 'ACTIVE_PLAN' || slot === 'this_plan') {
    const planId = state.activePlanId || state.pendingPlanReview?.planId;
    if (!planId) return null;
    return { slot: 'this_plan', value: planId, source: 'plan', project: activeProject(state) };
  }
  if (slot === 'this_preview') {
    const preview = state.activePreview;
    if (!preview?.url) return null;
    return {
      slot: 'this_preview',
      value: preview.url,
      source: 'preview',
      project: state.projects.find(item => item.slug === preview.slug) || activeProject(state),
    };
  }
  if (slot === 'this_error') {
    if (!state.lastError) return null;
    return { slot: 'this_error', value: state.lastError.summary, source: 'active' };
  }
  if (slot === 'this_result') {
    const op = state.recentVerification || state.recentOperation;
    if (!op) return null;
    return { slot: 'this_result', value: op.summary || op.kind, source: 'active', project: activeProject(state) };
  }
  if (slot === 'previous_option' || slot === 'current_option') {
    const option = slot === 'current_option' ? state.selectedOption : state.offeredOptions[0];
    if (!option) return null;
    return { slot, value: option.label, source: 'ordinal' };
  }
  if (slot === 'this_file') {
    const file = state.referents.this_file || state.activeArtifactRefs[0];
    if (!file) return null;
    return { slot: 'this_file', value: file, source: 'active', project: activeProject(state) };
  }

  const project = activeProject(state);
  if (!project) {
    if (state.projects.length > 1) {
      return {
        ambiguous: state.projects.map(item => item.label || item.slug),
        message: 'หมายถึงโปรเจกต์ไหนครับ?',
      };
    }
    return null;
  }
  return {
    slot: slot === 'ACTIVE_PROJECT' ? 'this_project' : slot,
    value: project.slug,
    project,
    source: 'active',
  };
}

export function resolvePronounProject(state: ConversationState): ResolvedReferent | { ambiguous: string[]; message: string } | null {
  return resolveReferent('this_project', state);
}

export function uniqueSlugOrClarify(state: ConversationState): { slug: string; project: ProjectRecord } | { message: string } {
  const project = activeProject(state);
  if (project?.slug) return { slug: project.slug, project };
  if (state.projects.length === 1 && state.projects[0]?.slug) {
    return { slug: state.projects[0].slug, project: state.projects[0] };
  }
  if (state.projects.length > 1) {
    return { message: `หมายถึง ${state.projects.map(item => item.label || item.slug).join(' หรือ ')} ครับ?` };
  }
  return { message: 'ตอนนี้ยังไม่มีโปรเจกต์ที่คุยค้างไว้ บอกชื่อโปรเจกต์หรือให้ผมวางแผนก่อนได้ครับ' };
}

export function mentionedProject(state: ConversationState | null | undefined, text: string): ProjectRecord | undefined {
  if (!state?.projects.length) return undefined;
  const lower = text.toLocaleLowerCase();
  const identity = state.projects.filter(item => (
    (item.slug && lower.includes(item.slug.toLocaleLowerCase()))
    || (item.label && lower.includes(item.label.toLocaleLowerCase()))
  ));
  if (identity.length === 1) return identity[0];
  if (/portfolio/iu.test(text)) {
    const matches = (identity.length ? identity : state.projects)
      .filter(item => /portfolio/iu.test(`${item.slug} ${item.label}`));
    if (matches.length === 1) return matches[0];
    const stacked = [...(state.topicStack || [])].reverse().find(frame => (
      matches.some(item => item.slug === frame.projectSlug)
    ));
    return matches.find(item => item.slug === stacked?.projectSlug)
      || matches.find(item => item.slug === state.activeProjectSlug)
      || matches.find(item => item.slug === 'portfolio')
      || matches[matches.length - 1]
      || matches[0];
  }
  if (/todo/iu.test(text)) {
    return identity.find(item => /todo/iu.test(`${item.slug} ${item.label}`))
      || state.projects.find(item => item.slug === state.activeProjectSlug && /todo/iu.test(`${item.slug} ${item.label}`))
      || state.projects.find(item => /todo/iu.test(`${item.slug} ${item.label}`));
  }
  return identity[0];
}

export function restoreProject(state: ConversationState, text: string): ProjectRecord | undefined {
  const mentioned = mentionedProject(state, text);
  if (mentioned) return mentioned;
  if (/อันแรก|the first/iu.test(text) && state.projects.length > 1) {
    const previous = [...state.topicStack].reverse().find(frame => (
      frame.projectSlug && frame.projectSlug !== state.activeProjectSlug
    ));
    return state.projects.find(item => item.slug === previous?.projectSlug)
      || state.projects.find(item => /portfolio/iu.test(`${item.slug} ${item.label}`))
      || state.projects.find(item => item.kind === 'website' && item.slug !== state.activeProjectSlug)
      || state.projects.find(item => item.slug !== state.activeProjectSlug)
      || state.projects[0];
  }
  if (/(?:เว็บ|site|website)/iu.test(text) && !/todo/iu.test(text)) {
    if (/portfolio/iu.test(`${state.activeProjectSlug || ''} ${activeProject(state)?.label || ''}`)) {
      return activeProject(state);
    }
    const stacked = [...state.topicStack].reverse().find(frame => (
      frame.projectSlug && frame.projectSlug !== state.activeProjectSlug
    ));
    return state.projects.find(item => /portfolio/iu.test(`${item.slug} ${item.label}`))
      || state.projects.find(item => item.slug === stacked?.projectSlug)
      || state.projects.find(item => item.kind === 'website' && !/todo/iu.test(`${item.slug} ${item.label}`))
      || activeProject(state)
      || state.projects.find(item => item.kind === 'website');
  }
  return state.projects.find(item => item.slug === state.activeProjectSlug) || state.projects[0];
}
