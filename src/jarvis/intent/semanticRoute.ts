import {
  DESKTOP_FOCUS_WINDOW,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_PLACE_WINDOW,
} from '../capabilities/actions/constants';
import { SOFTWARE_APPLY_BUILD } from '../build/constants';
import { RESEARCH_CURRENT } from '../research/constants';
import { resolveResource } from '../resources/resolver';
import { resolveRegisteredWorkspace } from '../resources/workspaceAuthority';
import { isHighRiskReferentText, pickSourceByMention, referentStillValid, resolveThatSource } from '../memory/activeContext';
import { speakInLanguage } from './conversationLanguage';
import type { OwnerAliasRecord } from '../memory/ownerSemantics';
import { resolveDisplayAlias } from '../memory/ownerSemantics';
import { interpretSemanticIntent, type SemanticIntent } from './semanticIntent';
import { catalogHas } from './catalog';
import { classifyActionability } from './classify';
import type { CompactCapability, IntentResolution, InteractionContext } from './types';
import { loadDesktopAllowlists } from '../capabilities/actions/allowlists';
import { loadWorkspaceRegistry } from '../workspace/registry';

const OPEN_VERB_HINT = /\b(open|launch|start|put|show)\b|เปิด/iu;

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
  if (semantic.action === 'BUILD_WEBSITE' || semantic.action === 'BUILD_SOFTWARE' || semantic.action === 'APPROVE_PLAN') {
    return null;
  }
  if (semantic.action === 'APPLY_BUILD' && catalogHas(options.catalog, SOFTWARE_APPLY_BUILD)) {
    return capability(SOFTWARE_APPLY_BUILD, { brief: text }, 'SEMANTIC_APPLY_BUILD', actionClass);
  }
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

  if (
    semantic.action === 'TEACH_ALIAS'
    || semantic.action === 'FORGET_ALIAS'
    || semantic.action === 'ASK_MEMORY'
    || semantic.action === 'REMEMBER_PREFERENCE'
    || semantic.action === 'LIST_DISPLAYS'
    || semantic.action === 'INSPECT_CONTAINMENT'
    || semantic.action === 'CLEAR_CONTAINMENT'
  ) {
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

  const context = options.context;
  const display = applyAliasDisplay(semantic, options.aliases, context);
  const now = Date.now();
  const highRisk = isHighRiskReferentText(text);
  if (highRisk && !referentStillValid(context, now, { highRisk: true })) {
    return clarify('That reference is too old or uncertain for a destructive action. Which exact thing do you mean?', 'REFERENT_EXPIRED', actionClass);
  }

  if (semantic.action === 'MOVE_BACK') {
    const resource = context?.lastOpenedResource;
    const previous = context?.previousDisplay;
    if (!resource || !previous || !referentStillValid(context, now)) {
      return clarify('Which window should I move back, and to which screen?', 'AMBIGUOUS_REFERENT', actionClass);
    }
    return placeOrOpen(resource, previous, options.catalog, actionClass, 'REFERENT_BACK', {
      contextSource: 'working-memory',
      resolvedReferent: resource.windowHandle || resource.label,
    });
  }

  if (semantic.action === 'FOCUS') {
    const resource = context?.lastOpenedResource;
    if (resource?.windowHandle && (
      semantic.references.includes('it')
      || semantic.references.includes('that')
      || !semantic.entity
      || (semantic.entity && (
        resource.label.toLocaleLowerCase().includes(semantic.entity.toLocaleLowerCase())
        || semantic.entity.toLocaleLowerCase().includes(resource.label.toLocaleLowerCase())
      ))
      || (resource.url && semantic.entity && resource.url.toLocaleLowerCase().includes(semantic.entity.toLocaleLowerCase()))
    )) {
      return capability(DESKTOP_FOCUS_WINDOW, {
        ...(resource.applicationId ? { applicationId: resource.applicationId } : {}),
        ...(resource.url ? { url: resource.url } : {}),
        ...(resource.managedWindowId ? { managedWindowId: resource.managedWindowId } : {}),
        windowHandle: resource.windowHandle,
        label: resource.label,
      }, 'REFERENT_FOCUS', actionClass, {
        contextSource: 'working-memory',
        resolvedReferent: resource.windowHandle,
      });
    }
  }

  if (semantic.action === 'PLACE' && (semantic.references.includes('it') || semantic.references.includes('that'))) {
    const resource = context?.lastOpenedResource;
    if (!resource || !referentStillValid(context, now)) return clarify('Which window do you mean by “it”?', 'AMBIGUOUS_REFERENT', actionClass);
    if (!display) return clarify('Which display should I move it to?', 'AMBIGUOUS_DISPLAY', actionClass);
    return placeOrOpen(resource, display, options.catalog, actionClass, 'REFERENT_IT', {
      contextSource: 'working-memory',
      resolvedReferent: resource.windowHandle || resource.label,
    });
  }

  if (semantic.objectType === 'SOURCE' || (semantic.references.includes('that') && /source|แหล่ง/iu.test(text))) {
    if (semantic.action === 'RESEARCH_FOLLOWUP' && !OPEN_VERB_HINT.test(text)) {
      const official = resolveThatSource(context?.lastResearchSources, text);
      if (official.ok === false) return clarify(official.message, official.reasonCode, actionClass);
      return {
        kind: 'CONVERSATION',
        confidence: 'HIGH',
        reasonCode: 'RESEARCH_OFFICIAL_SOURCE',
        userMessage: speakInLanguage(context?.conversationLanguage === 'th' ? 'th' : 'en', {
          en: `The official source is ${official.source.label} (${official.source.url}).`,
          th: `แหล่งทางการคือ ${official.source.label} (${official.source.url}) ครับ`,
        }),
        arguments: { url: official.source.url, sourceId: official.source.sourceId },
        consumed: true,
        source: 'heuristic',
        actionClass: 'INFORMATION',
        contextEvidence: { contextSource: 'research-session', resolvedReferent: official.source.label },
      };
    }
    const picked = resolveThatSource(context?.lastResearchSources, text);
    if (picked.ok === false) return clarify(picked.message, picked.reasonCode, actionClass);
    if (catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'url',
        url: picked.source.url,
        label: picked.source.label,
        ...(display || context?.lastDisplay ? { display: display || context?.lastDisplay } : {}),
      }, 'RESEARCH_SOURCE_OPEN', actionClass, {
        contextSource: 'research-session',
        resolvedReferent: picked.source.label,
        resourceAuthority: 'research-session',
      });
    }
  }

  if (OPEN_VERB_HINT.test(text) && context?.lastResearchSources?.length && catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
    const mentioned = pickSourceByMention(context.lastResearchSources, text);
    if (mentioned) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'url',
        url: mentioned.url,
        label: mentioned.label,
        ...(display || context.lastDisplay ? { display: display || context.lastDisplay } : {}),
      }, 'RESEARCH_SOURCE_OPEN', actionClass, {
        contextSource: 'research-session',
        resolvedReferent: mentioned.label,
        resourceAuthority: 'research-session',
      });
    }
  }

  if (semantic.references.includes('official') && context?.recentResearchQuery && catalogHas(options.catalog, RESEARCH_CURRENT) && semantic.objectType !== 'SOURCE') {
    return capability(RESEARCH_CURRENT, {
      query: context.recentResearchQuery,
      reuseLast: true,
      officialOnly: true,
    }, 'RESEARCH_CONTEXT', actionClass, { contextSource: 'research-session' });
  }

  if (semantic.action === 'RESEARCH' || semantic.action === 'RESEARCH_FOLLOWUP') {
    if (semantic.action === 'RESEARCH_FOLLOWUP' && context?.recentResearchQuery && catalogHas(options.catalog, RESEARCH_CURRENT)) {
      return capability(RESEARCH_CURRENT, {
        query: context.recentResearchQuery,
        reuseLast: true,
        officialOnly: semantic.modifiers.includes('official-only') || semantic.references.includes('official'),
      }, 'RESEARCH_CONTEXT', actionClass, { contextSource: 'research-session' });
    }
    if (semantic.entity && catalogHas(options.catalog, RESEARCH_CURRENT)) {
      return capability(RESEARCH_CURRENT, { query: semantic.entity, officialOnly: semantic.modifiers.includes('official-only') }, 'SEMANTIC_RESEARCH', actionClass);
    }
  }

  if (semantic.objectType === 'PROJECT' && (semantic.action === 'OPEN' || /cursor|vscode/iu.test(text))) {
    const lists = loadDesktopAllowlists();
    const workspace = resolveRegisteredWorkspace(semantic.entity || context?.currentWorkspace || context?.recentWorkspaceId, {
      projects: lists.projects.map(item => ({ id: item.id, displayName: item.displayName, path: item.path, installed: item.installed })),
      workspaces: loadWorkspaceRegistry().list().map(item => ({ id: item.id, displayName: item.displayName, root: item.root })),
      currentWorkspaceId: context?.currentWorkspace || context?.recentWorkspaceId,
    });
    if (workspace.ok === false) return clarify(workspace.message, workspace.reasonCode, actionClass);
    const applicationId = /vscode/iu.test(text) ? 'vscode' : 'cursor';
    if (catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'application',
        applicationId,
        projectId: workspace.projectId,
        label: workspace.label,
      }, 'SEMANTIC_PROJECT_APP', actionClass, {
        contextSource: context?.currentWorkspace ? 'working-memory' : 'workspace-registry',
        resourceAuthority: workspace.evidence,
        resolvedReferent: workspace.label,
      });
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

  const thereDisplay = semantic.references.includes('there')
    ? display || context?.lastDisplay || context?.currentDisplay
    : display;

  if (resolved.kind === 'project' && catalogHas(options.catalog, DESKTOP_OPEN_PROJECT)) {
    return capability(DESKTOP_OPEN_PROJECT, { projectId: resolved.projectId }, 'SEMANTIC_PROJECT', actionClass, {
      resourceAuthority: 'project-allowlist',
    });
  }
  if (resolved.kind === 'application') {
    if (semantic.action === 'FOCUS' && catalogHas(options.catalog, DESKTOP_FOCUS_WINDOW)) {
      return capability(DESKTOP_FOCUS_WINDOW, { applicationId: resolved.applicationId }, 'SEMANTIC_FOCUS', actionClass);
    }
    if ((semantic.action === 'PLACE' || thereDisplay) && catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'application',
        applicationId: resolved.applicationId,
        label: resolved.label,
        ...(thereDisplay ? { display: thereDisplay } : {}),
      }, 'SEMANTIC_SCOPED_APP', actionClass);
    }
    if (catalogHas(options.catalog, DESKTOP_OPEN_APPLICATION)) {
      return capability(DESKTOP_OPEN_APPLICATION, { applicationId: resolved.applicationId }, 'SEMANTIC_APP', actionClass);
    }
  }
  if (resolved.kind === 'website') {
    if (semantic.action === 'FOCUS' && catalogHas(options.catalog, DESKTOP_FOCUS_WINDOW)) {
      return capability(DESKTOP_FOCUS_WINDOW, {
        url: resolved.url,
        label: resolved.label,
        ...(context?.lastOpenedResource?.url === resolved.url && context.lastOpenedResource.windowHandle
          ? { windowHandle: context.lastOpenedResource.windowHandle, managedWindowId: context.lastOpenedResource.managedWindowId }
          : {}),
      }, 'SEMANTIC_FOCUS', actionClass, {
        contextSource: 'working-memory',
        resolvedReferent: resolved.label,
      });
    }
    if (thereDisplay && catalogHas(options.catalog, DESKTOP_OPEN_SCOPED_RESOURCE)) {
      return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
        kind: 'url',
        url: resolved.url,
        label: resolved.label,
        display: thereDisplay,
      }, 'SEMANTIC_SCOPED_WEB', actionClass, {
        contextSource: semantic.references.includes('there') ? 'working-memory' : 'resource-catalog',
        resourceAuthority: 'resource-catalog',
        ...(thereDisplay && 'fingerprint' in thereDisplay && thereDisplay.fingerprint
          ? { aliasSource: 'owner-semantic-memory' }
          : {}),
      });
    }
    if (catalogHas(options.catalog, DESKTOP_OPEN_TRUSTED_URL)) {
      return capability(DESKTOP_OPEN_TRUSTED_URL, { url: resolved.url }, 'SEMANTIC_WEB', actionClass);
    }
  }
  return null;
}

