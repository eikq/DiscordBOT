/**
 * Presentation-safe facts copied from this-turn capability results.
 * Never include tokens, CoT, hwnd, process names, or leftover research.
 */
export type CapabilitySystemFacts = {
  summary?: string;
  parts?: string[];
  cpu?: { usagePct: number; cores: number };
  ram?: { usedPct: number; freeMb?: number; totalMb?: number };
  disk?: { usedPct?: number; freeGb?: number; totalGb?: number };
  gpu?: { name: string; utilizationPct?: number; vramUsedMb?: number; vramTotalMb?: number };
};

export type CapabilityDisplayFacts = {
  count: number;
  ids: string[];
  names?: string[];
  currentName?: string;
  currentId?: string;
  hostKind?: string;
  reason?: string;
};

export type CapabilityPresentationFacts = {
  capabilityId: string;
  systemSnapshot?: CapabilitySystemFacts;
  displays?: CapabilityDisplayFacts;
};

const FORBIDDEN_FACT_KEYS = /hwnd|processName|windowTitle|^pid$|processId|confirmToken|token|cookie|scratchpad|chainOfThought|reasoning/iu;

export function capabilityPresentationFacts(
  capabilityId: string,
  structured: unknown,
  content?: string,
): CapabilityPresentationFacts | undefined {
  if (!capabilityId || FORBIDDEN_FACT_KEYS.test(capabilityId)) return undefined;
  const root = asRecord(structured);
  if (capabilityId === 'system.status') {
    const snapshot = asRecord(root?.snapshot) ?? root;
    const systemSnapshot = systemFactsFrom(snapshot, content);
    if (!systemSnapshot) return undefined;
    return { capabilityId, systemSnapshot };
  }
  if (capabilityId === 'desktop.listDisplays') {
    const displays = displayFactsFromList(root);
    if (!displays) return undefined;
    return { capabilityId, displays };
  }
  if (capabilityId === 'desktop.getJarvisWindow') {
    const displays = displayFactsFromWindow(root);
    if (!displays) return undefined;
    return { capabilityId, displays };
  }
  return undefined;
}

export function mergeCapabilityPresentationFacts(
  items: Array<CapabilityPresentationFacts | undefined>,
): { systemSnapshot?: CapabilitySystemFacts; displays?: CapabilityDisplayFacts } {
  let systemSnapshot: CapabilitySystemFacts | undefined;
  let displays: CapabilityDisplayFacts | undefined;
  for (const item of items) {
    if (!item) continue;
    if (item.systemSnapshot) systemSnapshot = { ...systemSnapshot, ...item.systemSnapshot };
    if (item.displays) {
      const nextCount = item.displays.count > 0 ? item.displays.count : (displays?.count ?? 0);
      const nextIds = item.displays.ids.length > 0 ? item.displays.ids : (displays?.ids ?? []);
      displays = {
        count: nextCount,
        ids: nextIds,
        names: item.displays.names?.length ? item.displays.names : displays?.names,
        currentName: item.displays.currentName ?? displays?.currentName,
        currentId: item.displays.currentId ?? displays?.currentId,
        hostKind: item.displays.hostKind ?? displays?.hostKind,
        reason: item.displays.reason ?? displays?.reason,
      };
    }
  }
  return { ...(systemSnapshot ? { systemSnapshot } : {}), ...(displays ? { displays } : {}) };
}

