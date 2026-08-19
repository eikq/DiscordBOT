/** View-model types + formatters for the lab operations panels (real data only). */

export type SystemHealthView = {
  at: number;
  cpu?: { usagePct: number; cores: number };
  ram?: { totalMb: number; freeMb: number; usedPct: number };
  disk?: { totalGb: number; freeGb: number; usedPct: number };
  gpu?: { name: string; utilizationPct?: number; vramUsedMb?: number; vramTotalMb?: number };
  gpuUnavailableReason?: string;
  battery?: {
    status: 'ok' | 'unavailable';
    percent?: number;
    charging?: boolean;
    pluggedIn?: boolean;
    state?: string;
    reason?: string;
  };
  network?: {
    status: 'ok' | 'unavailable';
    available?: boolean;
    interfaceClass?: 'wifi' | 'ethernet' | 'other';
    reason?: string;
  };
  process?: { rssMb: number; uptimeSec: number };
};

export type LabServiceView = {
  id: string;
  displayName: string;
  health: string;
  lifecycle: string;
  reason?: string;
  startAllowed: boolean;
  stopAllowed: boolean;
  restartAllowed: boolean;
};

export function labServiceShortName(id: string): string {
  if (id === 'ollama') return 'QWEN';
  if (id === 'qwen-asr') return 'ASR';
  if (id === 'jarvis-tts') return 'TTS';
  if (id === 'rvc') return 'RVC';
  if (id === 'embedding') return 'EMBED';
  if (id === 'jarvis-lab') return 'LAB';
  if (id === 'core') return 'CORE';
  return id.toUpperCase();
}

export function labServiceStateLabel(service: Pick<LabServiceView, 'health' | 'lifecycle'>): string {
  if (service.lifecycle === 'STARTING') return 'starting';
  if (service.lifecycle === 'STOPPING') return 'stopping';
  if (service.lifecycle === 'DEGRADED') return 'degraded';
  if (service.health === 'healthy') return 'ready';
  if (service.health === 'offline') return 'offline';
  if (service.health === 'degraded') return 'degraded';
  return 'unavailable';
}

export type NightAgentView = {
  available: boolean;
  reason?: string;
  status?: string;
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  workspaceRoot?: string;
  provider?: string;
  model?: string;
  currentTaskId?: string;
  counts?: { total: number; pass: number; blocked: number; other: number };
  tasks?: Array<{ id: string; title: string; status: string; attempts: number; filesChanged: number }>;
};

export function formatMb(mb?: number): string {
  if (typeof mb !== 'number' || !Number.isFinite(mb) || mb < 0) return 'unknown';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function formatPct(pct?: number): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return '—';
  return `${Math.round(pct)}%`;
}

export function formatClock(iso?: string): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatAgo(epochMs?: number, now = Date.now()): string {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs) || epochMs <= 0) return '';
  const delta = Math.max(0, now - epochMs);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

/**
 * Match a turn tool result to a registered capability node id.
 * Only exact ids or registry prefixes are used — no invented mapping.
 */
export type ReminderListItem = {
  id: string;
  title: string;
  status: string;
  nextRunAt: string | null;
  schedule: { kind: string; localTime?: string };
};

export type PendingReminderDelivery = {
  reminderId: string;
  occurrenceAt: string;
  title: string;
  message: string;
  scheduledLocal: string;
  kind: 'on_time' | 'missed';
  recurrence: string;
};

export type ReminderSnapshotView = {
  scheduler: {
    healthy: boolean;
    attached: boolean;
    timezone: string;
    nextRunAt: string | null;
    activeCount: number;
    pendingCount: number;
    reason?: string;
  };
  reminders: ReminderListItem[];
  pendingDeliveries: PendingReminderDelivery[];
};

export function reminderScheduleTag(item: ReminderListItem): string {
  if (item.schedule.kind === 'daily') return 'DAILY';
  if (item.schedule.kind === 'weekly') return 'WEEKLY';
  if (item.schedule.kind === 'weekdays') return 'WEEKDAYS';
  return '';
}

export type LabResearchSource = {
  sourceId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  updatedAt?: string | null;
  fetchedAt: string | null;
  sourceClass: string;
  status: string;
  cached: boolean;
};

export type LabResearchEvidence = {
  evidenceId: string;
  sourceId: string;
  excerpt: string;
  publishedAt: string | null;
  fetchedAt: string | null;
  kind: string;
};

export type LabResearchSnapshot = {
  attached: boolean;
  healthy: boolean;
  reason?: string;
  last?: {
    query: string;
    sources: LabResearchSource[];
    evidence: LabResearchEvidence[];
    stages: Array<{ id: string; label: string; detail: string; state: string }>;
    researchedAt: string;
    cached: boolean;
    uncertainty: string[];
  };
};

export type LabWorkspaceDocument = {
  documentId: string;
  workspaceId: string;
  relativePath: string;
  displayName: string;
  fileType: string;
  modifiedAt: string;
  indexStatus: string;
  stale?: boolean;
};

export type LabWorkspaceEvidence = {
  evidenceId: string;
  documentId: string;
  relativePath: string;
  excerpt: string;
  lineStart?: number;
  lineEnd?: number;
  heading?: string;
  kind: string;
};

export type LabWorkspaceSnapshot = {
  attached: boolean;
  healthy: boolean;
  reason?: string;
  workspaceId?: string;
  displayName?: string;
  documentCount?: number;
  changedCount?: number;
  indexStatus?: string;
  last?: {
    query: string;
    documents: LabWorkspaceDocument[];
    evidence: LabWorkspaceEvidence[];
    stages: Array<{ id: string; label: string; detail: string; state: string }>;
    researchedAt: string;
    stale: boolean;
    uncertainty: string[];
  };
};

export function researchClassLabel(sourceClass: string): string {
  if (sourceClass === 'OFFICIAL' || sourceClass === 'PRIMARY') return 'official';
  if (sourceClass === 'ACADEMIC') return 'academic';
  if (sourceClass === 'NEWS') return 'news';
  if (sourceClass === 'REFERENCE') return 'reference';
  if (sourceClass === 'COMMUNITY') return 'community';
  return 'unknown';
}

export function reminderLocalTime(nextRunAt: string | null, timezone?: string): string {
  if (!nextRunAt) return '—';
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
}

export function matchToolNodeId(toolName: string, registeredIds: string[]): string | null {
  if (registeredIds.includes(toolName)) return toolName;
  const prefix = registeredIds.find(id => toolName.startsWith(`${id}.`) || id.startsWith(`${toolName}.`));
  return prefix ?? null;
}
