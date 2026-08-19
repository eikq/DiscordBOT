/**
 * Deterministic /jarvis-lab UI mapping.
 * Only observable frontend/API state — no invented telemetry or hidden chain-of-thought.
 */

export type LabCorePhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'memory'
  | 'tool'
  | 'responding'
  | 'speaking'
  | 'degraded'
  | 'error';

export type RibbonTone = 'ok' | 'warn' | 'off' | 'critical';

export type SystemRibbonItem = {
  id: 'local' | 'qwen' | 'memory' | 'tools' | 'voice' | 'mic';
  label: string;
  value: string;
  lit: boolean;
  tone: RibbonTone;
};

export type TimelineStageId = 'request' | 'memory' | 'tool' | 'model' | 'response';
export type TimelineStageState = 'pending' | 'active' | 'done' | 'empty' | 'failed';

export type TimelineStage = {
  id: TimelineStageId;
  label: string;
  state: TimelineStageState;
};

export type LabMemoryRef = {
  canonicalId: string;
  type?: string;
  confidence?: number;
  sourceRefs?: string[];
  status?: string;
  domain?: string;
};

export type LabToolResult = {
  toolName: string;
  status: string;
  summary?: string;
  sourceUrls?: string[];
};

export type LabActionResult = {
  name: string;
  status: string;
  detail?: string;
  summary?: string;
  risk?: string;
  capabilityId?: string;
  proposalId?: string;
};

export type LabPendingConfirmation = {
  proposalId: string;
  token: string;
  capabilityId: string;
  displayName: string;
  summary: string;
  target: string;
  risk: string;
  reason: string;
  expiresAt: string;
};

export type LabCapabilityCatalogItem = {
  id: string;
  providerKind?: string;
  untrustedOutput?: boolean;
  requiredService?: string;
};

export type EnrichedToolActivity = {
  id: string;
  status: string;
  summary?: string;
  sourceUrls: string[];
  provider?: string;
  untrusted: boolean;
  failed: boolean;
};

const TIMELINE_ORDER: Array<{ id: TimelineStageId; label: string }> = [
  { id: 'request', label: 'REQUEST' },
  { id: 'memory', label: 'MEMORY' },
  { id: 'tool', label: 'TOOL' },
  { id: 'model', label: 'MODEL' },
  { id: 'response', label: 'RESPONSE' },
];

export function deriveLabCorePhase(input: {
  busy: boolean;
  error: string | null;
  statusReady?: boolean;
  llmReachable?: boolean;
  coreState?: string;
  hasResponse: boolean;
  memoryCount: number;
  toolCount: number;
  micState?: 'idle' | 'listening' | 'transcribing';
  speechState?: 'idle' | 'loading' | 'speaking';
}): LabCorePhase {
  if (input.error) return 'error';
  if (input.micState === 'transcribing') return 'transcribing';
  if (input.busy) return 'thinking';
  if (input.speechState === 'speaking') return 'speaking';
  if (input.micState === 'listening') return 'listening';
  if (input.statusReady === false) return 'degraded';
  if (input.llmReachable === false && !input.hasResponse) return 'degraded';
  if (input.coreState === 'degraded' && !input.hasResponse) return 'degraded';
  if (!input.hasResponse) return 'idle';
  if (input.toolCount > 0 && input.memoryCount === 0) return 'tool';
  if (input.memoryCount > 0 && input.toolCount === 0) return 'memory';
  return 'responding';
}

export function labCorePhaseLabel(phase: LabCorePhase): string {
  return phase;
}

