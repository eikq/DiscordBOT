import { redactSecrets } from '../security/redaction';
import { CORE_IDENTITY } from '../evolution/identity';
import type { CapabilityHost, CapabilityDescriptor } from '../capabilities/types';
import { distributionForCapability } from '../capabilities/distribution';
import { buildGoalKnowledge, createDefaultGoalCatalog, type GoalCatalog } from '../goals';
import type { CapabilitySelfModel } from '../evolution/selfModel';
import type { ModelCertificationRegistry } from '../models/ModelCertificationRegistry';
import type { ModelProfileRegistry } from '../models/ModelProfileRegistry';
import type {
  DeclaredCapabilityEvidence,
  SelfKnowledgeCapability,
  SelfKnowledgeService,
  SelfKnowledgeSnapshot,
} from './types';

export type SelfKnowledgeOptions = {
  host?: CapabilityHost;
  selfModel?: CapabilitySelfModel;
  modelProfiles?: ModelProfileRegistry;
  modelCertifications?: ModelCertificationRegistry;
  modelProviderState?: ReadonlyMap<string, 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'>;
  services?: SelfKnowledgeService[];
  declarations?: DeclaredCapabilityEvidence[];
  goalCatalog?: GoalCatalog;
  now?: () => number;
};

export async function buildSelfKnowledgeSnapshot(options: SelfKnowledgeOptions): Promise<SelfKnowledgeSnapshot> {
  const now = options.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();
  const assessments = new Map((options.selfModel?.matrix() ?? []).map(item => [item.capability, item]));
  const registered = await Promise.all((options.host?.list() ?? []).map(async descriptor => {
    const availability = await safeAvailability(options.host!, descriptor.id);
    return capabilityFromDescriptor(descriptor, availability, checkedAt, assessments.get(descriptor.id));
  }));
  const known = new Set(registered.map(item => item.id));
  const declared = (options.declarations ?? [])
    .filter(item => !known.has(item.id))
    .map(item => capabilityFromDeclaration(item, checkedAt, assessments.get(item.id)));
  const capabilities = [...registered, ...declared].sort((a, b) => a.id.localeCompare(b.id));
  const models = (options.modelProfiles?.list() ?? []).map(profile => {
    const safeProfile = {
      ...profile,
      displayName: redactSecrets(profile.displayName),
      ...(profile.source ? { source: redactSecrets(profile.source) } : {}),
    };
    const certifications = (options.modelCertifications?.list(profile.id) ?? []).map(item => ({
      ...item,
      evidence: item.evidence.map(redactSecrets),
      ...(item.detail ? { detail: redactSecrets(item.detail) } : {}),
    }));
    const limitations = [
      profile.toolUse === false ? 'Tool selection is explicitly unsupported.' : '',
      profile.vision === false ? 'Vision is explicitly unsupported.' : '',
      certifications.length === 0 ? 'No evidence-backed capability certifications are recorded.' : '',
    ].filter(Boolean);
    return {
      profile: safeProfile,
      certifications,
      providerState: options.modelProviderState?.get(profile.id) ?? 'UNKNOWN' as const,
      limitations,
    };
  });
  const snapshot: SelfKnowledgeSnapshot = {
    generatedAt: checkedAt,
    identity: {
      name: CORE_IDENTITY.name,
      role: CORE_IDENTITY.role,
      thaiFirst: CORE_IDENTITY.thaiFirst,
      notConscious: CORE_IDENTITY.notConscious,
      ownerRelationship: 'owner_sovereignty',
      trustBoundaries: [
        'DATA != AUTHORITY',
        'LLM OUTPUT != EXECUTION',
        'DISCOVER != REVIEW != INSTALL != TRUST != EXECUTE',
        'The model cannot bypass CapabilityHost, policy, permission, Emergency Stop, verification, rollback, or containment.',
        'Jarvis cannot raise the owner autonomy ceiling or approve its own privilege escalation.',
      ],
    },
    models,
    capabilities,
    services: (options.services ?? []).map(service => ({
      ...service,
      ...(service.detail ? { detail: redactSecrets(service.detail) } : {}),
      evidence: service.evidence.map(redactSecrets),
    })),
    providers: providerInventory(capabilities),
    competence: options.selfModel?.matrix() ?? [],
    goals: [],
    unknowns: [
      ...(models.length === 0 ? ['No configured model profile was observable.'] : []),
      ...(options.services === undefined ? ['Service inventory was not supplied to Self Knowledge.'] : []),
    ],
  };
  snapshot.goals = buildGoalKnowledge(options.goalCatalog ?? createDefaultGoalCatalog(), snapshot);
  return snapshot;
}

