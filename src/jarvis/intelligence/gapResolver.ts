import type { ModelRouter } from '../models/ModelRouter';
import type {
  CapabilityGraphResolution,
  CapabilityIntelligenceStatus,
  GapResolutionPath,
  GapResolutionPlan,
  ObjectiveBlockerCode,
  SelfKnowledgeCapability,
  SelfKnowledgeSnapshot,
} from './types';

export type CapabilityGapResolverInput = {
  objective: string;
  graph: CapabilityGraphResolution;
  snapshot: SelfKnowledgeSnapshot;
  modelRouter?: ModelRouter;
  attempted?: number;
  maximumAttempts?: number;
};

export class CapabilityGapResolver {
  public async resolve(input: CapabilityGapResolverInput): Promise<GapResolutionPlan> {
    const attempted = Math.max(0, input.attempted ?? 0);
    const maximum = Math.max(1, Math.min(input.maximumAttempts ?? 2, 4));
    const byId = new Map(input.snapshot.capabilities.map(item => [item.id, item]));
    const selected = input.graph.selected.map(id => byId.get(id)).filter((item): item is SelfKnowledgeCapability => Boolean(item));
    const permissions = selected
      .filter(item => item.permission.ownerApprovalRequired || item.permission.privilegeRequired)
      .map(item => item.id);
    const missing = input.graph.missing.map(item => ({
      capabilityId: item.capabilityId,
      blocker: blockerFor(item.status, byId.get(item.capabilityId)),
      currentState: item.status,
      reason: item.reason,
    }));
    const possiblePaths: GapResolutionPath[] = [];

    if (input.graph.ready) {
      possiblePaths.push(existingPath(selected, permissions));
    } else {
      for (const gap of missing) possiblePaths.push(...pathsForGap(gap, byId.get(gap.capabilityId)));
    }

    const uniquePaths = deduplicatePaths(possiblePaths).sort((a, b) => a.priority - b.priority);
    const recommendedPath = attempted >= maximum
      ? uniquePaths.find(item => item.kind === 'REPORT_BLOCKER')
      : uniquePaths.find(item => item.executableNow)
        ?? uniquePaths.find(item => item.kind === 'REQUEST_OWNER_INPUT')
        ?? uniquePaths[0];
    const ownerInputRequired = unique([
      ...missing.flatMap(item => byId.get(item.capabilityId)?.requirements.ownerInput ?? []),
      ...(recommendedPath?.ownerInputRequired ?? []),
    ]);

    return {
      goal: input.objective,
      status: input.graph.ready
        ? (permissions.length ? 'NEEDS_OWNER' : 'READY')
        : recommendedPath?.kind === 'REQUEST_OWNER_INPUT'
          ? 'NEEDS_OWNER'
          : 'BLOCKED',
      missing,
      possiblePaths: uniquePaths,
      ...(recommendedPath ? { recommendedPath } : {}),
      ownerInputRequired,
      permissionRequired: unique([
        ...permissions,
        ...(recommendedPath?.permissionRequired ?? []),
      ]),
      verificationStrategy: selected.map(item => item.support.verification === 'registered'
        ? `Run registered deterministic postconditions for ${item.id}.`
        : `Require typed outcome evidence for ${item.id}; do not manufacture VERIFIED.`),
      confidence: input.graph.ready ? 1 : input.graph.evidence.length ? 0.7 : null,
      evidence: [...input.graph.evidence, ...missing.map(item => `gap:${item.capabilityId}:${item.currentState}`)],
      boundedAttempts: { attempted, maximum },
    };
  }
}

function existingPath(capabilities: SelfKnowledgeCapability[], permissions: string[]): GapResolutionPath {
  const ids = capabilities.map(item => item.id);
  return {
    kind: ids.length > 1 ? 'COMPOSE_EXISTING_CAPABILITIES' : 'USE_EXISTING_CAPABILITY',
    priority: ids.length > 1 ? 2 : 1,
    title: ids.length > 1 ? 'Compose registered capabilities.' : 'Use the registered capability.',
    capabilityIds: ids,
    risk: capabilities.some(item => item.sideEffect === 'write') ? 'MEDIUM' : 'LOW',
    ownerInputRequired: [],
    permissionRequired: permissions,
    externalDependencies: unique(capabilities.flatMap(item => item.requirements.providers)),
    researchRequired: false,
    executableNow: true,
    inputCompatible: true,
    trustRequired: false,
  };
}