export function deriveSystemRibbon(input: {
  llmReachable?: boolean;
  llmModel?: string;
  memoryAttached?: boolean;
  memorySchemaVersion?: number;
  toolCount?: number;
  speechActive?: boolean;
  voiceAvailable?: boolean;
  voiceRuntime?: 'selected' | 'loading' | 'ready' | 'speaking' | 'unavailable' | 'degraded';
  micAvailable?: boolean;
  micState?: 'idle' | 'listening' | 'transcribing' | 'permission-denied' | 'unavailable';
  sttReachable?: boolean;
}): SystemRibbonItem[] {
  const qwenKnown = typeof input.llmReachable === 'boolean';
  const qwenLit = input.llmReachable === true;
  const memoryKnown = typeof input.memoryAttached === 'boolean';
  const memoryLit = input.memoryAttached === true;
  const toolsKnown = typeof input.toolCount === 'number';
  const toolCount = input.toolCount ?? 0;
  return [
    { id: 'local', label: 'LOCAL', value: 'host', lit: true, tone: 'ok' },
    {
      id: 'qwen',
      label: 'QWEN',
      value: qwenLit ? compactModelName(input.llmModel) : qwenKnown ? 'offline' : '…',
      lit: qwenLit,
      tone: qwenLit ? 'ok' : qwenKnown ? 'warn' : 'off',
    },
    {
      id: 'memory',
      label: 'MEMORY',
      value: memoryLit ? `v${input.memorySchemaVersion ?? '?'}` : memoryKnown ? 'off' : '…',
      lit: memoryLit,
      tone: memoryLit ? 'ok' : 'off',
    },
    {
      id: 'tools',
      label: 'TOOLS',
      value: toolsKnown ? String(toolCount) : '…',
      lit: toolCount > 0,
      tone: toolCount > 0 ? 'ok' : 'off',
    },
    {
      id: 'voice',
      label: 'VOICE',
      value: voiceRibbonValue(input.voiceRuntime, input.speechActive, input.voiceAvailable),
      lit: input.voiceRuntime === 'speaking' || input.voiceRuntime === 'ready' || Boolean(input.speechActive),
      tone: input.voiceRuntime === 'unavailable' || input.voiceRuntime === 'degraded'
        ? 'warn'
        : (input.voiceRuntime === 'speaking' || input.voiceRuntime === 'ready' || input.speechActive ? 'ok' : 'off'),
    },
    {
      id: 'mic',
      label: 'MIC',
      value: micRibbonValue(input.micState, input.micAvailable, input.sttReachable),
      lit: input.micState === 'listening' || input.micState === 'transcribing',
      tone: input.micState === 'permission-denied' || input.micState === 'unavailable' || input.sttReachable === false
        ? 'warn'
        : (input.micState === 'listening' || input.micState === 'transcribing' ? 'ok' : 'off'),
    },
  ];
}

export function deriveActivityTimeline(input: {
  busy: boolean;
  hasResponse: boolean;
  memoryCount: number;
  toolCount: number;
  toolFailed: boolean;
  hasPresentedText: boolean;
}): TimelineStage[] {
  return TIMELINE_ORDER.map(({ id, label }) => ({
    id,
    label,
    state: timelineState(id, input),
  }));
}

export type PipelineStageId = 'request' | 'memory' | 'tool' | 'model' | 'presentation' | 'speech';

export type PipelineStage = {
  id: PipelineStageId;
  label: string;
  state: TimelineStageState;
};

/**
 * Observable command pipeline: REQUEST → MEMORY → TOOL → MODEL →
 * PRESENTATION → SPEECH. Mid-flight requests only mark REQUEST active;
 * completed stages come from real turn evidence, never invented telemetry.
 */
export function derivePipelineStages(input: {
  busy: boolean;
  hasResponse: boolean;
  memoryCount: number;
  toolCount: number;
  toolFailed: boolean;
  hasPresentedText: boolean;
  speech: 'off' | 'loading' | 'spoken' | 'failed';
}): PipelineStage[] {
  const base = deriveActivityTimeline(input);
  const byId = new Map(base.map(stage => [stage.id, stage.state]));
  const speechState: TimelineStageState = input.busy
    ? 'pending'
    : input.speech === 'spoken'
      ? 'done'
      : input.speech === 'loading'
        ? 'active'
        : input.speech === 'failed'
          ? 'failed'
          : input.hasResponse ? 'empty' : 'pending';
  return [
    { id: 'request', label: 'REQUEST', state: byId.get('request') ?? 'pending' },
    { id: 'memory', label: 'MEMORY', state: byId.get('memory') ?? 'pending' },
    { id: 'tool', label: 'TOOL', state: byId.get('tool') ?? 'pending' },
    { id: 'model', label: 'MODEL', state: byId.get('model') ?? 'pending' },
    { id: 'presentation', label: 'PRESENTATION', state: byId.get('response') ?? 'pending' },
    { id: 'speech', label: 'SPEECH', state: speechState },
  ];
}

export function formatConfidence(confidence?: number): string | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0) return null;
  const pct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  return `${pct}%`;
}

export function actionActivityLabel(action: LabActionResult): string {
  if (action.status === 'confirmation_required') return 'Permission required';
  if (action.status === 'denied') return action.summary || 'Action denied';
  if (action.status === 'unavailable') return action.summary || 'Unavailable';
  if (action.status === 'failed') return action.summary || 'Action failed';
  if (action.status === 'completed') return action.summary || action.name;
  return action.summary || action.name;
}

export function isExplicitActionConfirmation(text: string): boolean {
  return /^(yes|y|ok|okay|allow|allow once|ได้|ตกลง|อนุญาต|เปิดได้|เอาเลย|ใช่)$/iu.test(text.trim());
}

