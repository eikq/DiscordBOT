export const PRESENCE_LAYERS = {
  webgl: 0,
  ambient: 5,
  hud: 20,
  side: 30,
  dock: 40,
  scrim: 80,
  modal: 100,
  toast: 120,
} as const;

export type PresenceBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function boxesOverlap(a: PresenceBox, b: PresenceBox): boolean {
  return a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;
}

export function permissionFooterReachable(input: {
  permissionOpen: boolean;
  contextHiddenWhilePermission: boolean;
  modalFooter: PresenceBox;
  context?: PresenceBox;
  history?: PresenceBox;
  build?: PresenceBox;
  canvas?: PresenceBox;
  canvasPointerEvents: 'none' | 'auto';
}): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (!input.permissionOpen) return { ok: true, blockers };
  if (input.canvas && input.canvasPointerEvents !== 'none' && boxesOverlap(input.modalFooter, input.canvas)) {
    blockers.push('webgl-canvas');
  }
  if (input.context && !input.contextHiddenWhilePermission && boxesOverlap(input.modalFooter, input.context)) {
    blockers.push('jarvis-context');
  }
  if (input.history && boxesOverlap(input.modalFooter, input.history)) blockers.push('history');
  if (input.build && boxesOverlap(input.modalFooter, input.build)) blockers.push('build');
  return { ok: blockers.length === 0, blockers };
}

export function livePendingConfirmation<T extends {
  proposalId?: string;
  token?: string;
  expiresAt?: string;
}>(
  pending: T | null | undefined,
  options: { now?: number; requireExpiry?: boolean } = {},
): T | null {
  const proposalId = pending?.proposalId;
  if (!pending || !proposalId || !pending.token) return null;
  if (options.requireExpiry && !pending.expiresAt) return null;
  if (pending.expiresAt) {
    const expires = Date.parse(pending.expiresAt);
    if (!Number.isFinite(expires) || expires <= (options.now ?? Date.now())) return null;
  }
  return pending;
}
