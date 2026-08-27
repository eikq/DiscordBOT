import type { AgentRuntime, RuntimeCapabilities } from '../runtime/types';
import { redactSecrets } from '../security/redaction';
import type {
  DeclaredCapabilityEvidence,
  SelfKnowledgeService,
} from './types';

export type AgentRuntimeCapabilitySync = {
  service: SelfKnowledgeService;
  declarations: DeclaredCapabilityEvidence[];
};

type RuntimeControlSpec = {
  id: string;
  feature: string;
  endpoint: string;
  description: string;
  sideEffect: 'read' | 'write';
  permission: 'NOT_REQUIRED' | 'OWNER_REQUIRED';
};

const HERMES_RUNTIME_CONTROLS: readonly RuntimeControlSpec[] = [
  { id: 'runtime.hermes.run.submit', feature: 'run_submission', endpoint: 'runs', description: 'Submit a server-side Hermes agent run.', sideEffect: 'write', permission: 'OWNER_REQUIRED' },
  { id: 'runtime.hermes.run.status', feature: 'run_status', endpoint: 'run_status', description: 'Read Hermes run status.', sideEffect: 'read', permission: 'NOT_REQUIRED' },
  { id: 'runtime.hermes.run.events', feature: 'run_events_sse', endpoint: 'run_events', description: 'Observe structured Hermes run lifecycle events.', sideEffect: 'read', permission: 'NOT_REQUIRED' },
  { id: 'runtime.hermes.run.stop', feature: 'run_stop', endpoint: 'run_stop', description: 'Request cooperative stop of a Hermes run.', sideEffect: 'write', permission: 'OWNER_REQUIRED' },
  { id: 'runtime.hermes.run.steer', feature: 'run_steer', endpoint: 'run_steer', description: 'Inject bounded guidance into a running Hermes agent.', sideEffect: 'write', permission: 'OWNER_REQUIRED' },
  { id: 'runtime.hermes.run.approval', feature: 'run_approval_response', endpoint: 'run_approval', description: 'Resolve a Hermes tool approval request.', sideEffect: 'write', permission: 'OWNER_REQUIRED' },
] as const;

const REQUIRED_RUNTIME_FEATURES = HERMES_RUNTIME_CONTROLS.map(item => item.feature);

export async function syncAgentRuntimeCapabilities(
  runtime: AgentRuntime,
  checkedAt = new Date().toISOString(),
): Promise<AgentRuntimeCapabilitySync> {
  try {
    const observed = await runtime.getCapabilities();
    return {
      service: runtimeService(observed),
      declarations: HERMES_RUNTIME_CONTROLS.map(spec => declarationFrom(spec, observed, checkedAt)),
    };
  } catch (error) {
    const reason = redactSecrets(error instanceof Error ? error.message : String(error));
    return unavailableSync(checkedAt, reason);
  }
}
function runtimeService(observed: RuntimeCapabilities): SelfKnowledgeService {
  const states = REQUIRED_RUNTIME_FEATURES.map(feature => observed.features[feature]);
  const enabled = states.filter(value => value === true).length;
  const state = enabled === states.length
    ? 'AVAILABLE'
    : enabled > 0
      ? 'DEGRADED'
      : 'DEGRADED';
  const platform = redactSecrets(observed.platform || 'unknown');
  return {
    id: 'hermes-agent-runtime',
    state,
    detail: state === 'AVAILABLE'
      ? 'Hermes agent runtime control plane is reachable and advertises the required run lifecycle features.'
      : 'Hermes agent runtime is reachable but one or more required run lifecycle features are not advertised.',
    evidence: [
      `runtime:hermes:platform:${platform}`,
      ...REQUIRED_RUNTIME_FEATURES.map(feature => `runtime:hermes:feature:${feature}:${observed.features[feature] === true ? 'available' : 'unavailable'}`),
    ],
  };
}

