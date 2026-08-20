export const PRESENTATION_MODES = [
  'summary',
  'comparison',
  'walkthrough',
  'report',
  'recommendation',
] as const;

export type PresentationMode = (typeof PRESENTATION_MODES)[number];

export const PRESENTATION_DENSITIES = ['plain', 'rich', 'briefing'] as const;
export type PresentationDensity = (typeof PRESENTATION_DENSITIES)[number];

export type PresentationTargetType =
  | 'section'
  | 'card'
  | 'graph-node'
  | 'recommendation'
  | 'source'
  | 'metric';

export type PresentationTarget = {
  type: PresentationTargetType;
  id: string;
};

export type PresentationCardKind = 'finding' | 'evidence' | 'risk' | 'action' | 'note';

export type PresentationCard = {
  id: string;
  title: string;
  body: string;
  kind: PresentationCardKind;
  refs?: string[];
};

export type PresentationSection = {
  id: string;
  title: string;
  kind: 'summary' | 'findings' | 'evidence' | 'risks' | 'actions' | 'followups' | 'comparison' | 'quality' | 'timeline';
  body: string;
  cards?: string[];
};

export type PresentationEvidenceRef = {
  id: string;
  label: string;
  url?: string;
  note?: string;
};

export type PresentationTable = {
  id: string;
  title: string;
  headers: string[];
  rows: string[][];
};

export type NarrationSegmentKind = 'summary' | 'section' | 'extended' | 'finish';

export const NARRATION_PLAYBACK_STATES = [
  'idle',
  'playing',
  'completed',
  'cancelled',
  'pause_unsupported',
] as const;

export type NarrationPlaybackStatus = (typeof NARRATION_PLAYBACK_STATES)[number];

export type NarrationPlaybackState = {
  presentationId: string;
  segmentId: string;
  segmentIndex: number;
  spokenAtMs: number;
  estimatedDurationMs: number;
  actualSpeechDurationMs?: number;
  playbackState: NarrationPlaybackStatus;
  targetId: string;
  motionCue?: MotionCueAction;
  pauseSupported: false;
};

export type NarrationSegment = {
  id: string;
  order: number;
  text: string;
  kind: NarrationSegmentKind;
  target: PresentationTarget;
  estimatedMs: number;
};

export type MotionCueAction =
  | 'highlight'
  | 'focus'
  | 'zoom'
  | 'scroll'
  | 'pulse'
  | 'expand'
  | 'collapse'
  | 'spotlight';

export type MotionCue = {
  id: string;
  segmentId: string;
  atMs: number;
  action: MotionCueAction;
  target: PresentationTarget;
  reducedMotion: 'skip' | 'instant';
};

export type PresentationFollowUpId =
  | 'explain'
  | 'expand'
  | 'compare'
  | 'shorten'
  | 'repeat'
  | 'back'
  | 'show-source'
  | 'focus-recommendations';

export type PresentationFollowUp = {
  id: PresentationFollowUpId;
  label: string;
  targetId?: string;
};

export type PresentationModel = {
  id: string;
  title: string;
  subtitle?: string;
  mode: PresentationMode;
  density: Exclude<PresentationDensity, 'plain'>;
  summary: string;
  spokenSummary: string;
  sections: PresentationSection[];
  cards: PresentationCard[];
  evidence: PresentationEvidenceRef[];
  tables?: PresentationTable[];
  confidence?: { level: 'low' | 'medium' | 'high'; note?: string };
  limitations: string[];
  recommendedActions: string[];
  followUpSuggestions: PresentationFollowUp[];
  narrationSegments: NarrationSegment[];
  motionTimeline: MotionCue[];
  playback: NarrationPlaybackState;
};

export type PlainPresentation = {
  density: 'plain';
};

export type PlannedPresentation = PresentationModel | PlainPresentation;

export type MemoryProvenanceItem = {
  canonicalId: string;
  text: string;
  status?: string;
  sourceSystem?: string;
  sourceRefs?: string[];
  memoryClass?: string;
  ownerTrusted?: boolean;
  derived?: boolean;
};

export type PresentationInput = {
  text: string;
  replyText?: string;
  route?: string;
  capabilityId?: string;
  workOutcome?: {
    outcome?: string;
    text?: string;
    evidence?: string[];
    observations?: string[];
    verification?: string;
  };
  research?: {
    query?: string;
    synthesis?: string;
    sources?: Array<{ sourceId: string; title: string; url: string; domain?: string; trustClass?: string; recency?: string; publishedAt?: string | null }>;
    evidence?: Array<{ evidenceId: string; claim: string; sourceId: string }>;
    uncertainty?: string[];
    disagreements?: Array<{ topic: string }>;
    cache?: { cached?: boolean; cacheAgeMs?: number | null; freshRetrieval?: boolean; providerHit?: boolean };
    claims?: Array<{ text: string; supportingSourceIds?: string[]; conflictingSourceIds?: string[]; confidence?: number }>;
    sourceQuality?: Array<{ sourceId: string; trustClass?: string; recency?: string }>;
    timeline?: Array<{ sourceId: string; publishedAt?: string | null; label?: string }>;
    qualityLabel?: string;
    conflictingEvidence?: string[];
    recommendedFollowUps?: string[];
    limitations?: string[];
  };
  systemSnapshot?: {
    summary?: string;
    parts?: string[];
    cpu?: { usagePct: number; cores: number };
    ram?: { usedPct: number; freeMb?: number; totalMb?: number };
    disk?: { usedPct?: number; freeGb?: number; totalGb?: number };
    gpu?: { name: string; utilizationPct?: number; vramUsedMb?: number; vramTotalMb?: number };
  };
  displays?: {
    count?: number;
    ids?: string[];
    names?: string[];
    currentName?: string;
    currentId?: string;
    hostKind?: string;
    reason?: string;
  };
  showMemoryProvenance?: boolean;
  memoryProvenance?: MemoryProvenanceItem[];
};

export const FORBIDDEN_PRESENTATION_KEYS = [
  'reasoning',
  'scratchpad',
  'chainOfThought',
  'chain_of_thought',
  'hiddenReasoning',
  'thoughts',
  'cot',
  'innerMonologue',
  'inner_monologue',
  'confirmationToken',
] as const;
