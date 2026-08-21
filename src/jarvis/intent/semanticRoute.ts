import {
  DESKTOP_FOCUS_WINDOW,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_PLACE_WINDOW,
} from '../capabilities/actions/constants';
import { RESEARCH_CURRENT } from '../research/constants';
import { resolveResource } from '../resources/resolver';
import type { OwnerAliasRecord } from '../memory/ownerSemantics';
import { resolveDisplayAlias } from '../memory/ownerSemantics';
import { interpretSemanticIntent, type SemanticIntent } from './semanticIntent';
import { catalogHas } from './catalog';
import { classifyActionability } from './classify';
import type { CompactCapability, IntentResolution, InteractionContext } from './types';

export function routeSemanticIntent(
  text: string,
  options: {
    catalog: CompactCapability[];
    context?: InteractionContext | null;
    aliases?: OwnerAliasRecord[];
    applicationIds?: string[];
    projectIds?: string[];
  },
): IntentResolution | null {
  const semantic = interpretSemanticIntent(text, { context: options.context });
  return resolutionFromSemantic(semantic, text, options);
}

export function resolutionFromSemantic(
  semantic: SemanticIntent,
  text: string,
  options: {
    catalog: CompactCapability[];
    context?: InteractionContext | null;
    aliases?: OwnerAliasRecord[];
    applicationIds?: string[];
    projectIds?: string[];
  },
): IntentResolution | null {
  const actionClass = classifyActionability(text);
  if (semantic.action === 'CLICK' || semantic.action === 'TYPE' || semantic.action === 'SUBMIT') {
    return {
      kind: 'UNSUPPORTED',
      confidence: 'HIGH',
      reasonCode: 'GAP_DESKTOP_CLICK',
      userMessage: 'I understand what you want. I can open an allowlisted site, but clicking or typing inside a page requires Desktop CLICK/TYPE/SUBMIT, which is not enabled yet.',
      consumed: true,
      source: 'heuristic',
      actionClass: 'ACTIONABLE',
    };
  }

  if (semantic.action === 'TEACH_ALIAS' || semantic.action === 'FORGET_ALIAS' || semantic.action === 'ASK_MEMORY' || semantic.action === 'REMEMBER_PREFERENCE') {
    return {
      kind: 'CONVERSATION',
      confidence: 'HIGH',
      reasonCode: semantic.action,
      userMessage: semantic.action === 'ASK_MEMORY' ? undefined : 'I’ll update owner memory for that.',
      arguments: {
        aliasPhrase: semantic.aliasPhrase,
        target: semantic.target,
        entity: semantic.entity,
      },
      consumed: true,
      source: 'heuristic',
      actionClass: 'CONVERSATION',
    };
  }

  const display = applyAliasDisplay(semantic, options.aliases);
  const context = options.context;

  if (semantic.action === 'MOVE_BACK') {
    const resource = context?.lastOpenedResource;
    const previous = context?.previousDisplay;
    if (!resource || !previous) {
      return clarify('Which window should I move back, and to which screen?', 'AMBIGUOUS_REFERENT', actionClass);
    }
    return placeOrOpen(resource, previous, options.catalog, actionClass, 'REFERENT_BACK');
  }

  if (semantic.action === 'PLACE' && (semantic.references.includes('it') || semantic.references.includes('that'))) {
    const resource = context?.lastOpenedResource;
    if (!resource) return clarify('Which window do you mean by “it”?', 'AMBIGUOUS_REFERENT', actionClass);
    if (!display) return clarify('Which display should I move it to?', 'AMBIGUOUS_DISPLAY', actionClass);
    return placeOrOpen(resource, display, options.catalog, actionClass, 'REFERENT_IT');
  }

  if (semantic.references.includes('official') && context?.recentResearchQuery && catalogHas(options.catalog, RESEARCH_CURRENT)) {
    return capability(RESEARCH_CURRENT, {
      query: context.recentResearchQuery,
      reuseLast: true,
      officialOnly: true,
    }, 'RESEARCH_CONTEXT', actionClass);
  }

  if (semantic.action === 'RESEARCH' || semantic.action === 'RESEARCH_FOLLOWUP') {
    if (semantic.action === 'RESEARCH_FOLLOWUP' && context?.recentResearchQuery && catalogHas(options.catalog, RESEARCH_CURRENT)) {
      return capability(RESEARCH_CURRENT, {
        query: context.recentResearchQuery,
        reuseLast: true,
        officialOnly: semantic.modifiers.includes('official-only') || semantic.references.includes('official'),
      }, 'RESEARCH_CONTEXT', actionClass);
    }
    if (semantic.entity && catalogHas(options.catalog, RESEARCH_CURRENT)) {
      return capability(RESEARCH_CURRENT, { query: semantic.entity, officialOnly: semantic.modifiers.includes('official-only') }, 'SEMANTIC_RESEARCH', actionClass);
    }
  }

  if (semantic.action !== 'OPEN' && semantic.action !== 'PLACE' && semantic.action !== 'FOCUS') return null;

  const resolved = resolveResource(semantic, {
    applicationIds: options.applicationIds,
    projectIds: options.projectIds,
  });
  if (resolved.ok === false) {
    if (resolved.reasonCode === 'DID_YOU_MEAN') {
      return clarify(resolved.message, 'DID_YOU_MEAN', actionClass);
    }
    if (resolved.reasonCode === 'OFFICIAL_URL_UNKNOWN') {
      return {
        kind: 'CLARIFICATION',
        confidence: 'HIGH',
        reasonCode: 'OFFICIAL_URL_UNKNOWN',
        userMessage: resolved.message,
        consumed: true,
        source: 'heuristic',
        actionClass,
      };
    }
    return null;
  }

  if (resolved.kind === 'project' && catalogHas(options.catalog, DESKTOP_OPEN_PROJECT)) {
    return capability(DESKTOP_OPEN_PROJECT, { projectId: resolved.projectId }, 'SEMANTIC_PROJECT', actionClass);
  }
  if (resolved.kind === 'application') {
    if (semantic.action === 'FOCUS' && catalogHas(options.catalog, DESKTOP_FOCUS_WINDOW)) {
      return capability(DESKTOP_FOCUS_WINDOW, { applicationId: resolved.applicationId }, 'SEMANTIC_FOCUS', actionClass);
    }
    if ((semantic.action === 'PLACE' || display) && catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'application',
        applicationId: resolved.applicationId,
        label: resolved.label,
        ...(display ? { display } : {}),
      }, 'SEMANTIC_SCOPED_APP', actionClass);
    }
    if (catalogHas(options.catalog, DESKTOP_OPEN_APPLICATION)) {
      return capability(DESKTOP_OPEN_APPLICATION, { applicationId: resolved.applicationId }, 'SEMANTIC_APP', actionClass);
    }
  }
  if (resolved.kind === 'website') {
    if (display && catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'url',
        url: resolved.url,
        label: resolved.label,
        display,
      }, 'SEMANTIC_SCOPED_WEB', actionClass);
    }
    if (catalogHas(options.catalog, DESKTOP_OPEN_TRUSTED_URL)) {
      return capability(DESKTOP_OPEN_TRUSTED_URL, { url: resolved.url }, 'SEMANTIC_WEB', actionClass);
    }
  }
  return null;
}