async function safeAvailability(host: CapabilityHost, id: string) {
  try {
    return await host.availability(id);
  } catch (error) {
    return {
      id,
      availability: 'failed' as const,
      degraded: true,
      reason: redactSecrets(error instanceof Error ? error.message : String(error)),
    };
  }
}

function capabilityFromDescriptor(
  descriptor: CapabilityDescriptor,
  availability: Awaited<ReturnType<CapabilityHost['availability']>>,
  checkedAt: string,
  competence: SelfKnowledgeCapability['competence'],
): SelfKnowledgeCapability {
  const metadata = descriptor.intelligence;
  const mode = metadata?.executionMode ?? 'REAL';
  const permissionClass = metadata?.permission
    ?? (descriptor.sideEffect === 'read' ? 'NOT_REQUIRED' : 'POLICY_EVALUATED');
  const status = statusFor(descriptor, availability.availability, availability.degraded);
  const reason = redactSecrets(availability.reason || statusReason(status));
  return {
    id: descriptor.id,
    displayName: humanName(descriptor.id),
    description: descriptor.description,
    registered: true,
    status,
    reason,
    implementation: {
      maturity: metadata?.maturity ?? (mode === 'SIMULATION' ? 'SIMULATION' : 'FUNCTIONAL_CORE'),
      mode,
      source: 'registry',
    },
    runtime: {
      availability: availability.availability,
      degraded: availability.degraded,
      checkedAt,
    },
    provider: { kind: descriptor.providerKind, requiredService: descriptor.requiredService },
    permission: permissionEvidence(permissionClass),
    localAcceptance: metadata?.localAcceptance ?? 'NOT_REQUIRED',
    distribution: metadata?.distribution ? [...metadata.distribution] : distributionForCapability(descriptor.id),
    contracts: { input: { ...descriptor.inputSchema }, output: { ...descriptor.outputSchema } },
    support: {
      cancellation: descriptor.cancellation?.support ?? 'not_supported',
      verification: descriptor.verification ? 'registered' : 'not_registered',
      rollback: descriptor.rollback ? 'registered' : 'not_registered',
    },
    sideEffect: descriptor.sideEffect,
    untrustedOutput: descriptor.untrustedOutput,
    requirements: requirements(metadata?.requirements),
    knownLimitations: [...(metadata?.knownLimitations ?? [])],
    ...(competence ? { competence } : {}),
    evidence: [`registry:${descriptor.id}`, `availability:${availability.availability}`],
  };
}

function capabilityFromDeclaration(
  item: DeclaredCapabilityEvidence,
  checkedAt: string,
  competence: SelfKnowledgeCapability['competence'],
): SelfKnowledgeCapability {
  return {
    ...item,
    description: redactSecrets(item.description),
    reason: redactSecrets(item.reason),
    registered: false,
    runtime: {
      availability: item.runtime?.availability ?? 'unknown',
      degraded: item.runtime?.degraded ?? item.status !== 'AVAILABLE',
      checkedAt: item.runtime?.checkedAt ?? checkedAt,
    },
    requirements: requirements(item.requirements, true),
    distribution: [...item.distribution],
    contracts: { input: { ...item.contracts.input }, output: { ...item.contracts.output } },
    support: { ...item.support },
    knownLimitations: item.knownLimitations.map(redactSecrets),
    evidence: item.evidence.map(redactSecrets),
    ...(competence ? { competence } : {}),
  };
}

function statusFor(
  descriptor: CapabilityDescriptor,
  availability: Awaited<ReturnType<CapabilityHost['availability']>>['availability'],
  degraded: boolean,
): SelfKnowledgeCapability['status'] {
  const metadata = descriptor.intelligence;
  if (metadata?.executionMode === 'SIMULATION') return 'SIMULATION';
  if (metadata?.executionMode === 'PREPARE_CONTRACT') return 'UNAVAILABLE';
  if (availability === 'up') return degraded ? 'DEGRADED' : 'AVAILABLE';
  if (availability === 'not_configured') {
    if (metadata?.requirements?.ownerInput?.length) return 'NEEDS_OWNER_INPUT';
    if (metadata?.requirements?.providers?.length) return 'NEEDS_PROVIDER';
    if (metadata?.requirements?.dependencies?.length) return 'NEEDS_DEPENDENCY';
    return 'NEEDS_CONFIGURATION';
  }
  if (availability === 'disabled') return 'POLICY_BLOCKED';
  if (availability === 'failed') return 'DEGRADED';
  return 'UNAVAILABLE';
}