export function applyOwnerDisplaySelector(
  selector: NonNullable<InteractionContext['lastDisplay']> | null | undefined,
  aliases: OwnerAliasRecord[] | undefined,
  phrase?: string,
): NonNullable<InteractionContext['lastDisplay']> | null | undefined {
  if (!selector) return selector;
  const target = resolveDisplayAlias(aliases ?? [], selector.raw)
    || resolveDisplayAlias(aliases ?? [], phrase);
  if (target === 'display.internal') return { ...selector, role: 'internal' };
  if (target?.startsWith('display.fp:') || target?.startsWith('{')) {
    return { raw: selector.raw, name: target, fingerprint: target };
  }
  if (target) return { ...selector, name: target };
  return selector;
}

function applyAliasDisplay(
  semantic: SemanticIntent,
  aliases: OwnerAliasRecord[] | undefined,
  context?: InteractionContext | null,
) {
  if (semantic.references.includes('there')) {
    return context?.lastDisplay || context?.currentDisplay || semantic.display || null;
  }
  return applyOwnerDisplaySelector(semantic.display, aliases, semantic.aliasPhrase);
}

function placeOrOpen(
  resource: NonNullable<InteractionContext['lastOpenedResource']>,
  display: NonNullable<InteractionContext['lastDisplay']>,
  catalog: CompactCapability[],
  actionClass: IntentResolution['actionClass'],
  reasonCode: string,
  evidence?: IntentResolution['contextEvidence'],
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
    ...(resource.windowHandle ? { windowHandle: resource.windowHandle } : {}),
    label: resource.label,
    display,
  }, reasonCode, actionClass, evidence);
}

function capability(
  capabilityId: string,
  args: Record<string, unknown>,
  reasonCode: string,
  actionClass: IntentResolution['actionClass'],
  evidence?: IntentResolution['contextEvidence'],
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
    ...(evidence ? { contextEvidence: evidence } : {}),
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