function applyAliasDisplay(semantic: SemanticIntent, aliases: OwnerAliasRecord[] | undefined) {
  if (!semantic.display) return semantic.display;
  const target = resolveDisplayAlias(aliases ?? [], semantic.display.raw);
  if (target === 'display.internal') return { ...semantic.display, role: 'internal' as const };
  if (target) return { ...semantic.display, name: target };
  return semantic.display;
}

function placeOrOpen(
  resource: NonNullable<InteractionContext['lastOpenedResource']>,
  display: NonNullable<InteractionContext['lastDisplay']>,
  catalog: CompactCapability[],
  actionClass: IntentResolution['actionClass'],
  reasonCode: string,
): IntentResolution {
  if (resource.openState === 'intended') {
    return clarify(
      `I understand you mean ${resource.label}. I have not opened it yet, so I cannot move it. Approve the open first, or ask me to open it on that screen.`,
      'REFERENT_NOT_OPEN',
      actionClass,
    );
  }
  if (!catalogHas(catalog, DESKTOP_PLACE_WINDOW)) {
    return clarify('I understand the referent, but I cannot place that window with the current scoped desktop capabilities.', 'GAP_WINDOW_PLACE', actionClass);
  }
  return capability(DESKTOP_PLACE_WINDOW, {
    kind: resource.kind,
    ...(resource.applicationId ? { applicationId: resource.applicationId } : {}),
    ...(resource.url ? { url: resource.url } : {}),
    label: resource.label,
    display,
  }, reasonCode, actionClass);
}

function capability(
  capabilityId: string,
  args: Record<string, unknown>,
  reasonCode: string,
  actionClass: IntentResolution['actionClass'],
): IntentResolution {
  return {
    kind: 'CAPABILITY',
    capabilityId,
    arguments: args,
    confidence: 'HIGH',
    reasonCode,
    consumed: true,
    source: 'heuristic',
    actionClass: actionClass === 'CONVERSATION' ? 'ACTIONABLE' : actionClass,
  };
}

function clarify(question: string, reasonCode: string, actionClass: IntentResolution['actionClass']): IntentResolution {
  return {
    kind: 'CLARIFICATION',
    confidence: 'HIGH',
    reasonCode,
    userMessage: question,
    consumed: true,
    source: 'heuristic',
    actionClass,
  };
}