function permissionEvidence(cls: SelfKnowledgeCapability['permission']['class']): SelfKnowledgeCapability['permission'] {
  return {
    class: cls,
    ownerApprovalRequired: cls === 'OWNER_REQUIRED' || cls === 'PRIVILEGE_REQUIRED',
    privilegeRequired: cls === 'PRIVILEGE_REQUIRED',
    authorityGranted: false,
  };
}

function requirements(
  value?: Partial<SelfKnowledgeCapability['requirements']>,
  redact = false,
): SelfKnowledgeCapability['requirements'] {
  const safe = (items: string[] | undefined) => (items ?? []).map(item => redact ? redactSecrets(item) : item);
  return {
    providers: safe(value?.providers),
    services: safe(value?.services),
    configuration: safe(value?.configuration),
    ownerInput: safe(value?.ownerInput),
    dependencies: safe(value?.dependencies),
  };
}

function statusReason(status: SelfKnowledgeCapability['status']): string {
  const reasons: Record<SelfKnowledgeCapability['status'], string> = {
    AVAILABLE: 'Registered capability and provider report available.',
    DEGRADED: 'The capability is registered but its runtime evidence is degraded.',
    NEEDS_CONFIGURATION: 'Configuration is incomplete.',
    NEEDS_OWNER_INPUT: 'Precise owner input is required.',
    NEEDS_PERMISSION: 'Owner permission is required before execution.',
    NEEDS_DEPENDENCY: 'A declared dependency is missing.',
    NEEDS_PROVIDER: 'No usable provider is configured.',
    SIMULATION: 'Simulation only; it has no live effect.',
    BLOCKED_LOCAL_ACCEPTANCE: 'Owner-machine acceptance is required.',
    UNAVAILABLE: 'The registered runtime is unavailable.',
    UNSUPPORTED: 'No supported implementation is known.',
    POLICY_BLOCKED: 'Current policy blocks this capability.',
    UNKNOWN: 'There is insufficient evidence to determine readiness.',
  };
  return reasons[status];
}

function providerInventory(capabilities: SelfKnowledgeCapability[]): SelfKnowledgeSnapshot['providers'] {
  const byId = new Map<string, SelfKnowledgeSnapshot['providers'][number]>();
  for (const capability of capabilities) {
    const id = capability.provider.requiredService || `${capability.provider.kind}:unspecified`;
    const state = capability.implementation.mode === 'SIMULATION'
      ? 'SIMULATION'
      : capability.implementation.mode === 'PREPARE_CONTRACT'
        ? 'PREPARE_CONTRACT'
        : capability.status === 'AVAILABLE'
          ? 'ACTIVE'
          : capability.status === 'DEGRADED'
            ? 'DEGRADED'
            : capability.status === 'UNKNOWN'
              ? 'UNKNOWN'
              : 'UNAVAILABLE';
    const current = byId.get(id);
    if (current) {
      current.capabilities.push(capability.id);
      current.state = strongerProviderState(current.state, state);
    } else byId.set(id, { id, kind: capability.provider.kind, state, capabilities: [capability.id] });
  }
  return [...byId.values()];
}

function strongerProviderState(
  left: SelfKnowledgeSnapshot['providers'][number]['state'],
  right: SelfKnowledgeSnapshot['providers'][number]['state'],
): SelfKnowledgeSnapshot['providers'][number]['state'] {
  const rank: Record<SelfKnowledgeSnapshot['providers'][number]['state'], number> = {
    ACTIVE: 6,
    DEGRADED: 5,
    SIMULATION: 4,
    PREPARE_CONTRACT: 3,
    UNAVAILABLE: 2,
    UNKNOWN: 1,
  };
  return rank[right] > rank[left] ? right : left;
}

function humanName(id: string): string {
  return id
    .replace(/[._:/-]+/gu, ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/\b\w/gu, value => value.toUpperCase());
}
