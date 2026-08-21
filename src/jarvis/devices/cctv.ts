import { looksLikeSecret } from '../security/redaction';
import type { CapabilityGoalDefinition, DeclaredCapabilityEvidence } from '../intelligence/types';
import type { DeviceProvider } from './types';

export const CCTV_CAPABILITY_IDS = [
  'cctv.discover',
  'cctv.connect',
  'cctv.status',
  'cctv.view',
  'cctv.snapshot',
  'cctv.stream',
  'cctv.events',
] as const;

export type CctvCapabilityId = (typeof CCTV_CAPABILITY_IDS)[number];
export type CctvProviderType = 'RTSP' | 'ONVIF' | 'VENDOR_NVR' | 'FUTURE_LOCAL';
export type CctvConnectionState = 'NOT_CONFIGURED' | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'FAILED';

export type CctvConnectionProfile = {
  id: string;
  friendlyName: string;
  providerType: CctvProviderType;
  lanAddress: string;
  port?: number;
  protocol: string;
  streamPath?: string;
  deviceIdentity?: string;
  capabilityClasses: Array<'DISCOVER' | 'CONNECT' | 'STATUS' | 'VIEW' | 'SNAPSHOT' | 'STREAM' | 'EVENTS'>;
  /** Opaque local secret-store reference. Never the credential itself. */
  credentialRef?: string;
  connectionState: CctvConnectionState;
  lastHealthEvidence?: { at: string; state: CctvConnectionState; evidenceRef: string };
};

export type CctvProviderHealth = {
  providerType: CctvProviderType;
  state: CctvConnectionState;
  detail: string;
  observedAt: string;
  evidenceRefs: string[];
  realConnection: boolean;
};

/** Provider contract only. No network discovery or owner CCTV access is implemented here. */
export interface CCTVProvider extends DeviceProvider {
  readonly providerType: CctvProviderType;
  health(profile: CctvConnectionProfile): Promise<CctvProviderHealth>;
}

const OWNER_DISTRIBUTION = ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'] as const;
const REQUIRED_OWNER_INPUT = [
  'camera or NVR vendor and model',
  'known LAN address or hostname',
  'supported RTSP, ONVIF, or vendor protocol',
  'local credential reference (never the credential value)',
];

export function cctvCapabilityContracts(): DeclaredCapabilityEvidence[] {
  return CCTV_CAPABILITY_IDS.map(id => {
    const action = id.split('.')[1] || id;
    const connect = id === 'cctv.connect';
    const discover = id === 'cctv.discover';
    return {
      id,
      displayName: `CCTV ${action[0]?.toUpperCase()}${action.slice(1)}`,
      description: cctvDescription(id),
      status: discover ? 'NEEDS_OWNER_INPUT' : connect ? 'NEEDS_PROVIDER' : 'NEEDS_DEPENDENCY',
      reason: discover
        ? 'Bounded local discovery requires an explicit owner-provided scope and local acceptance.'
        : connect
          ? 'No real RTSP, ONVIF, or vendor/NVR provider is configured.'
          : 'A verified real CCTV connection is required first.',
      implementation: { maturity: 'PREPARE_CONTRACT', mode: 'PREPARE_CONTRACT', source: 'provider_contract' },
      provider: { kind: 'contract', requiredService: 'owner-local-cctv-provider' },
      permission: {
        class: 'OWNER_REQUIRED',
        ownerApprovalRequired: true,
        privilegeRequired: false,
        authorityGranted: false,
      },
      localAcceptance: 'BLOCKED_LOCAL_ACCEPTANCE',
      distribution: [...OWNER_DISTRIBUTION],
      contracts: {
        input: {
          type: 'object',
          properties: {
            profileId: { type: 'string' },
            credentialRef: { type: 'string', description: 'Opaque local secret reference only.' },
          },
          additionalProperties: false,
        },
        output: { type: 'object', properties: { evidenceRef: { type: 'string' }, state: { type: 'string' } } },
      },
      support: { cancellation: 'not_supported', verification: 'not_registered', rollback: 'not_registered' },
      sideEffect: discover || connect ? 'write' : 'read',
      untrustedOutput: true,
      requirements: {
        providers: ['RTSP, ONVIF, or reviewed vendor/NVR adapter'],
        services: ['local LAN CCTV provider'],
        configuration: ['bounded local connection profile', 'local secret-store integration'],
        ownerInput: connect || discover ? [...REQUIRED_OWNER_INPUT] : [],
        dependencies: connect || discover ? [] : ['cctv.connect'],
      },
      knownLimitations: [
        'No real provider is configured.',
        'No uncontrolled LAN scanning is implemented.',
        'VIEW does not grant CONTROL, CONFIGURE, PTZ, or ADMIN.',
        'Camera footage is not uploaded to cloud by this contract.',
      ],
      evidence: ['provider-contract:cctv:v1', 'cloud-limit:no-owner-cctv'],
    };
  });
}

export const CCTV_CONNECT_GOAL: CapabilityGoalDefinition = {
  id: 'goal.cctv.connect',
  title: 'Connect to the owner CCTV',
  dependencies: [
    { capabilityId: 'cctv.connect', relation: 'REQUIRED' },
    { capabilityId: 'cctv.status', relation: 'REQUIRED' },
    { capabilityId: 'cctv.snapshot', relation: 'OPTIONAL' },
  ],
};