function pathsForGap(
  gap: GapResolutionPlan['missing'][number],
  capability?: SelfKnowledgeCapability,
): GapResolutionPath[] {
  const common = {
    capabilityIds: [gap.capabilityId],
    risk: 'LOW' as const,
    ownerInputRequired: capability?.requirements.ownerInput ?? [],
    permissionRequired: capability?.permission.ownerApprovalRequired ? [gap.capabilityId] : [],
    externalDependencies: unique([
      ...(capability?.requirements.providers ?? []),
      ...(capability?.requirements.dependencies ?? []),
    ]),
    inputCompatible: false,
    trustRequired: false,
  };
  const paths: GapResolutionPath[] = [];
  if (gap.blocker === 'MISSING_PROVIDER'
    || gap.blocker === 'MISSING_CONFIGURATION'
    || gap.blocker === 'SERVICE_UNAVAILABLE'
    || capability?.status === 'NEEDS_PROVIDER') {
    paths.push({
      ...common,
      kind: 'RESTORE_OR_CONFIGURE_PROVIDER',
      priority: 3,
      title: 'Restore or configure the existing provider contract.',
      researchRequired: false,
      executableNow: false,
    });
  }
  if (gap.blocker === 'OWNER_INPUT_REQUIRED' || gap.blocker === 'MISSING_CREDENTIAL' || common.ownerInputRequired.length) {
    paths.push({
      ...common,
      kind: 'REQUEST_OWNER_INPUT',
      priority: 9,
      title: 'Request only the missing owner information through a secure channel.',
      researchRequired: false,
      executableNow: false,
    });
  }
  if (gap.blocker !== 'POLICY_BLOCKED') {
    paths.push({
      ...common,
      kind: 'RESEARCH_TRUSTED_DOCUMENTATION',
      priority: 5,
      title: 'Research trusted documentation without installing or executing discovered code.',
      researchRequired: true,
      executableNow: false,
    });
    paths.push({
      ...common,
      kind: 'PREPARE_ADAPTER_OR_PROVIDER',
      priority: 7,
      title: 'Prepare an isolated adapter/provider candidate for review and tests.',
      researchRequired: true,
      executableNow: false,
      trustRequired: true,
    });
  }
  paths.push({
    ...common,
    kind: 'REPORT_BLOCKER',
    priority: 10,
    title: 'Report the current blocker and the precise next possible step.',
    researchRequired: false,
    executableNow: false,
  });
  return paths;
}

function blockerFor(status: CapabilityIntelligenceStatus, capability?: SelfKnowledgeCapability): ObjectiveBlockerCode {
  if (capability?.requirements.ownerInput.some(item => /credential|password|secret/iu.test(item))) return 'MISSING_CREDENTIAL';
  const map: Partial<Record<CapabilityIntelligenceStatus, ObjectiveBlockerCode>> = {
    NEEDS_PROVIDER: 'MISSING_PROVIDER',
    NEEDS_DEPENDENCY: 'MISSING_DEPENDENCY',
    NEEDS_CONFIGURATION: 'MISSING_CONFIGURATION',
    NEEDS_OWNER_INPUT: 'OWNER_INPUT_REQUIRED',
    NEEDS_PERMISSION: 'PERMISSION_REQUIRED',
    BLOCKED_LOCAL_ACCEPTANCE: 'LOCAL_ACCEPTANCE_REQUIRED',
    POLICY_BLOCKED: 'POLICY_BLOCKED',
    UNSUPPORTED: 'MISSING_CAPABILITY',
    UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    UNKNOWN: 'UNKNOWN',
    SIMULATION: 'LOCAL_ACCEPTANCE_REQUIRED',
  };
  return map[status] ?? 'INSUFFICIENT_EVIDENCE';
}

function deduplicatePaths(paths: GapResolutionPath[]): GapResolutionPath[] {
  const seen = new Set<string>();
  return paths.filter(item => {
    const key = `${item.kind}:${item.capabilityIds.join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