export function enrichToolActivity(
  tool: LabToolResult,
  catalog: LabCapabilityCatalogItem[] = [],
): EnrichedToolActivity {
  const meta = catalog.find(item => item.id === tool.toolName);
  const untrusted = Boolean(meta?.untrustedOutput) || /untrusted/i.test(tool.summary ?? '');
  return {
    id: tool.toolName,
    status: tool.status,
    summary: tool.summary,
    sourceUrls: tool.sourceUrls ?? [],
    ...(meta?.providerKind ? { provider: meta.providerKind } : {}),
    untrusted,
    failed: tool.status !== 'ok',
  };
}

export function formatLatencyMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 3)}s`;
}

export function formatTurnTimingsLine(timings?: {
  captureMs?: number;
  utteranceFinalizeMs?: number;
  sttMs?: number;
  memoryRetrievalMs?: number;
  capabilityExecutionMs?: number;
  llmTtftMs?: number;
  llmPromptEvalMs?: number;
  llmGenerationMs?: number;
  llmLoadMs?: number;
  llmMs?: number;
  presentationMs?: number;
  sourceTtsMs?: number;
  rvcMs?: number;
  totalMs?: number;
} | null, llm?: {
  promptTokens?: number;
  outputTokens?: number;
  tokensPerSec?: number;
} | null): string | null {
  if (!timings && !llm) return null;
  const parts: string[] = [];
  const push = (label: string, value?: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    parts.push(`${label} ${formatLatencyMs(value)}`);
  };
  push('capture', timings?.captureMs);
  push('end-sil', timings?.utteranceFinalizeMs);
  push('stt', timings?.sttMs);
  push('mem', timings?.memoryRetrievalMs);
  push('tool', timings?.capabilityExecutionMs);
  push('ttft', timings?.llmTtftMs);
  push('prefill', timings?.llmPromptEvalMs);
  push('gen', timings?.llmGenerationMs);
  push('load', timings?.llmLoadMs);
  push('llm', timings?.llmMs);
  push('present', timings?.presentationMs);
  push('tts', timings?.sourceTtsMs);
  push('rvc', timings?.rvcMs);
  push('total', timings?.totalMs);
  if (typeof llm?.promptTokens === 'number') parts.push(`prompt ${llm.promptTokens}t`);
  if (typeof llm?.outputTokens === 'number') parts.push(`out ${llm.outputTokens}t`);
  if (typeof llm?.tokensPerSec === 'number' && Number.isFinite(llm.tokensPerSec) && llm.tokensPerSec > 0) {
    parts.push(`${llm.tokensPerSec.toFixed(1)} tok/s`);
  }
  return parts.length ? parts.join(' · ') : null;
}

function compactModelName(model?: string): string {
  if (!model) return 'ready';
  return model.length > 32 ? `${model.slice(0, 30)}…` : model;
}

function voiceRibbonValue(
  runtime?: 'selected' | 'loading' | 'ready' | 'speaking' | 'unavailable' | 'degraded',
  speechActive?: boolean,
  voiceAvailable?: boolean,
): string {
  if (runtime) return runtime;
  if (speechActive) return 'ready';
  if (voiceAvailable) return 'selected';
  return 'idle';
}

function micRibbonValue(
  micState?: 'idle' | 'listening' | 'transcribing' | 'permission-denied' | 'unavailable',
  micAvailable?: boolean,
  sttReachable?: boolean,
): string {
  if (micState === 'listening') return 'listening';
  if (micState === 'transcribing') return 'transcribing';
  if (micState === 'permission-denied') return 'denied';
  if (micState === 'unavailable') return 'unavailable';
  if (sttReachable === false) return 'stt-off';
  if (micAvailable === false) return 'unavailable';
  return typeof sttReachable === 'boolean' ? (sttReachable ? 'ready' : 'stt-off') : '…';
}

function timelineState(
  id: TimelineStageId,
  input: {
    busy: boolean;
    hasResponse: boolean;
    memoryCount: number;
    toolCount: number;
    toolFailed: boolean;
    hasPresentedText: boolean;
  },
): TimelineStageState {
  if (input.busy) {
    return id === 'request' ? 'active' : 'pending';
  }
  if (!input.hasResponse) return 'pending';
  switch (id) {
    case 'request':
      return 'done';
    case 'memory':
      return input.memoryCount > 0 ? 'done' : 'empty';
    case 'tool':
      if (input.toolCount === 0) return 'empty';
      return input.toolFailed ? 'failed' : 'done';
    case 'model':
    case 'response':
      return input.hasPresentedText ? 'done' : 'empty';
    default:
      return 'pending';
  }
}
