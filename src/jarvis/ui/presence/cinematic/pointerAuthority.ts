/**
 * Pointer / hover / inspect interaction is presentation only.
 * It must never grant, deny, confirm, or invent runtime authority.
 */

export type PresencePointerIntent = 'hover' | 'select' | 'inspect-drag' | 'parallax';

export function pointerChangesRuntimeAuthority(_intent: PresencePointerIntent): false {
  return false;
}

export function pointerMayGrantPermission(): false {
  return false;
}

export function inspectDragEnabled(search: string): boolean {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return raw.get('inspect') === '1' && raw.get('visualDebug') === '1';
}

export function visualDebugEnabled(search: string): boolean {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return raw.get('visualDebug') === '1';
}