function systemFactsFrom(snapshot: Record<string, unknown> | undefined, content?: string): CapabilitySystemFacts | undefined {
  if (!snapshot) {
    return content?.trim() ? { summary: clip(content, 360) } : undefined;
  }
  const cpu = numericPair(snapshot.cpu, 'usagePct', 'cores');
  const ramRaw = asRecord(snapshot.ram);
  const diskRaw = asRecord(snapshot.disk);
  const gpuRaw = asRecord(snapshot.gpu);
  const ram = ramRaw && typeof ramRaw.usedPct === 'number'
    ? {
      usedPct: ramRaw.usedPct,
      ...(typeof ramRaw.freeMb === 'number' ? { freeMb: ramRaw.freeMb } : {}),
      ...(typeof ramRaw.totalMb === 'number' ? { totalMb: ramRaw.totalMb } : {}),
    }
    : undefined;
  const disk = diskRaw && (typeof diskRaw.usedPct === 'number' || typeof diskRaw.freeGb === 'number')
    ? {
      ...(typeof diskRaw.usedPct === 'number' ? { usedPct: diskRaw.usedPct } : {}),
      ...(typeof diskRaw.freeGb === 'number' ? { freeGb: diskRaw.freeGb } : {}),
      ...(typeof diskRaw.totalGb === 'number' ? { totalGb: diskRaw.totalGb } : {}),
    }
    : undefined;
  const gpu = gpuRaw && typeof gpuRaw.name === 'string'
    ? {
      name: gpuRaw.name,
      ...(typeof gpuRaw.utilizationPct === 'number' ? { utilizationPct: gpuRaw.utilizationPct } : {}),
      ...(typeof gpuRaw.vramUsedMb === 'number' ? { vramUsedMb: gpuRaw.vramUsedMb } : {}),
      ...(typeof gpuRaw.vramTotalMb === 'number' ? { vramTotalMb: gpuRaw.vramTotalMb } : {}),
    }
    : undefined;
  const parts = [
    cpu ? `CPU ${cpu.usagePct}% (${cpu.cores} cores)` : undefined,
    ram ? `RAM ${ram.usedPct}% used${ram.freeMb !== undefined ? `, ${ram.freeMb} MB free` : ''}` : undefined,
    disk ? (disk.freeGb !== undefined ? `Disk ${disk.freeGb} GB free` : `Disk ${disk.usedPct}% used`) : undefined,
    gpu ? `GPU ${gpu.name}${gpu.utilizationPct !== undefined ? ` ${gpu.utilizationPct}%` : ''}` : undefined,
  ].filter((item): item is string => Boolean(item));
  if (!cpu && !ram && !disk && !gpu && parts.length === 0 && !content?.trim()) return undefined;
  return {
    ...(content?.trim() ? { summary: clip(content, 360) } : parts.length ? { summary: clip(parts.join(' · '), 360) } : {}),
    ...(parts.length ? { parts } : {}),
    ...(cpu ? { cpu } : {}),
    ...(ram ? { ram } : {}),
    ...(disk ? { disk } : {}),
    ...(gpu ? { gpu } : {}),
  };
}

function displayFactsFromList(root: Record<string, unknown> | undefined): CapabilityDisplayFacts | undefined {
  const rows = Array.isArray(root?.displays) ? root!.displays : [];
  const parsed = rows.flatMap(row => {
    const item = asRecord(row);
    if (!item) return [];
    const id = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
    if (!id) return [];
    return [{ id, name: typeof item.name === 'string' ? item.name : id }];
  });
  return {
    count: parsed.length,
    ids: parsed.map(item => item.id),
    names: parsed.map(item => item.name),
    ...(typeof root?.hostKind === 'string' ? { hostKind: root.hostKind } : {}),
    ...(typeof root?.reasonCode === 'string' ? { reason: root.reasonCode } : {}),
  };
}

function displayFactsFromWindow(root: Record<string, unknown> | undefined): CapabilityDisplayFacts | undefined {
  const window = asRecord(root?.window);
  const display = asRecord(root?.display);
  const currentId = str(window?.displayId) || str(display?.id);
  const currentName = str(window?.displayName) || str(display?.name);
  if (!currentId && !currentName && typeof root?.hostKind !== 'string') return undefined;
  return {
    count: 0,
    ids: currentId ? [currentId] : [],
    currentId,
    currentName,
    ...(typeof root?.hostKind === 'string' ? { hostKind: root.hostKind } : {}),
    ...(typeof root?.reasonCode === 'string' ? { reason: root.reasonCode } : {}),
  };
}

function numericPair(value: unknown, a: string, b: string): { usagePct: number; cores: number } | undefined {
  const rec = asRecord(value);
  if (!rec || typeof rec[a] !== 'number' || typeof rec[b] !== 'number') return undefined;
  return { usagePct: rec[a] as number, cores: rec[b] as number };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}
