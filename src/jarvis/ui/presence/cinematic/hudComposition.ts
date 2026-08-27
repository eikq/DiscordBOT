import type { PresenceHudKind, PresencePhase } from '../presenceRuntime';

export type PresenceHudZone =
  | 'TOP_LEFT'
  | 'TOP_RIGHT'
  | 'MID_LEFT'
  | 'MID_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_RIGHT'
  | 'FOREFRONT';

export type PresenceHudPriority =
  | 'EMERGENCY'
  | 'PERMISSION'
  | 'CRITICAL'
  | 'EXECUTION'
  | 'RESEARCH'
  | 'CONTEXT'
  | 'IDLE';

export type PresenceHudSlot = {
  kind: PresenceHudKind | 'permission';
  zone: PresenceHudZone;
  priority: PresenceHudPriority;
  depth: 0 | 1 | 2 | 3 | 4 | 5;
};

const KIND_PRIORITY: Record<PresenceHudKind | 'permission', PresenceHudPriority> = {
  none: 'IDLE',
  permission: 'PERMISSION',
  'waiting-input': 'PERMISSION',
  execution: 'EXECUTION',
  verification: 'EXECUTION',
  research: 'RESEARCH',
  attention: 'CRITICAL',
  system: 'CONTEXT',
  reminder: 'CONTEXT',
  cctv: 'CONTEXT',
  media: 'CONTEXT',
  desktop: 'CONTEXT',
};

const KIND_ZONE: Record<PresenceHudKind | 'permission', PresenceHudZone> = {
  none: 'MID_RIGHT',
  permission: 'FOREFRONT',
  'waiting-input': 'FOREFRONT',
  execution: 'TOP_RIGHT',
  verification: 'TOP_RIGHT',
  research: 'MID_RIGHT',
  attention: 'TOP_LEFT',
  system: 'MID_LEFT',
  reminder: 'BOTTOM_LEFT',
  cctv: 'BOTTOM_RIGHT',
  media: 'BOTTOM_RIGHT',
  desktop: 'BOTTOM_RIGHT',
};

const KIND_DEPTH: Record<PresenceHudKind | 'permission', PresenceHudSlot['depth']> = {
  none: 0,
  permission: 5,
  'waiting-input': 5,
  execution: 4,
  verification: 4,
  research: 4,
  attention: 5,
  system: 3,
  reminder: 3,
  cctv: 3,
  media: 3,
  desktop: 3,
};

const PRIORITY_RANK: Record<PresenceHudPriority, number> = {
  EMERGENCY: 0,
  PERMISSION: 1,
  CRITICAL: 2,
  EXECUTION: 3,
  RESEARCH: 4,
  CONTEXT: 5,
  IDLE: 6,
};

export function hudPriorityFor(kind: PresenceHudKind | 'permission', emergency = false): PresenceHudPriority {
  if (emergency) return 'EMERGENCY';
  return KIND_PRIORITY[kind];
}

export function composePresenceHud(input: {
  kind: PresenceHudKind;
  permission?: boolean;
  emergency?: boolean;
  phase?: PresencePhase;
}): PresenceHudSlot | null {
  if (input.emergency) {
    return { kind: 'attention', zone: 'FOREFRONT', priority: 'EMERGENCY', depth: 5 };
  }
  if (input.permission || input.kind === 'permission' || input.phase === 'WAITING_OWNER') {
    return { kind: 'permission', zone: 'FOREFRONT', priority: 'PERMISSION', depth: 5 };
  }
  if (input.kind === 'none') return null;
  return {
    kind: input.kind,
    zone: KIND_ZONE[input.kind],
    priority: KIND_PRIORITY[input.kind],
    depth: KIND_DEPTH[input.kind],
  };
}

export function permissionSupersedesResearch(slot: PresenceHudSlot | null): boolean {
  return Boolean(slot && (slot.kind === 'permission' || slot.priority === 'PERMISSION' || slot.priority === 'EMERGENCY'));
}

export function permissionHidesContextChrome(input: {
  waitingPermission?: boolean;
  hudKind?: string;
  phase?: string;
}): boolean {
  return Boolean(
    input.waitingPermission
    || input.hudKind === 'permission'
    || input.phase === 'WAITING_OWNER',
  );
}

export function compareHudPriority(a: PresenceHudPriority, b: PresenceHudPriority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
