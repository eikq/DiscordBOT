import { redactDeep } from '../security/redaction';
import { FORBIDDEN_TRACE_KEYS } from '../ops/traceTypes';
import type { DeviceCapabilityClass, DeviceProvider, DeviceRecord } from '../devices/types';
import { defaultCctvGrant, type CctvGrant } from './cctv';
import type { CctvAction, DeviceConnectivity, DeviceIdentity, DeviceTrust } from './types';

const TRACE_STRIP = new Set<string>([
  ...FORBIDDEN_TRACE_KEYS,
  'password',
  'secret',
  'token',
  'cookie',
  'cookies',
  'apiKey',
  'api_key',
  'credentials',
  'authorization',
]);

export function connectivityFromStatus(status: string): DeviceConnectivity {
  if (status === 'online') return 'online';
  if (status === 'offline') return 'offline';
  if (status === 'warning') return 'degraded';
  return 'unknown';
}

export function identityFromRecord(
  record: DeviceRecord,
  nowIso = new Date(0).toISOString(),
): DeviceIdentity {
  const cctvActions: CctvAction[] = record.kind === 'cctv' ? [...defaultCctvGrant()] : [];
  return {
    deviceId: record.id,
    type: record.kind,
    ownerLabel: record.label,
    capabilities: [...record.capabilities],
    cctvActions,
    trust: 'untrusted',
    connectivity: connectivityFromStatus(record.status),
    lastSeen: record.status === 'offline' ? null : nowIso,
    simulated: record.simulated,
  };
}

export function sanitizeDeviceTrace(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactDeep(value) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(redacted)) {
    if (TRACE_STRIP.has(key) || /password|secret|token|cookie|api[_-]?key|credential/iu.test(key)) {
      continue;
    }
    out[key] = item;
  }
  return out;
}

export class DeviceRegistry {
  constructor(
    private readonly provider: DeviceProvider,
    private readonly now: () => string = () => new Date(0).toISOString(),
    private readonly cctvGrant: CctvGrant = defaultCctvGrant(),
  ) {}

  public list(): DeviceIdentity[] {
    return this.provider.list().map(item => identityFromRecord(item, this.now()));
  }

  public capability(deviceId: string, cls: DeviceCapabilityClass): boolean {
    return this.provider.capability(deviceId, cls);
  }

  public cctvActions(deviceId: string): CctvAction[] {
    const device = this.list().find(item => item.deviceId === deviceId);
    if (!device || device.type !== 'cctv') return [];
    return device.cctvActions.filter(action => this.cctvGrant.includes(action));
  }

  public traces(): Array<Record<string, unknown>> {
    return this.list().map(item => sanitizeDeviceTrace({ ...item }));
  }
}

export function deviceTrustDefault(): DeviceTrust {
  return 'untrusted';
}
