/**
 * Stable display identity from observed Windows evidence only.
 * Never invent EDID, serial, or internal flags.
 */

import type { DisplayInfo } from './monitorTopology';

export const DISPLAY_FINGERPRINT_VERSION = 1 as const;

export type DisplayFingerprint = {
  version: typeof DISPLAY_FINGERPRINT_VERSION;
  key: string;
  devicePath?: string;
  edidKey?: string;
  deviceName?: string;
  size: { width: number; height: number };
};

export type DisplayResolveByIdentity =
  | { ok: true; display: DisplayInfo; confidence: 'HIGH' | 'MEDIUM' }
  | { ok: false; reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE' | 'DISPLAY_FINGERPRINT_INVALID'; message: string };

export function fingerprintDisplay(display: DisplayInfo, ordinal = 1): DisplayFingerprint {
  const size = { width: display.width, height: display.height };
  const devicePath = clean(display.devicePath);
  const edidKey = edidKeyOf(display);
  const deviceName = clean(display.deviceName || display.name || display.id);
  const key = stableKey([
    String(DISPLAY_FINGERPRINT_VERSION),
    devicePath || '',
    edidKey || '',
    deviceName || '',
    `${size.width}x${size.height}`,
    display.primary ? 'primary' : '',
  ].join('|'));
  return {
    version: DISPLAY_FINGERPRINT_VERSION,
    key,
    ...(devicePath ? { devicePath } : {}),
    ...(edidKey ? { edidKey } : {}),
    ...(deviceName ? { deviceName } : {}),
    size,
  };
  void ordinal;
}

export function serializeDisplayFingerprint(fingerprint: DisplayFingerprint): string {
  return `display.fp:${JSON.stringify({
    v: fingerprint.version,
    key: fingerprint.key,
    ...(fingerprint.devicePath ? { devicePath: fingerprint.devicePath } : {}),
    ...(fingerprint.edidKey ? { edidKey: fingerprint.edidKey } : {}),
    ...(fingerprint.deviceName ? { deviceName: fingerprint.deviceName } : {}),
    w: fingerprint.size.width,
    h: fingerprint.size.height,
  })}`;
}

export function parseDisplayFingerprint(raw: string | undefined): DisplayFingerprint | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (text === 'display.internal') return undefined;
  const json = text.startsWith('display.fp:') ? text.slice('display.fp:'.length) : text.startsWith('{') ? text : '';
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const width = Number(parsed.w ?? (parsed.size as { width?: number } | undefined)?.width);
    const height = Number(parsed.h ?? (parsed.size as { height?: number } | undefined)?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    const fingerprint: DisplayFingerprint = {
      version: DISPLAY_FINGERPRINT_VERSION,
      key: typeof parsed.key === 'string' ? parsed.key : '',
      size: { width, height },
      ...(typeof parsed.devicePath === 'string' ? { devicePath: parsed.devicePath } : {}),
      ...(typeof parsed.edidKey === 'string' ? { edidKey: parsed.edidKey } : {}),
      ...(typeof parsed.deviceName === 'string' ? { deviceName: parsed.deviceName } : {}),
    };
    if (!fingerprint.key) fingerprint.key = fingerprintDisplay({
      id: fingerprint.deviceName || 'unknown',
      name: fingerprint.deviceName || 'unknown',
      primary: false,
      x: 0,
      y: 0,
      width,
      height,
      ...(fingerprint.devicePath ? { devicePath: fingerprint.devicePath } : {}),
    }).key;
    return fingerprint;
  } catch {
    return undefined;
  }
}

export function matchDisplayFingerprint(
  displays: DisplayInfo[],
  fingerprint: DisplayFingerprint,
): DisplayResolveByIdentity {
  if (!displays.length) {
    return {
      ok: false,
      reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE',
      message: 'That remembered monitor is not visible right now.',
    };
  }
  const byPath = fingerprint.devicePath
    ? displays.filter(item => clean(item.devicePath) === fingerprint.devicePath)
    : [];
  if (byPath.length === 1) return { ok: true, display: byPath[0]!, confidence: 'HIGH' };
  if (byPath.length > 1) {
    return { ok: false, reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE', message: 'More than one display matches that stored path. I will not guess.' };
  }

  const byEdid = fingerprint.edidKey
    ? displays.filter(item => edidKeyOf(item) === fingerprint.edidKey)
    : [];
  if (byEdid.length === 1) return { ok: true, display: byEdid[0]!, confidence: 'HIGH' };
  if (byEdid.length > 1) {
    return { ok: false, reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE', message: 'More than one display matches that stored identity. I will not guess.' };
  }

  const byNameAndSize = displays.filter(item => (
    (clean(item.deviceName || item.name || item.id) === fingerprint.deviceName)
    && item.width === fingerprint.size.width
    && item.height === fingerprint.size.height
  ));
  if (byNameAndSize.length === 1) return { ok: true, display: byNameAndSize[0]!, confidence: 'MEDIUM' };

  return {
    ok: false,
    reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE',
    message: 'I remember that monitor alias, but the physical display is not connected or its identity changed. I will not remap it silently.',
  };
}

export function describeDisplays(displays: DisplayInfo[]): string {
  if (!displays.length) return 'I cannot see any displays right now.';
  return displays.map((item, index) => {
    const bits = [
      `${index + 1}. ${item.width}x${item.height} at ${item.x},${item.y}`,
      item.primary ? 'primary' : '',
      item.internal === true ? 'internal' : '',
      item.deviceName || item.name ? item.deviceName || item.name : '',
    ].filter(Boolean);
    return bits.join(' · ');
  }).join('\n');
}

function edidKeyOf(display: Pick<DisplayInfo, 'manufacturer' | 'model' | 'serial'>): string | undefined {
  const manufacturer = clean(display.manufacturer);
  const model = clean(display.model);
  const serial = clean(display.serial);
  if (!manufacturer || !model || !serial) return undefined;
  return `${manufacturer}:${model}:${serial}`;
}

function clean(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function stableKey(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + value.length.toString(16).padStart(4, '0');
}