function declarationFrom(
  spec: RuntimeControlSpec,
  observed: RuntimeCapabilities,
  checkedAt: string,
): DeclaredCapabilityEvidence {
  const advertised = observed.features[spec.feature];
  const endpoint = observed.endpoints[spec.endpoint];
  const available = advertised === true && Boolean(endpoint);
  const unknown = advertised === undefined || advertised === null;
  const status = available ? 'AVAILABLE' : unknown ? 'UNKNOWN' : 'UNAVAILABLE';
  const availability = available ? 'up' : unknown ? 'unknown' : 'unavailable';
  return {
    id: spec.id,
    displayName: displayName(spec.id),
    description: spec.description,
    status,
    reason: available
      ? 'Hermes advertises this runtime control. Discovery is evidence only; it is not a registered JARVIS execution capability.'
      : unknown
        ? 'Hermes did not provide enough evidence for this runtime control.'
        : 'Hermes does not currently advertise this runtime control.',
    implementation: { maturity: 'REFERENCE_ONLY', mode: 'PREPARE_CONTRACT', source: 'provider_contract' },
    provider: { kind: 'contract', requiredService: 'hermes-agent-runtime' },
    permission: {
      class: spec.permission,
      ownerApprovalRequired: spec.permission === 'OWNER_REQUIRED',
      privilegeRequired: false,
      authorityGranted: false,
    },
    localAcceptance: 'NOT_REQUIRED',
    distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED'],
    contracts: { input: { type: 'object' }, output: { type: 'object' } },
    support: {
      cancellation: spec.id.endsWith('.stop') ? 'cooperative' : 'not_supported',
      verification: 'not_registered',
      rollback: 'not_registered',
    },
    sideEffect: spec.sideEffect,
    untrustedOutput: true,
    requirements: {
      providers: ['Hermes Agent'],
      services: ['hermes-agent-runtime'],
      configuration: ['JARVIS_HERMES_BASE_URL', 'JARVIS_HERMES_API_KEY'],
      ownerInput: [],
      dependencies: [],
    },
    knownLimitations: [
      'Provider discovery cannot register, authorize, or execute a JARVIS capability.',
      'JARVIS authority, policy, permission, journal, and Emergency Stop remain authoritative.',
    ],
    runtime: { availability, degraded: !available, checkedAt },
    evidence: [
      `runtime:hermes:feature:${spec.feature}:${available ? 'available' : unknown ? 'unknown' : 'unavailable'}`,
      `runtime:hermes:endpoint:${spec.endpoint}:${endpoint ? 'advertised' : 'missing'}`,
      'runtime-discovery:not-authority',
    ],
  };
}
function unavailableSync(checkedAt: string, reason: string): AgentRuntimeCapabilitySync {
  return {
    service: {
      id: 'hermes-agent-runtime',
      state: 'UNAVAILABLE',
      detail: reason,
      evidence: ['runtime:hermes:probe_failed'],
    },
    declarations: HERMES_RUNTIME_CONTROLS.map(spec => ({
      id: spec.id,
      displayName: displayName(spec.id),
      description: spec.description,
      status: 'UNAVAILABLE',
      reason: `Hermes runtime probe failed: ${reason}`,
      implementation: { maturity: 'REFERENCE_ONLY', mode: 'PREPARE_CONTRACT', source: 'provider_contract' },
      provider: { kind: 'contract', requiredService: 'hermes-agent-runtime' },
      permission: {
        class: spec.permission,
        ownerApprovalRequired: spec.permission === 'OWNER_REQUIRED',
        privilegeRequired: false,
        authorityGranted: false,
      },
      localAcceptance: 'NOT_REQUIRED',
      distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED'],
      contracts: { input: { type: 'object' }, output: { type: 'object' } },
      support: { cancellation: 'not_supported', verification: 'not_registered', rollback: 'not_registered' },
      sideEffect: spec.sideEffect,
      untrustedOutput: true,
      requirements: {
        providers: ['Hermes Agent'],
        services: ['hermes-agent-runtime'],
        configuration: ['JARVIS_HERMES_BASE_URL', 'JARVIS_HERMES_API_KEY'],
        ownerInput: [],
        dependencies: [],
      },
      knownLimitations: [
        'Provider discovery cannot register, authorize, or execute a JARVIS capability.',
        'Runtime probe failure cannot be converted into execution authority.',
      ],
      runtime: { availability: 'unavailable', degraded: true, checkedAt },
      evidence: ['runtime:hermes:probe_failed', 'runtime-discovery:not-authority'],
    })),
  };
}

function displayName(id: string): string {
  return id
    .replace(/^runtime\.hermes\./u, 'Hermes ')
    .replace(/[._:/-]+/gu, ' ')
    .replace(/\b\w/gu, value => value.toUpperCase());
}
