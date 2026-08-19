import os from 'node:os';

export type NetworkSnapshot = {
  status: 'ok' | 'unavailable';
  available?: boolean;
  interfaceClass?: 'wifi' | 'ethernet' | 'other';
  reason?: string;
};

let cache: { at: number; value: NetworkSnapshot } | null = null;
const NETWORK_TTL_MS = 10_000;

export function readNetworkStatus(
  now = Date.now(),
  groups?: NodeJS.Dict<os.NetworkInterfaceInfo[]> | null,
): NetworkSnapshot {
  const live = groups === undefined;
  if (live && cache && now - cache.at < NETWORK_TTL_MS) return cache.value;
  const value = readNetworkFresh(live ? os.networkInterfaces() : groups);
  if (live) cache = { at: now, value };
  return value;
}

export function readNetworkFresh(groups: NodeJS.Dict<os.NetworkInterfaceInfo[]> | null): NetworkSnapshot {
  try {
    if (!groups) {
      return { status: 'unavailable', reason: 'Network interfaces are unavailable.' };
    }
    let available = false;
    let interfaceClass: NetworkSnapshot['interfaceClass'];
    for (const [name, addresses] of Object.entries(groups)) {
      const usable = (addresses ?? []).some(item => item.family === 'IPv4' && !item.internal);
      if (!usable) continue;
      available = true;
      const next = classifyInterface(name);
      if (!interfaceClass || next === 'wifi' || (next === 'ethernet' && interfaceClass === 'other')) {
        interfaceClass = next;
      }
    }
    return {
      status: 'ok',
      available,
      ...(interfaceClass ? { interfaceClass } : {}),
    };
  } catch {
    return { status: 'unavailable', reason: 'Network interfaces are unavailable.' };
  }
}

function classifyInterface(name: string): 'wifi' | 'ethernet' | 'other' {
  const lowered = name.toLocaleLowerCase();
  if (lowered.includes('wi-fi') || lowered.includes('wifi') || lowered.includes('wireless') || lowered.includes('wlan')) {
    return 'wifi';
  }
  if (lowered.includes('ethernet') || lowered.includes('lan')) return 'ethernet';
  return 'other';
}