export const CCTV_ANALYZE_FRONT_DOOR_GOAL: CapabilityGoalDefinition = {
  id: 'goal.cctv.analyzeFrontDoor',
  title: 'Analyze front-door CCTV',
  dependencies: [
    { capabilityId: 'cctv.connect', relation: 'REQUIRED' },
    { capabilityId: 'cctv.view', relation: 'REQUIRED' },
    { capabilityId: 'video.decode', relation: 'REQUIRED' },
    { capabilityId: 'vision.analyze', relation: 'REQUIRED' },
    { capabilityId: 'event.store', relation: 'REQUIRED' },
    { capabilityId: 'alert.send', relation: 'OPTIONAL' },
    { capabilityId: 'timeline.search', relation: 'OPTIONAL' },
  ],
};

export function validateCctvConnectionProfile(value: unknown): CctvConnectionProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CCTV profile must be an object.');
  const raw = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(raw)) {
    if (/password|username|token|cookie|authorization|api[_-]?key|secret(?!ref)/iu.test(key)) {
      throw new Error('CCTV credentials must be represented only by an opaque credentialRef.');
    }
    if (typeof item === 'string' && key !== 'credentialRef' && looksLikeSecret(item)) {
      throw new Error('CCTV profile contains secret-like material outside credentialRef.');
    }
  }
  const id = boundedString(raw.id, 'id');
  const friendlyName = boundedString(raw.friendlyName, 'friendlyName');
  const lanAddress = validateLanAddress(boundedString(raw.lanAddress, 'lanAddress'));
  const protocol = boundedString(raw.protocol, 'protocol');
  const providerType = raw.providerType;
  if (!['RTSP', 'ONVIF', 'VENDOR_NVR', 'FUTURE_LOCAL'].includes(String(providerType))) {
    throw new Error('Unsupported CCTV providerType.');
  }
  const connectionState = raw.connectionState;
  if (!['NOT_CONFIGURED', 'DISCONNECTED', 'CONNECTING', 'CONNECTED', 'DEGRADED', 'FAILED'].includes(String(connectionState))) {
    throw new Error('Unsupported CCTV connectionState.');
  }
  const credentialRef = typeof raw.credentialRef === 'string' ? raw.credentialRef.trim() : undefined;
  if (credentialRef && !/^local-secret:\/\/[a-z0-9/_-]{1,160}$/iu.test(credentialRef)) {
    throw new Error('credentialRef must be an opaque local-secret:// reference.');
  }
  const classes = Array.isArray(raw.capabilityClasses) ? raw.capabilityClasses.map(String) : [];
  const allowed = new Set(['DISCOVER', 'CONNECT', 'STATUS', 'VIEW', 'SNAPSHOT', 'STREAM', 'EVENTS']);
  if (classes.some(item => !allowed.has(item))) throw new Error('CCTV profile declares an unsupported capability class.');
  const port = raw.port === undefined ? undefined : Number(raw.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) throw new Error('CCTV port is invalid.');
  return {
    id,
    friendlyName,
    providerType: providerType as CctvProviderType,
    lanAddress,
    ...(port ? { port } : {}),
    protocol,
    ...(typeof raw.streamPath === 'string' ? { streamPath: validateStreamPath(raw.streamPath) } : {}),
    ...(typeof raw.deviceIdentity === 'string' ? { deviceIdentity: raw.deviceIdentity.slice(0, 160) } : {}),
    capabilityClasses: classes as CctvConnectionProfile['capabilityClasses'],
    ...(credentialRef ? { credentialRef } : {}),
    connectionState: connectionState as CctvConnectionState,
  };
}

function validateLanAddress(value: string): string {
  if (/[:][/][/]|[@/?#\s]/u.test(value) || !/^[a-z0-9.:[\]_-]+$/iu.test(value)) {
    throw new Error('CCTV lanAddress must be a hostname or IP address without a URL, path, or credentials.');
  }
  return value;
}

function validateStreamPath(value: string): string {
  const path = value.trim();
  if (!path || path.length > 512 || !path.startsWith('/')) {
    throw new Error('CCTV streamPath must be a bounded absolute path.');
  }
  if (/[:][/][/]|[@#]|[\u0000-\u001f\u007f]/u.test(path)) {
    throw new Error('CCTV streamPath cannot contain a URL scheme, user-info, fragment, or control characters.');
  }
  const query = path.split('?', 2)[1];
  if (query) {
    const allowedKeys = new Set(['channel', 'subtype', 'stream', 'profile', 'transportmode', 'unicast', 'proto']);
    for (const segment of query.split('&')) {
      const [rawKey] = segment.split('=', 1);
      let key: string;
      try {
        key = decodeURIComponent(rawKey || '').toLowerCase();
      } catch {
        throw new Error('CCTV streamPath contains invalid query encoding.');
      }
      if (!allowedKeys.has(key)) {
        throw new Error('CCTV streamPath query keys must use the non-secret allowlist.');
      }
    }
  }
  return path;
}

function boundedString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`CCTV ${name} is required and bounded.`);
  return value.trim();
}

function cctvDescription(id: CctvCapabilityId): string {
  const descriptions: Record<CctvCapabilityId, string> = {
    'cctv.discover': 'Owner-initiated, bounded local CCTV discovery contract.',
    'cctv.connect': 'Connect to a known owner CCTV/NVR through a reviewed local provider.',
    'cctv.status': 'Read provider and device connection health.',
    'cctv.view': 'View a verified live feed without control authority.',
    'cctv.snapshot': 'Capture one bounded frame from an approved feed.',
    'cctv.stream': 'Read an approved stream through the local provider.',
    'cctv.events': 'Read provider events without configuration or admin authority.',
  };
  return descriptions[id];
}
