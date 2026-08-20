import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SpeechTurnController, describeBusyPolicy } from '../audio/SpeechTurnController';
import { STANDALONE_VAD } from '../audio/utteranceQuality';
import {
  GAM_PERSONA_ID,
  GAM_VOICE_ID,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
} from '../presentation/types';
import { BrowserMicrophoneInput } from './browserMicrophone';
import JarvisCoreVisual from './JarvisCoreVisual';
import CommandCenterPanels from './CommandCenterPanels';
import PresenterBriefing from './PresenterBriefing';
import type { PlannedPresentation } from '../presentation/briefing/types';
import { applySpokenDuration, playbackAtElapsed, segmentStartMs } from '../presentation/briefing/playback';
import { acceptSseSeq } from './operationsView';
import { graphCategoriesOf, graphCategoryColor, type GraphSnapshot } from './graph/graphTypes';
import { shortestGraphPath } from './graph/graphLayout';
import {
  actionActivityLabel,
  deriveLabCorePhase,
  derivePipelineStages,
  deriveSystemRibbon,
  enrichToolActivity,
  formatConfidence,
  formatLatencyMs,
  formatTurnTimingsLine,
  isExplicitActionConfirmation,
  type LabActionResult,
  type LabPendingConfirmation,
} from './labUiState';
import {
  formatAgo,
  formatClock,
  formatMb,
  formatPct,
  labServiceShortName,
  labServiceStateLabel,
  matchToolNodeId,
  reminderLocalTime,
  reminderScheduleTag,
  researchClassLabel,
  type LabResearchSnapshot,
  type LabWorkspaceSnapshot,
  type LabServiceView,
  type NightAgentView,
  type ReminderSnapshotView,
  type SystemHealthView,
} from './labViewModels';
import { PulseBus } from './three/pulseBus';
import {
  clampDpr,
  nextAutoQuality,
  parseQualityMode,
  qualityPreset,
  QUALITY_STORAGE_KEY,
  resolveQualityLevel,
  type QualityLevel,
  type QualityMode,
} from './three/quality';
import { sceneMoodFor } from './three/sceneState';
import type { CameraAction, CoreSceneLayers } from './three/CoreScene';
import { webglAvailable } from './three/webglAvailability';
import type { CommandCenterClientSnapshot } from '../standalone/commandCenterView';
import type { DemoScenarioId } from '../standalone/commandCenterHttp';
import './jarvis-lab.css';

const CoreScene = lazy(() => import('./three/CoreScene'));

const IS_DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

type LabStatus = {
  discordRequired: boolean;
  ready: boolean;
  coreState: string;
  memory: { attached: boolean; schemaVersion?: number };
  capabilities?: {
    attached: boolean;
    ids: string[];
    catalog?: Array<{ id: string; providerKind: string; untrustedOutput: boolean; requiredService: string }>;
  };
  llm?: { enabled?: boolean; reachable?: boolean; model?: string; loaded?: boolean };
  stt?: { reachable?: boolean; model?: string; baseUrl?: string; reason?: string };
  runtime?: { id?: string; keepAlive?: string | number; contextTokens?: number };
  presentation?: {
    sessionId: string;
    brain: { id: string; available: boolean };
    persona: { id: string; available: boolean; mode: string };
    voice: {
      profileId: string;
      selected: boolean;
      available: boolean;
      speechActive: boolean;
      reason?: string;
      consented?: boolean;
    };
    session: {
      defaultProfile: { personaProfileId: string; voiceProfileId: string; brainProfileId: string };
      activeProfile: { personaProfileId: string; voiceProfileId: string; brainProfileId: string; personaMode: string };
    };
  };
  services?: LabServiceView[];
  reminders?: {
    attached: boolean;
    healthy: boolean;
    timezone?: string;
    nextRunAt?: string | null;
    activeCount?: number;
    pendingCount?: number;
    reason?: string;
  };
  research?: {
    attached: boolean;
    healthy: boolean;
    reason?: string;
  };
  workspace?: {
    attached: boolean;
    healthy: boolean;
    reason?: string;
    documentCount?: number;
    indexStatus?: string;
  };
  presence?: {
    hostKind: string;
    windowAvailable: boolean;
    canMoveWindow: boolean;
    reportedAt?: string;
    bounds?: { x: number; y: number; width: number; height: number };
    nativeHelper?: { status: string; installed: boolean; protocolVersion: number; reasonCode?: string; message: string };
  };
};

type LabAskResponse = {
  presented: { text: string; personaProfileId: string; voiceProfileId: string; transformations?: string[] };
  result: {
    answerIntent: string;
    suggestedContent: string;
    memoryRefs: Array<{
      canonicalId: string;
      type?: string;
      confidence?: number;
      sourceRefs?: string[];
      status?: string;
      domain?: string;
    }>;
    toolResults: Array<{ toolName: string; status: string; summary?: string; sourceUrls?: string[] }>;
    actionResults?: LabActionResult[];
    uncertainty: string[];
  };
  research?: LabResearchSnapshot;
  workspace?: LabWorkspaceSnapshot;
  intent?: { stage: string; detail: string; kind: string; capabilityId?: string };
  route?: { route: string; socialAction: string; agentic: boolean; reason: string };
  taskId?: string;
  workOutcome?: { outcome: string; text: string };
  briefing?: PlannedPresentation;
  pendingConfirmation?: LabPendingConfirmation;
  coreState: string;
  presentation?: LabStatus['presentation'];
  timings?: {
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
  };
  speech?: {
    status?: string;
    turnId?: string;
    profileId?: string;
    spokenProfileId?: string;
    fallback?: boolean;
    reason?: string;
    mime?: string;
    audioBase64?: string;
    audioDurationMs?: number;
    timings?: { sourceTtsMs?: number; rvcMs?: number; totalMs?: number; sourceEngine?: string };
  };
  llm?: {
    model?: string;
    promptTokens?: number;
    outputTokens?: number;
    tokensPerSec?: number;
    promptTokensPerSec?: number;
    loadMs?: number;
  };
  prompt?: { systemChars: number; userChars: number };
};

type NodeDetail = {
  found: boolean;
  id: string;
  kind?: string;
  status?: string;
  confidence?: number;
  importance?: number;
  privacyClass?: string;
  label?: string;
  factKey?: string;
  predicate?: string;
  objectValue?: string;
  summary?: string;
  entityType?: string;
  displayName?: string;
  occurredAt?: number;
  firstSeen?: number;
  lastConfirmed?: number;
  supersededBy?: string;
  provenance?: {
    sourceSystem?: string;
    sourceRecordId?: string;
    confirmations?: number;
    evidenceIds: string[];
  };
  aliases?: string[];
  relations: Array<{ id: string; relation: string; otherId: string; direction: 'out' | 'in' }>;
  reason?: string;
};

export default function JarvisLabPage() {
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [text, setText] = useState('');
  const [personaProfileId, setPersonaProfileId] = useState(JARVIS_PERSONA_ID);
  const [voiceProfileId, setVoiceProfileId] = useState(JARVIS_VOICE_ID);
  const [oneTurn, setOneTurn] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [speechState, setSpeechState] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<LabAskResponse | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<LabPendingConfirmation | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [sttLatencyMs, setSttLatencyMs] = useState<number | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [heardCaptureMs, setHeardCaptureMs] = useState<number | null>(null);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [turnTimings, setTurnTimings] = useState<LabAskResponse['timings'] | null>(null);
  const [micState, setMicState] = useState<'idle' | 'listening' | 'transcribing' | 'permission-denied' | 'unavailable'>('idle');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);

  // Command-center state
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemHealthView | null>(null);
  const [night, setNight] = useState<NightAgentView | null>(null);
  const [reminders, setReminders] = useState<ReminderSnapshotView | null>(null);
  const [research, setResearch] = useState<LabResearchSnapshot | null>(null);
  const [workspace, setWorkspace] = useState<LabWorkspaceSnapshot | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null);
  const [pathIds, setPathIds] = useState<string[] | null>(null);
  const [searchText, setSearchText] = useState('');
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [graphMode, setGraphMode] = useState<'graph' | 'list'>('graph');
  const [layers, setLayers] = useState<CoreSceneLayers>({ graph: true, rings: true, filaments: true, tools: true });
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [qualityMode, setQualityMode] = useState<QualityMode>('auto');
  const [autoLevel, setAutoLevel] = useState<QualityLevel>('high');
  const [fps, setFps] = useState<number | null>(null);
  const [cameraAction, setCameraAction] = useState<CameraAction | null>(null);
  const [webglLost, setWebglLost] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [commandCenter, setCommandCenter] = useState<CommandCenterClientSnapshot | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'core' | 'graph' | 'presenter'>('core');
  const [briefing, setBriefing] = useState<PlannedPresentation | undefined>(undefined);
  const [spokenAtMs, setSpokenAtMs] = useState(0);

  const askForm = useRef<HTMLFormElement>(null);
  const askField = useRef<HTMLTextAreaElement>(null);
  const microphone = useRef<BrowserMicrophoneInput | null>(null);
  const speechTurns = useRef(new SpeechTurnController(STANDALONE_VAD));
  const unsubMic = useRef<(() => void) | null>(null);
  const micStarting = useRef(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const playGeneration = useRef(0);
  const currentSpeechTurn = useRef<string | null>(null);
  const confirming = useRef(false);
  const pulses = useRef(new PulseBus());
  const cameraSeq = useRef(0);
  const lastQualityChange = useRef(0);
  const webglOk = useMemo(() => webglAvailable(), []);

  const refreshStatus = async () => {
    const reply = await fetch('/api/jarvis/status');
    if (!reply.ok) throw new Error(`Status ${reply.status}`);
    const payload = await reply.json() as LabStatus;
    setStatus(payload);
    if (!oneTurn && payload.presentation) {
      setPersonaProfileId(payload.presentation.persona.id);
      setVoiceProfileId(payload.presentation.voice.profileId);
    }
    return payload;
  };

  const refreshGraph = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/memory/graph');
      if (!reply.ok) throw new Error(`Graph ${reply.status}`);
      const payload = await reply.json() as GraphSnapshot;
      setGraph(payload);
      setGraphError(payload.attached ? null : payload.reason || 'Memory store is not attached.');
    } catch (err) {
      setGraphError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshSystem = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/system');
      if (reply.ok) setSystem(await reply.json() as SystemHealthView);
    } catch {
      // panel shows last known values; nothing invented
    }
  }, []);

  const refreshNight = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/night');
      if (reply.ok) setNight(await reply.json() as NightAgentView);
    } catch {
      // ignore
    }
  }, []);

  const refreshReminders = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/reminders');
      if (reply.ok) setReminders(await reply.json() as ReminderSnapshotView);
    } catch {
      // ignore
    }
  }, []);

  const refreshResearch = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/research');
      if (reply.ok) setResearch(await reply.json() as LabResearchSnapshot);
    } catch {
      // ignore
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/workspace');
      if (reply.ok) setWorkspace(await reply.json() as LabWorkspaceSnapshot);
    } catch {
      // ignore
    }
  }, []);

  const refreshCommandCenter = useCallback(async () => {
    try {
      const reply = await fetch('/api/jarvis/command-center');
      if (reply.ok) setCommandCenter(await reply.json() as CommandCenterClientSnapshot);
    } catch {
      // ignore
    }
  }, []);

  const postCommandCenter = async (url: string, body: Record<string, unknown>) => {
    setOpsBusy(true);
    try {
      const reply = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await reply.json() as CommandCenterClientSnapshot & { error?: string };
      if (!reply.ok) throw new Error(payload.error || `Command center ${reply.status}`);
      setCommandCenter(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpsBusy(false);
    }
  };

  useEffect(() => {
    void refreshStatus().catch(err => setError(err instanceof Error ? err.message : String(err)));
    void refreshGraph();
    void refreshSystem();
    void refreshNight();
    void refreshReminders();
    void refreshResearch();
    void refreshWorkspace();
    void refreshCommandCenter();
    try {
      setQualityMode(parseQualityMode(window.localStorage.getItem(QUALITY_STORAGE_KEY)));
    } catch {
      // default auto
    }
    if (window.innerWidth < 1100) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, []);

  useEffect(() => {
    if (documentHidden) return;
    const statusTimer = window.setInterval(() => { void refreshStatus().catch(() => undefined); }, 20_000);
    const systemTimer = window.setInterval(() => {
      void refreshSystem();
      void refreshReminders();
      void refreshResearch();
      void refreshWorkspace();
      void refreshCommandCenter();
    }, 5_000);
    const nightTimer = window.setInterval(() => { void refreshNight(); }, 30_000);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(systemTimer);
      window.clearInterval(nightTimer);
    };
  }, [documentHidden, refreshSystem, refreshNight, refreshReminders, refreshResearch, refreshWorkspace, refreshCommandCenter]);

  useEffect(() => {
    const syncHidden = () => setDocumentHidden(document.hidden);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(media.matches);
    syncHidden();
    syncMotion();
    document.addEventListener('visibilitychange', syncHidden);
    media.addEventListener('change', syncMotion);
    return () => {
      document.removeEventListener('visibilitychange', syncHidden);
      media.removeEventListener('change', syncMotion);
    };
  }, []);

  useEffect(() => {
    if (documentHidden) return;
    let lastSeq = 0;
    let source: EventSource | null = null;
    let retry: number | undefined;
    let refreshSoon: number | undefined;
    const scheduleRefresh = () => {
      if (refreshSoon) return;
      refreshSoon = window.setTimeout(() => {
        refreshSoon = undefined;
        void refreshCommandCenter();
      }, 120);
    };
    const connect = () => {
      const url = lastSeq > 0
        ? `/api/jarvis/events?stream=1&after=${lastSeq}`
        : '/api/jarvis/events?stream=1';
      source = new EventSource(url);
      source.onmessage = event => {
        try {
          const payload = JSON.parse(event.data) as { seq?: number };
          if (typeof payload.seq === 'number') {
            const next = acceptSseSeq(lastSeq, payload.seq);
            if (next === null) return;
            lastSeq = next;
          }
        } catch {
          return;
        }
        scheduleRefresh();
      };
      source.onerror = () => {
        source?.close();
        source = null;
        retry = window.setTimeout(connect, 1_500);
      };
    };
    connect();
    return () => {
      source?.close();
      if (retry) window.clearTimeout(retry);
      if (refreshSoon) window.clearTimeout(refreshSoon);
    };
  }, [documentHidden, refreshCommandCenter]);

  useEffect(() => {
    return () => {
      unsubMic.current?.();
      void microphone.current?.stop();
    };
  }, []);

  useEffect(() => {
    const field = askField.current;
    if (!field) return;
    field.style.height = '0px';
    field.style.height = `${Math.min(Math.max(field.scrollHeight, 48), 160)}px`;
  }, [text]);

  useEffect(() => {
    if (!selectedId) {
      setNodeDetail(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/jarvis/memory/node?id=${encodeURIComponent(selectedId)}`)
      .then(reply => reply.json())
      .then(payload => { if (!cancelled) setNodeDetail(payload as NodeDetail); })
      .catch(() => { if (!cancelled) setNodeDetail(null); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const persistPresentation = async (nextPersona: string, nextVoice: string) => {
    if (oneTurn) return;
    const reply = await fetch('/api/jarvis/presentation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaProfileId: nextPersona, voiceProfileId: nextVoice }),
    });
    if (!reply.ok) throw new Error(`Presentation ${reply.status}`);
    const presentation = await reply.json();
    setStatus(current => current ? { ...current, presentation } : current);
  };

  const askOnce = async (body: string): Promise<LabAskResponse> => {
    const reply = await fetch('/api/jarvis/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const payload = await reply.json();
    if (!reply.ok) throw new Error(payload.error || `Ask failed (${reply.status})`);
    return payload as LabAskResponse;
  };

  const stopPlayback = (turnId?: string) => {
    playGeneration.current += 1;
    player.current?.pause();
    player.current = null;
    setSpeechState('idle');
    const id = turnId || currentSpeechTurn.current;
    currentSpeechTurn.current = null;
    if (id) {
      void fetch('/api/jarvis/speak/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId: id }),
      }).catch(() => undefined);
    }
  };

  const playSpeech = (speech?: LabAskResponse['speech'], turnId?: string) => {
    if (!speech) return;
    if (speech.status !== 'spoken' || !speech.audioBase64) {
      setSpeechNote(speech.reason || `${speech.profileId || 'Voice'} speech unavailable.`);
      setSpeechState('idle');
      return;
    }
    if (speech.fallback) {
      setSpeechNote(`Fallback voice ${speech.spokenProfileId} (selected ${speech.profileId}).`);
    } else {
      setSpeechNote(null);
    }
    const generation = ++playGeneration.current;
    currentSpeechTurn.current = turnId || null;
    player.current?.pause();
    const audio = new Audio(`data:${speech.mime || 'audio/mpeg'};base64,${speech.audioBase64}`);
    player.current = audio;
    setSpeechState('speaking');
    audio.onloadedmetadata = () => {
      if (playGeneration.current !== generation) return;
      const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined;
      if (durationMs && durationMs > 200) {
        setBriefing(current => {
          if (!current || current.density === 'plain') return current;
          return applySpokenDuration(current, durationMs, reducedMotion);
        });
      }
    };
    audio.ontimeupdate = () => {
      if (playGeneration.current !== generation) return;
      const elapsed = Math.round(audio.currentTime * 1000);
      setSpokenAtMs(elapsed);
      setBriefing(current => {
        if (!current || current.density === 'plain') return current;
        const next = playbackAtElapsed(current.id, current.narrationSegments, elapsed, {
          actualSpeechDurationMs: current.playback?.actualSpeechDurationMs,
          playbackState: 'playing',
        });
        if (next.segmentIndex === current.playback.segmentIndex) return current;
        return { ...current, playback: next };
      });
    };
    audio.onended = () => {
      if (playGeneration.current === generation) {
        setSpeechState('idle');
        currentSpeechTurn.current = null;
        setBriefing(current => {
          if (!current || current.density === 'plain') return current;
          return {
            ...current,
            playback: { ...current.playback, playbackState: 'completed' },
          };
        });
      }
    };
    audio.onerror = () => {
      if (playGeneration.current === generation) {
        setSpeechState('idle');
        setSpeechNote('Local playback failed.');
      }
    };
    void audio.play().catch(() => {
      if (playGeneration.current === generation) {
        setSpeechState('idle');
        setSpeechNote('Local playback was blocked.');
      }
    });
  };

  const consumeStreamLine = (
    line: string,
    onDraft: (text: string) => void,
    onFinal: (payload: LabAskResponse) => void,
  ) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: { type?: string; text?: string; payload?: LabAskResponse & { turnId?: string }; error?: string };
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (event.type === 'draft' && event.text) onDraft(event.text);
    if (event.type === 'final' && event.payload) onFinal(event.payload);
    if (event.type === 'error' && event.error) throw new Error(event.error);
  };

  const askStream = async (body: string, onDraft: (text: string) => void): Promise<LabAskResponse | null> => {
    const reply = await fetch('/api/jarvis/ask-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!reply.ok || !reply.body) return null;
    const reader = reply.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: LabAskResponse | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consumeStreamLine(line, onDraft, payload => { finalPayload = payload; });
    }
    if (buffer.trim()) consumeStreamLine(buffer, onDraft, payload => { finalPayload = payload; });
    return finalPayload;
  };

  const memoryRefs = response?.result.memoryRefs ?? [];
  const toolResults = response?.result.toolResults ?? [];
  const actionResults = response?.result.actionResults ?? [];
  const catalog = status?.capabilities?.catalog ?? [];
  const tools = useMemo(
    () => toolResults.map(item => enrichToolActivity(item, catalog)),
    [toolResults, catalog],
  );
  const selectedResearchSource = research?.last?.sources.find(item => item.sourceId === selectedSourceId) ?? null;
  const selectedWorkspaceDocument = workspace?.last?.documents.find(item => item.documentId === selectedDocumentId) ?? workspace?.last?.documents[0] ?? null;
  const observableToolCount = toolResults.length + actionResults.length;

  const phase = deriveLabCorePhase({
    busy,
    error,
    statusReady: status?.ready,
    llmReachable: status?.llm?.reachable,
    coreState: status?.coreState,
    hasResponse: Boolean(response),
    memoryCount: memoryRefs.length,
    toolCount: observableToolCount,
    micState: micState === 'listening' || micState === 'transcribing' ? micState : 'idle',
    speechState,
    visualState: commandCenter?.task?.active || commandCenter?.fresh ? commandCenter.visualState : undefined,
  });

  const nightRunning = night?.available === true && night.status === 'running';
  const mood = useMemo(
    () => sceneMoodFor(phase, { nightActive: nightRunning }),
    [phase, nightRunning],
  );

  const ribbon = deriveSystemRibbon({
    llmReachable: status?.llm?.reachable,
    llmModel: status?.llm?.model,
    memoryAttached: status?.memory.attached,
    memorySchemaVersion: status?.memory.schemaVersion,
    toolCount: status ? (status.capabilities?.ids.length ?? 0) : undefined,
    speechActive: speechState === 'speaking' || status?.presentation?.voice.speechActive,
    voiceAvailable: status?.presentation?.voice.available,
    voiceRuntime: speechState === 'speaking'
      ? 'speaking'
      : speechState === 'loading'
        ? 'loading'
        : status?.presentation?.voice.available
          ? 'ready'
          : status?.presentation?.voice.reason
            ? 'unavailable'
            : undefined,
    micAvailable: micState !== 'unavailable' && micState !== 'permission-denied',
    micState,
    sttReachable: status?.stt?.reachable,
  });

  const pipeline = derivePipelineStages({
    busy,
    hasResponse: Boolean(response),
    memoryCount: memoryRefs.length,
    toolCount: observableToolCount,
    toolFailed: tools.some(item => item.failed),
    hasPresentedText: Boolean(response?.presented.text),
    speech: speechState === 'loading'
      ? 'loading'
      : response?.speech
        ? (response.speech.status === 'spoken' ? 'spoken' : 'failed')
        : 'off',
  });

  const settleConfirmation = async (
    decision: 'allow' | 'deny',
    shouldSpeak: boolean,
    actionSource: 'text' | 'voice' | 'ui' = 'ui',
  ) => {
    if (!pendingConfirmation || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    setError(null);
    try {
      const path = decision === 'allow' ? '/api/jarvis/actions/confirm' : '/api/jarvis/actions/deny';
      const reply = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: pendingConfirmation.proposalId,
          token: pendingConfirmation.token,
          sessionId: 'jarvis-lab',
          speak: shouldSpeak,
          actionSource,
        }),
      });
      const payload = await reply.json() as LabAskResponse & { error?: string };
      if (!reply.ok) throw new Error(payload.error || 'Confirmation failed.');
      setResponse(payload);
      if (payload.briefing) setBriefing(payload.briefing);
      setPendingConfirmation(payload.pendingConfirmation ?? null);
      if (payload.speech) playSpeech(payload.speech, payload.speech.turnId);
      setToolPanelOpen(true);
      void refreshStatus().catch(() => undefined);
      void refreshReminders();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  };

  const requestReminderMutation = async (capabilityId: string, input: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await askOnce(JSON.stringify({
        text: capabilityId,
        personaProfileId,
        voiceProfileId,
        oneTurn,
        capabilityCalls: [{ id: capabilityId, input }],
        speak: false,
        actionSource: 'ui',
      }));
      setResponse(payload);
      void refreshReminders();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ackDelivery = async (action: 'dismiss' | 'complete' | 'snooze', delivery: NonNullable<ReminderSnapshotView['pendingDeliveries'][number]>, minutes?: number) => {
    try {
      const reply = await fetch('/api/jarvis/reminders/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reminderId: delivery.reminderId,
          occurrenceAt: delivery.occurrenceAt,
          action,
          ...(minutes ? { minutes } : {}),
        }),
      });
      if (!reply.ok) throw new Error(`Reminder ${reply.status}`);
      setReminders(await reply.json() as ReminderSnapshotView);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const requestServiceAction = async (capabilityId: 'jarvis.startService' | 'jarvis.restartService', serviceId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const started = performance.now();
    try {
      const payload = await askOnce(JSON.stringify({
        text: `${capabilityId === 'jarvis.startService' ? 'Start' : 'Restart'} ${serviceId}`,
        personaProfileId,
        voiceProfileId,
        oneTurn,
        capabilityCalls: [{ id: capabilityId, input: { serviceId } }],
        speak: speakEnabled,
        actionSource: 'ui',
      }));
      setLatencyMs(performance.now() - started);
      setResponse(payload);
      setPendingConfirmation(payload.pendingConfirmation ?? null);
      setToolPanelOpen(true);
      if (payload.speech) playSpeech(payload.speech, payload.speech.turnId);
      void refreshStatus().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const ask = async (
    event?: FormEvent,
    spokenText?: string,
    spokenTimings?: { sttMs?: number; captureMs?: number; utteranceFinalizeMs?: number },
  ) => {
    event?.preventDefault();
    const payloadText = (spokenText ?? text).trim();
    if (busy || micState === 'transcribing' || !payloadText) return;
    if (pendingConfirmation && isExplicitActionConfirmation(payloadText)) {
      await settleConfirmation('allow', Boolean(spokenText) || speakEnabled, spokenText ? 'voice' : 'text');
      if (!spokenText) setText('');
      return;
    }
    if (micState === 'listening') {
      speechTurns.current.stopListening();
      await stopMicHardware();
      setMicState('idle');
    }
    setBusy(true);
    speechTurns.current.setPipelineBusy(true);
    setError(null);
    setDraftText(null);
    setSpeechNote(null);
    setEvidenceOpen(false);
    setToolPanelOpen(false);
    stopPlayback();
    const shouldSpeak = Boolean(spokenText) || speakEnabled;
    if (shouldSpeak) setSpeechState('loading');
    const started = performance.now();
    try {
      const capabilities = catalog.some(item => item.id === payloadText) ? [payloadText] : [];
      const body = JSON.stringify({
        text: payloadText,
        personaProfileId,
        voiceProfileId,
        oneTurn,
        capabilities,
        speak: shouldSpeak,
        actionSource: spokenText ? 'voice' : 'text',
      });
      const streamed = await askStream(body, setDraftText);
      const payload = streamed ?? await askOnce(body);
      setLatencyMs(performance.now() - started);
      setDraftText(null);
      setResponse(payload);
      if (payload.briefing) setBriefing(payload.briefing);
      if (payload.research) setResearch(payload.research);
      setPendingConfirmation(payload.pendingConfirmation ?? null);
      setTurnTimings({
        ...(payload.timings || {}),
        ...(spokenTimings?.captureMs !== undefined ? { captureMs: spokenTimings.captureMs } : {}),
        ...(spokenTimings?.utteranceFinalizeMs !== undefined ? { utteranceFinalizeMs: spokenTimings.utteranceFinalizeMs } : {}),
        ...(spokenTimings?.sttMs !== undefined ? { sttMs: spokenTimings.sttMs } : {}),
        ...(payload.speech?.timings?.sourceTtsMs !== undefined ? { sourceTtsMs: payload.speech.timings.sourceTtsMs } : {}),
        ...(payload.speech?.timings?.rvcMs !== undefined ? { rvcMs: payload.speech.timings.rvcMs } : {}),
      });
      // Observable scene events from real turn evidence only.
      const refIds = (payload.result.memoryRefs || []).map(ref => ref.canonicalId);
      if (refIds.length > 0) {
        pulses.current.emit({ kind: 'memory', nodeIds: refIds });
        setEvidenceOpen(true);
      }
      const registered = (status?.capabilities?.ids ?? []);
      const toolIds = (payload.result.toolResults || [])
        .map(tool => matchToolNodeId(tool.toolName, registered))
        .filter((id): id is string => Boolean(id));
      if ((payload.result.toolResults || []).length > 0 || (payload.result.actionResults || []).length > 0) {
        setToolPanelOpen(true);
        if (toolIds.length > 0) {
          pulses.current.emit({
            kind: 'tool',
            toolIds,
            failed: (payload.result.toolResults || []).some(tool => tool.status !== 'ok'),
          });
        }
      }
      pulses.current.emit({ kind: 'response' });
      void refreshReminders();
      void refreshResearch();
      void refreshWorkspace();
      if (refIds.length > 0) {
        window.setTimeout(() => { void refreshGraph(); }, 1_200);
      }
      if (shouldSpeak && payload.speech) playSpeech(payload.speech, payload.speech.turnId);
      if (payload.presentation) {
        setStatus(current => current ? { ...current, presentation: payload.presentation } : current);
        if (oneTurn) {
          setPersonaProfileId(payload.presentation.session.activeProfile.personaProfileId);
          setVoiceProfileId(payload.presentation.session.activeProfile.voiceProfileId);
        }
      }
    } catch (err) {
      setLatencyMs(performance.now() - started);
      setDraftText(null);
      setSpeechState('idle');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      speechTurns.current.setPipelineBusy(false);
    }
  };

  const onAskKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      askForm.current?.requestSubmit();
    }
  };

  const choosePersona = (value: string) => {
    setPersonaProfileId(value);
    void persistPresentation(value, voiceProfileId).catch(err => setError(err instanceof Error ? err.message : String(err)));
  };

  const chooseVoice = (value: string) => {
    setVoiceProfileId(value);
    void persistPresentation(personaProfileId, value).catch(err => setError(err instanceof Error ? err.message : String(err)));
  };

  const stopMicHardware = async () => {
    unsubMic.current?.();
    unsubMic.current = null;
    await microphone.current?.stop();
  };

  const transcribeTurn = async (turn: {
    turnId: string;
    pcm: Uint8Array;
    sampleRate: number;
    channels: number;
    captureDurationMs?: number;
    voicedMs?: number;
    utteranceFinalizeMs?: number;
  }) => {
    await stopMicHardware();
    setMicState('transcribing');
    speechTurns.current.setPipelineBusy(true);
    setError(null);
    try {
      const reply = await fetch('/api/jarvis/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Jarvis-Sample-Rate': String(turn.sampleRate),
          'X-Jarvis-Channels': String(turn.channels),
          'X-Jarvis-Turn-Id': turn.turnId,
          'X-Jarvis-Capture-Ms': String(turn.captureDurationMs ?? ''),
          'X-Jarvis-Voiced-Ms': String(turn.voicedMs ?? ''),
        },
        body: turn.pcm,
      });
      const payload = await reply.json() as {
        status?: string;
        text?: string;
        latencyMs?: number;
        captureDurationMs?: number;
        confidence?: number;
        reason?: string;
        error?: string;
      };
      setSttLatencyMs(typeof payload.latencyMs === 'number' ? payload.latencyMs : null);
      const captureMs = typeof payload.captureDurationMs === 'number'
        ? payload.captureDurationMs
        : (turn.captureDurationMs ?? null);
      setHeardCaptureMs(captureMs);
      if (!reply.ok) throw new Error(payload.error || `STT failed (${reply.status})`);
      if (payload.status !== 'final' || !payload.text?.trim()) {
        if (payload.text?.trim()) {
          setHeard(payload.text);
          setText(payload.text);
        } else {
          setHeard(null);
          setHeardCaptureMs(null);
        }
        setMicState('idle');
        speechTurns.current.setPipelineBusy(false);
        const sttOff = status?.stt?.reachable === false;
        setError(sttOff
          ? (status?.stt?.reason || 'Qwen3-ASR is not reachable.')
          : (payload.reason ? `Speech was ignored (${payload.reason}). Review the text, then Ask.` : 'No speech was recognized.'));
        return;
      }
      setHeard(payload.text);
      setText(payload.text);
      setMicState('idle');
      const spokenTimings = {
        ...(typeof captureMs === 'number' ? { captureMs } : {}),
        ...(typeof turn.utteranceFinalizeMs === 'number' ? { utteranceFinalizeMs: turn.utteranceFinalizeMs } : {}),
        ...(typeof payload.latencyMs === 'number' ? { sttMs: payload.latencyMs } : {}),
      };
      if (typeof payload.confidence === 'number' && payload.confidence < 0.8) {
        speechTurns.current.setPipelineBusy(false);
        setError('Transcript confidence is low. Review the text, then Ask.');
        return;
      }
      await ask(undefined, payload.text, spokenTimings);
    } catch (err) {
      setMicState('idle');
      speechTurns.current.setPipelineBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleMic = async () => {
    if (micStarting.current) return;
    if (speechState === 'speaking' || speechState === 'loading') {
      stopPlayback();
    }
    if (busy || micState === 'transcribing') {
      setError(describeBusyPolicy());
      return;
    }
    if (micState === 'listening') {
      micStarting.current = true;
      try {
        const result = speechTurns.current.stopListening();
        await stopMicHardware();
        if (result.kind === 'utterance') {
          await transcribeTurn(result.turn);
          return;
        }
        setMicState('idle');
        if (result.kind === 'ignored') setError('No clear utterance was captured.');
        return;
      } finally {
        micStarting.current = false;
      }
    }
    micStarting.current = true;
    try {
      if (!microphone.current) microphone.current = new BrowserMicrophoneInput();
      const started = speechTurns.current.startListening();
      if (!started.ok) {
        setError(describeBusyPolicy());
        return;
      }
      unsubMic.current?.();
      unsubMic.current = microphone.current.onFrame(frame => {
        const result = speechTurns.current.pushFrame(frame);
        if (result.kind === 'utterance') {
          void transcribeTurn(result.turn);
        } else if (result.kind === 'ignored') {
          void stopMicHardware();
          setMicState('idle');
          setError('No clear utterance was captured.');
        }
      });
      await microphone.current.start();
      setError(null);
      setHeard(null);
      setHeardCaptureMs(null);
      setMicState('listening');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setMicState(code === 'permission-denied' ? 'permission-denied' : 'unavailable');
      setError(err instanceof Error ? err.message : String(err));
      speechTurns.current.stopListening();
      await stopMicHardware();
    } finally {
      micStarting.current = false;
    }
  };

  /* --------------------- graph interactions --------------------- */

  const searchMatches = useMemo(() => {
    const term = searchText.trim().toLocaleLowerCase();
    if (!term || !graph) return null;
    const matches = new Set<string>();
    for (const node of graph.nodes) {
      if (node.label.toLocaleLowerCase().includes(term)
        || node.id.toLocaleLowerCase().includes(term)
        || node.category.toLocaleLowerCase().includes(term)) {
        matches.add(node.id);
      }
    }
    return matches;
  }, [searchText, graph]);

  const categories = useMemo(() => graphCategoriesOf(graph?.nodes ?? []), [graph]);
  const visibleCategories = useMemo(() => {
    if (hiddenCategories.size === 0) return null;
    const visible = new Set<string>();
    for (const item of categories) {
      if (!hiddenCategories.has(item.category)) visible.add(item.category);
    }
    return visible;
  }, [hiddenCategories, categories]);

  const onSelectNode = useCallback((id: string | null, additive: boolean) => {
    if (additive && id && graph) {
      setSelectedId(previous => {
        if (previous && previous !== id) {
          setPathIds(shortestGraphPath(graph.edges, previous, id));
          return previous;
        }
        setPathIds(null);
        return id;
      });
      return;
    }
    setPathIds(null);
    setSelectedId(id);
  }, [graph]);

  const fireCamera = (kind: CameraAction['kind']) => {
    cameraSeq.current += 1;
    setCameraAction({ seq: cameraSeq.current, kind });
    if (kind === 'presenter') setViewMode('presenter');
    if (kind === 'core') setViewMode('core');
    if (kind === 'graph') setViewMode('graph');
  };

  useEffect(() => {
    const report = () => {
      void fetch('/api/jarvis/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenX: window.screenX,
          screenY: window.screenY,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        }),
      }).catch(() => undefined);
    };
    report();
    window.addEventListener('resize', report);
    return () => window.removeEventListener('resize', report);
  }, []);

  useEffect(() => {
    if (viewMode !== 'presenter' || !briefing || briefing.density === 'plain' || speechState === 'speaking') {
      return;
    }
    if (reducedMotion) {
      return;
    }
    const started = performance.now() - spokenAtMs;
    const timer = window.setInterval(() => {
      setSpokenAtMs(performance.now() - started);
    }, 250);
    return () => window.clearInterval(timer);
  }, [viewMode, briefing && briefing.density !== 'plain' ? briefing.id : undefined, reducedMotion, speechState]);

  const setQuality = (mode: QualityMode) => {
    setQualityMode(mode);
    if (mode !== '2d') setWebglLost(false);
    try {
      window.localStorage.setItem(QUALITY_STORAGE_KEY, mode);
    } catch {
      // ignore storage failures
    }
  };

  const onFps = useCallback((value: number) => {
    setFps(value);
    setAutoLevel(current => {
      const next = nextAutoQuality(current, value);
      if (!next) return current;
      const now = Date.now();
      if (now - lastQualityChange.current < 6_000) return current;
      lastQualityChange.current = now;
      return next;
    });
  }, []);

  const effectiveLevel = resolveQualityLevel(qualityMode, autoLevel);
  const use3d = webglOk && !webglLost && effectiveLevel !== '2d';
  const preset = qualityPreset(effectiveLevel === '2d' ? 'minimal' : effectiveLevel);
  const fx = reducedMotion || documentHidden ? 'off' : 'full';
  const latency = formatLatencyMs(latencyMs);
  const presentation = status?.presentation;
  const voice = presentation?.voice;
  const timingsLine = formatTurnTimingsLine(turnTimings, response?.llm);
  const coreStatusTitle = nightRunning && phase === 'idle' ? 'night agent' : phase;
  const coreStatusSubtitle = (() => {
    if (nightRunning && phase === 'idle') return night?.currentTaskId || 'Task queue active';
    switch (phase) {
      case 'listening': return 'Listening';
      case 'transcribing': return 'Transcribing audio';
      case 'thinking': return 'Processing request';
      case 'planning': return 'Building a structured plan';
      case 'searching': return 'Searching sources';
      case 'permission': return 'Waiting for owner permission';
      case 'executing': return 'Executing the next safe step';
      case 'verifying': return 'Verifying the outcome';
      case 'memory': return 'Memory evidence attached';
      case 'tool': return 'Tool activity detected';
      case 'responding': return 'Preparing response';
      case 'speaking': return 'Speaking';
      case 'reflecting': return 'Recording a structured reflection';
      case 'evolving': return 'Background evolution cycle';
      case 'degraded': return 'Operating with limited services';
      case 'error': return 'Attention required';
      default: return 'Awaiting a request';
    }
  })();

  const toolOrbitItems = useMemo(() => {
    const activeIds = new Set(tools.map(tool => tool.id));
    const registered = status?.capabilities?.ids ?? [];
    return registered.slice(0, 10).map(id => ({
      id,
      active: activeIds.has(id) || tools.some(tool => matchToolNodeId(tool.id, [id]) === id),
      failed: tools.some(tool => tool.failed && matchToolNodeId(tool.id, [id]) === id),
    }));
  }, [status?.capabilities?.ids, tools]);

  const listNodes = useMemo(() => {
    if (!graph) return [];
    const term = searchText.trim().toLocaleLowerCase();
    const filtered = graph.nodes.filter(node => {
      if (visibleCategories && !visibleCategories.has(node.category)) return false;
      if (!term) return true;
      return node.label.toLocaleLowerCase().includes(term) || node.id.toLocaleLowerCase().includes(term);
    });
    return filtered
      .sort((left, right) => right.degree - left.degree || right.importance - left.importance)
      .slice(0, 48);
  }, [graph, searchText, visibleCategories]);

  const selectedNode = useMemo(
    () => (graph && selectedId ? graph.nodes.find(node => node.id === selectedId) ?? null : null),
    [graph, selectedId],
  );

  /* --------------------------- render --------------------------- */

  return (
    <div className={`jarvis-lab jcc${leftOpen ? '' : ' left-closed'}${rightOpen ? '' : ' right-closed'}`} data-fx={fx} data-hidden={documentHidden ? 'true' : 'false'} data-quality={String(effectiveLevel)}>
      <header className="jcc-ribbon">
        <div className="jcc-brand">
          <span>JARVIS COMMAND CENTER</span>
          <small>local ai assistant · secure · private</small>
        </div>
        <ul className="jcc-ribbon__items" aria-label="System status">
          {ribbon.map(item => (
            <li key={item.id} className={`jcc-dot jcc-dot--${item.tone}${item.lit ? ' is-lit' : ''}`}>
              <i aria-hidden="true" />
              <strong>{item.label}</strong>
              <em>{item.value}</em>
            </li>
          ))}
          <li className={`jcc-dot jcc-dot--${nightRunning ? 'ok' : 'off'}${nightRunning ? ' is-lit is-night' : ''}`}>
            <i aria-hidden="true" />
            <strong>NIGHT</strong>
            <em>{night?.available ? (night.status || 'unknown') : 'off'}</em>
          </li>
        </ul>
        <div className="jcc-ribbon__meta">
          {latency ? <span className="jcc-ribbon__latency">core {latency}</span> : null}
          {formatLatencyMs(sttLatencyMs) ? <span className="jcc-ribbon__latency">stt {formatLatencyMs(sttLatencyMs)}</span> : null}
          {IS_DEV && fps !== null ? <span className="jcc-ribbon__latency">{Math.round(fps)} fps</span> : null}
        </div>
      </header>

      <div className="jcc-stage">
        {use3d ? (
          <Suspense fallback={<div className="jcc-stage__loading"><JarvisCoreVisual phase={phase} fx={fx} memoryActive={memoryRefs.length > 0} toolActive={toolResults.length > 0} /></div>}>
            <CoreScene
              mood={mood}
              quality={preset}
              reducedMotion={reducedMotion}
              hidden={documentHidden}
              graph={graph}
              layers={layers}
              visibleCategories={visibleCategories}
              searchMatches={searchMatches}
              selectedId={selectedId}
              pathIds={pathIds}
              tools={toolOrbitItems}
              pulses={pulses.current}
              cameraAction={cameraAction}
              onSelectNode={onSelectNode}
              onFps={onFps}
              onContextLost={() => setWebglLost(true)}
            />
          </Suspense>
        ) : (
          <div className="jcc-stage__loading">
            <JarvisCoreVisual phase={phase} fx={fx} memoryActive={memoryRefs.length > 0} toolActive={toolResults.length > 0} />
            {!webglOk || webglLost ? <p className="jcc-hint jcc-stage__note">WebGL is unavailable — 2D core fallback active.</p> : null}
          </div>
        )}

        <div className="jcc-overlay">
          <aside className={`jcc-rail jcc-memory${leftOpen ? '' : ' is-closed'}`} aria-label="Memory and context">
            <button type="button" className="jcc-rail__collapse" onClick={() => setLeftOpen(open => !open)} aria-label={leftOpen ? 'Collapse memory panel' : 'Open memory panel'}>
              {leftOpen ? '⟨' : '⟩'}
            </button>
            {leftOpen ? (
              <div className="jcc-rail__body">
                <section className="jcc-block">
                  <h2>Search memory</h2>
                  <input
                    className="jcc-search"
                    type="search"
                    value={searchText}
                    onChange={event => setSearchText(event.target.value)}
                    placeholder="Search nodes, facts, ids…"
                    aria-label="Search memory graph"
                  />
                  {searchMatches ? <p className="jcc-hint">{searchMatches.size} match{searchMatches.size === 1 ? '' : 'es'}</p> : null}
                </section>

                <section className="jcc-block">
                  <h2>Active context</h2>
                  <dl className="jcc-kv">
                    <div><dt>Session</dt><dd>{presentation?.sessionId || 'jarvis-lab'}</dd></div>
                    <div><dt>Persona</dt><dd>{presentation?.persona.id || '…'} <em>{presentation?.persona.mode || ''}</em></dd></div>
                    <div><dt>Voice</dt><dd>{voice?.profileId || '…'} <em>{voice?.available ? 'ready' : 'unavailable'}</em></dd></div>
                    {timingsLine ? <div><dt>Last turn</dt><dd className="jcc-mono">{timingsLine}</dd></div> : null}
                  </dl>
                </section>

                <section className="jcc-block">
                  <h2>Memory evidence</h2>
                  {memoryRefs.length === 0 ? (
                    <p className="jcc-empty">No canonical memory attached to this turn.</p>
                  ) : (
                    <ul className="jcc-evidence">
                      {memoryRefs.map(ref => {
                        const confidence = formatConfidence(ref.confidence);
                        const inGraph = graph?.nodes.some(node => node.id === ref.canonicalId);
                        return (
                          <li key={ref.canonicalId}>
                            <button
                              type="button"
                              className="jcc-evidence__id"
                              disabled={!inGraph}
                              onClick={() => onSelectNode(ref.canonicalId, false)}
                              title={inGraph ? 'Focus node in graph' : 'Not in the current graph snapshot'}
                            >
                              <code>{ref.canonicalId}</code>
                            </button>
                            <span>
                              {ref.type || 'memory'}
                              {ref.status ? ` · ${ref.status}` : ''}
                              {ref.domain ? ` · ${ref.domain}` : ''}
                              {confidence ? ` · ${confidence}` : ''}
                            </span>
                            {ref.sourceRefs && ref.sourceRefs.length > 0 ? (
                              <small>provenance {ref.sourceRefs.join(', ')}</small>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {response?.result.uncertainty.length ? (
                    <div className="jcc-uncertainty">
                      <h3>Uncertainty</h3>
                      <ul>
                        {response.result.uncertainty.map(item => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <section className="jcc-block">
                  <h2>Knowledge graph</h2>
                  <div className="jcc-seg jcc-seg--tight" role="group" aria-label="Graph mode">
                    <button type="button" aria-pressed={graphMode === 'graph'} onClick={() => setGraphMode('graph')}>Graph</button>
                    <button type="button" aria-pressed={graphMode === 'list'} onClick={() => setGraphMode('list')}>List</button>
                    <button type="button" onClick={() => { void refreshGraph(); }}>↻</button>
                  </div>
                  {graph?.attached ? (
                    <p className="jcc-hint">
                      {graph.nodes.length} nodes · {graph.edges.length} edges
                      {graph.truncated ? ' · truncated' : ''}
                    </p>
                  ) : (
                    <p className="jcc-empty">{graphError || 'Loading memory graph…'}</p>
                  )}
                  <div className="jcc-layers">
                    {([['graph', 'Graph'], ['rings', 'Rings'], ['filaments', 'Filaments'], ['tools', 'Tools']] as const).map(([key, label]) => (
                      <label key={key} className={`jcc-toggle${layers[key] ? ' is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={layers[key]}
                          onChange={event => setLayers(current => ({ ...current, [key]: event.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {graphMode === 'list' ? (
                    <ul className="jcc-nodelist">
                      {listNodes.map(node => (
                        <li key={node.id}>
                          <button
                            type="button"
                            className={selectedId === node.id ? 'is-selected' : ''}
                            onClick={() => onSelectNode(node.id, false)}
                          >
                            <i style={{ background: graphCategoryColor(node.category) }} aria-hidden="true" />
                            <span>{node.label}</span>
                            <em>{node.category}</em>
                          </button>
                        </li>
                      ))}
                      {listNodes.length === 0 ? <li className="jcc-empty">No nodes match.</li> : null}
                    </ul>
                  ) : null}
                </section>

                <section className="jcc-block">
                  <h2>Node inspector</h2>
                  {!selectedId ? (
                    <p className="jcc-empty">Click a node in the graph to inspect it. Shift+click a second node to trace a path.</p>
                  ) : (
                    <div className="jcc-inspector">
                      <code className="jcc-inspector__id">{selectedId}</code>
                      {nodeDetail?.found ? (
                        <>
                          <dl className="jcc-kv">
                            <div><dt>Type</dt><dd>{nodeDetail.kind}{nodeDetail.entityType ? ` · ${nodeDetail.entityType}` : ''}</dd></div>
                            <div><dt>Status</dt><dd>{nodeDetail.status}</dd></div>
                            <div><dt>Confidence</dt><dd>{formatConfidence(nodeDetail.confidence) || 'unknown'}</dd></div>
                            {nodeDetail.privacyClass ? <div><dt>Privacy</dt><dd>{nodeDetail.privacyClass}</dd></div> : null}
                            {nodeDetail.displayName ? <div><dt>Name</dt><dd>{nodeDetail.displayName}</dd></div> : null}
                            {nodeDetail.factKey ? <div><dt>Fact key</dt><dd className="jcc-mono">{nodeDetail.factKey}</dd></div> : null}
                            {nodeDetail.objectValue ? <div><dt>Value</dt><dd>{nodeDetail.objectValue}</dd></div> : null}
                            {nodeDetail.summary ? <div><dt>Summary</dt><dd>{nodeDetail.summary}</dd></div> : null}
                            {nodeDetail.provenance?.sourceSystem ? <div><dt>Source</dt><dd>{nodeDetail.provenance.sourceSystem}{nodeDetail.provenance.confirmations ? ` · ×${nodeDetail.provenance.confirmations}` : ''}</dd></div> : null}
                            {nodeDetail.firstSeen ? <div><dt>First seen</dt><dd>{formatAgo(nodeDetail.firstSeen) || new Date(nodeDetail.firstSeen).toLocaleString()}</dd></div> : null}
                            {nodeDetail.lastConfirmed ? <div><dt>Confirmed</dt><dd>{formatAgo(nodeDetail.lastConfirmed) || new Date(nodeDetail.lastConfirmed).toLocaleString()}</dd></div> : null}
                            {nodeDetail.supersededBy ? <div><dt>Superseded by</dt><dd className="jcc-mono">{nodeDetail.supersededBy}</dd></div> : null}
                          </dl>
                          {nodeDetail.provenance?.evidenceIds.length ? (
                            <p className="jcc-hint">evidence {nodeDetail.provenance.evidenceIds.join(', ')}</p>
                          ) : null}
                          {nodeDetail.aliases?.length ? <p className="jcc-hint">aliases {nodeDetail.aliases.join(', ')}</p> : null}
                          {nodeDetail.relations.length > 0 ? (
                            <div className="jcc-relations">
                              <h3>Relationships</h3>
                              <ul>
                                {nodeDetail.relations.slice(0, 14).map(rel => (
                                  <li key={rel.id}>
                                    <button type="button" onClick={() => onSelectNode(rel.otherId, false)}>
                                      <em>{rel.direction === 'out' ? '→' : '←'}</em> {rel.relation}
                                      <code>{rel.otherId}</code>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="jcc-hint">No stored relationships for this node.</p>
                          )}
                        </>
                      ) : (
                        <p className="jcc-empty">{nodeDetail ? (nodeDetail.reason || 'Node not found in the store.') : 'Loading…'}</p>
                      )}
                      {pathIds && pathIds.length > 1 ? (
                        <p className="jcc-hint">Path: {pathIds.join(' → ')}</p>
                      ) : null}
                      <button type="button" className="jcc-ghost" onClick={() => onSelectNode(null, false)}>Clear selection</button>
                    </div>
                  )}
                </section>

                <section className="jcc-block">
                  <h2>Filters</h2>
                  <ul className="jcc-filters">
                    {categories.map(item => (
                      <li key={item.category}>
                        <button
                          type="button"
                          className={hiddenCategories.has(item.category) ? 'is-off' : ''}
                          onClick={() => setHiddenCategories(current => {
                            const next = new Set(current);
                            if (next.has(item.category)) next.delete(item.category);
                            else next.add(item.category);
                            return next;
                          })}
                        >
                          <i style={{ background: graphCategoryColor(item.category) }} aria-hidden="true" />
                          {item.category}
                          <em>{item.count}</em>
                        </button>
                      </li>
                    ))}
                    {categories.length === 0 ? <li className="jcc-empty">No memory categories yet.</li> : null}
                  </ul>
                </section>
              </div>
            ) : null}
          </aside>

          <section className="jcc-center">
            <div className="jcc-camera" role="group" aria-label="Camera and quality">
              <button type="button" onClick={() => fireCamera('fit')}>Fit</button>
              <button type="button" aria-pressed={viewMode === 'core'} onClick={() => fireCamera('core')}>Core</button>
              <button type="button" aria-pressed={viewMode === 'graph'} onClick={() => fireCamera('graph')}>Graph</button>
              <button type="button" aria-pressed={viewMode === 'presenter'} onClick={() => fireCamera('presenter')}>Presenter</button>
              <button type="button" onClick={() => fireCamera('reset')}>Reset</button>
              <span className="jcc-camera__divider" aria-hidden="true" />
              {(['auto', 'high', 'balanced', 'minimal', '2d'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className="jcc-camera__quality"
                  aria-pressed={qualityMode === mode}
                  onClick={() => setQuality(mode)}
                >
                  {mode === 'auto' ? `auto${qualityMode === 'auto' ? `·${autoLevel[0]}` : ''}` : mode}
                </button>
              ))}
            </div>
            {status?.presence ? (
              <p className="jcc-presence" role="status">
                {status.presence.hostKind}
                {status.presence.windowAvailable ? ' · window reported' : ' · window unknown'}
                {status.presence.canMoveWindow ? ' · native move ready' : ' · browser host cannot move this tab'}
                {status.presence.nativeHelper?.installed ? ' · helper installed' : ' · native helper unavailable'}
              </p>
            ) : null}

            <PresenterBriefing
              briefing={briefing}
              open={viewMode === 'presenter'}
              spokenAtMs={spokenAtMs}
              onClose={() => fireCamera('core')}
              onBriefingChange={next => {
                setBriefing(next);
                if (next.density === 'plain') return;
                const start = segmentStartMs(next.narrationSegments, next.playback.segmentIndex);
                setSpokenAtMs(start);
                const audio = player.current;
                if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
                  audio.currentTime = Math.min(start / 1000, Math.max(0, audio.duration - 0.05));
                  if (next.playback.playbackState === 'playing' || next.playback.playbackState === 'idle') {
                    void audio.play().catch(() => undefined);
                    setSpeechState('speaking');
                  }
                }
              }}
            />

            <div className="jcc-float jcc-float--evidence" data-open={evidenceOpen && memoryRefs.length > 0 ? 'true' : 'false'}>
              <header>
                <h3>Memory evidence</h3>
                <span>{memoryRefs.length}</span>
                <button type="button" onClick={() => setEvidenceOpen(false)} aria-label="Dismiss">×</button>
              </header>
              <ul>
                {memoryRefs.slice(0, 4).map(ref => (
                  <li key={ref.canonicalId}>
                    <code>{ref.canonicalId}</code>
                    <em>{formatConfidence(ref.confidence) || ref.type || ''}</em>
                  </li>
                ))}
              </ul>
            </div>

            <div className="jcc-float jcc-float--tool" data-open={toolPanelOpen && tools.length > 0 ? 'true' : 'false'}>
              <header>
                <h3>Tool output</h3>
                <button type="button" onClick={() => setToolPanelOpen(false)} aria-label="Dismiss">×</button>
              </header>
              <ul>
                {tools.slice(0, 3).map(tool => (
                  <li key={tool.id} className={tool.failed ? 'is-failed' : ''}>
                    <code>{tool.id}</code>
                    <span>{tool.status}{tool.untrusted ? ' · untrusted' : ''}</span>
                    {tool.summary && tool.summary !== tool.status ? <small>{tool.summary}</small> : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="jcc-float jcc-float--task" data-open={nightRunning ? 'true' : 'false'}>
              <header>
                <h3>Night agent</h3>
                <span className="jcc-live">running</span>
              </header>
              <p className="jcc-mono">{night?.currentTaskId || '…'}</p>
              {night?.counts ? <p className="jcc-hint">{night.counts.pass}/{night.counts.total} pass</p> : null}
            </div>

            {commandCenter?.simulationMode || commandCenter?.task?.simulated ? (
              <p className="jcc-sim-banner" role="status">SIMULATION — events are tagged and not live hardware</p>
            ) : null}

            <div className="jcc-answer" data-state={busy ? 'busy' : response || draftText ? 'ready' : 'empty'}>
              {draftText || response?.presented.text ? (
                <>
                  <p>{draftText || response?.presented.text}</p>
                  {response?.workOutcome ? (
                    <p className="jcc-hint">
                      {response.workOutcome.outcome}
                      {response.route?.route ? ` · ${response.route.route}` : ''}
                      {response.taskId ? ` · ${response.taskId}` : ''}
                    </p>
                  ) : response?.route ? (
                    <p className="jcc-hint">Route {response.route.route} · {response.route.socialAction}</p>
                  ) : null}
                  {briefing && briefing.density !== 'plain' && viewMode !== 'presenter' ? (
                    <button type="button" className="jcc-briefing-open" onClick={() => fireCamera('presenter')}>
                      Open briefing
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="jcc-core-status" data-phase={coreStatusTitle}>
                  <strong>{coreStatusTitle}</strong>
                  <span>{coreStatusSubtitle}</span>
                </div>
              )}
            </div>

            <ol className="jcc-timeline" aria-label="Observable pipeline">
              {(commandCenter?.task?.steps.length ? commandCenter.task.steps.map(step => ({
                id: step.id,
                label: `${step.index} ${step.title}`,
                state: step.state === 'active' ? 'active' : step.state === 'failed' ? 'failed' : step.state === 'done' ? 'done' : 'pending',
              })) : pipeline).map((stage, index) => (
                <li key={stage.id} className={`jcc-timeline__stage is-${stage.state}`}>
                  {index > 0 ? <span className="jcc-timeline__arrow" aria-hidden="true">→</span> : null}
                  <strong>{stage.label}</strong>
                </li>
              ))}
            </ol>

            {reminders?.pendingDeliveries[0] ? (
              <section className="jcc-permit jcc-reminder-due" aria-label="Jarvis reminder">
                <p className="jcc-permit__kicker">Jarvis reminder</p>
                <h3>{reminders.pendingDeliveries[0].title}</h3>
                <p>Scheduled for {reminders.pendingDeliveries[0].scheduledLocal}</p>
                {reminders.pendingDeliveries[0].kind === 'missed' ? <p className="jcc-hint">Missed while Jarvis was offline</p> : null}
                <div className="jcc-permit__actions">
                  <button type="button" className="jcc-permit__allow" onClick={() => { void ackDelivery('complete', reminders.pendingDeliveries[0]); }}>Done</button>
                  <button type="button" className="jcc-permit__deny" onClick={() => { void ackDelivery('dismiss', reminders.pendingDeliveries[0]); }}>Dismiss</button>
                  <button type="button" className="jcc-permit__deny" onClick={() => { void ackDelivery('snooze', reminders.pendingDeliveries[0], 10); }}>Snooze 10m</button>
                </div>
              </section>
            ) : null}

            {pendingConfirmation ? (
              <section className="jcc-permit" aria-label="Action confirmation">
                <p className="jcc-permit__kicker">Jarvis requests permission</p>
                <h3>{pendingConfirmation.displayName}</h3>
                <p>Open: {pendingConfirmation.target}</p>
                <p className="jcc-hint">
                  {pendingConfirmation.reason}
                  {pendingConfirmation.risk ? ` · ${pendingConfirmation.risk}` : ''}
                </p>
                <div className="jcc-permit__actions">
                  <button
                    type="button"
                    className="jcc-permit__deny"
                    disabled={busy}
                    onClick={() => { void settleConfirmation('deny', speakEnabled, 'ui'); }}
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    className="jcc-permit__allow"
                    disabled={busy}
                    onClick={() => { void settleConfirmation('allow', speakEnabled, 'ui'); }}
                  >
                    Allow once
                  </button>
                </div>
              </section>
            ) : null}

            <form className="jcc-dock" onSubmit={ask} ref={askForm} aria-busy={busy}>
              <div className="jcc-controls">
                <div className="jcc-labeled">
                  <span>Persona</span>
                  <div className="jcc-seg" role="group" aria-label="Persona">
                    <button type="button" disabled={busy} aria-pressed={personaProfileId === JARVIS_PERSONA_ID} onClick={() => choosePersona(JARVIS_PERSONA_ID)}>Jarvis</button>
                    <button type="button" disabled={busy} aria-pressed={personaProfileId === GAM_PERSONA_ID} onClick={() => choosePersona(GAM_PERSONA_ID)}>Gam</button>
                  </div>
                </div>
                <div className="jcc-labeled">
                  <span>Voice</span>
                  <div className="jcc-seg" role="group" aria-label="Voice">
                    <button type="button" disabled={busy} aria-pressed={voiceProfileId === JARVIS_VOICE_ID} onClick={() => chooseVoice(JARVIS_VOICE_ID)}>Jarvis</button>
                    <button type="button" disabled={busy} aria-pressed={voiceProfileId === GAM_VOICE_ID} onClick={() => chooseVoice(GAM_VOICE_ID)}>Gam</button>
                  </div>
                </div>
                <label className={`jcc-toggle${oneTurn ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={oneTurn} onChange={event => setOneTurn(event.target.checked)} />
                  One-turn
                </label>
                <label className={`jcc-toggle${speakEnabled ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={speakEnabled} onChange={event => setSpeakEnabled(event.target.checked)} />
                  Speak
                </label>
                <p className="jcc-session">
                  {voice?.profileId || 'jarvis'}
                  {voice?.available ? ' ready' : ' unavailable'}
                  {speechState === 'speaking' ? ' · speaking' : ''}
                  {speechNote ? ` · ${speechNote}` : ''}
                </p>
              </div>
              <div className="jcc-compose">
                <textarea
                  ref={askField}
                  value={text}
                  onChange={event => setText(event.target.value)}
                  onKeyDown={onAskKey}
                  placeholder="Ask anything, or give a command…"
                  rows={1}
                  disabled={busy || micState === 'transcribing'}
                  aria-label="Ask Jarvis"
                />
                <button type="submit" className="jcc-ask" disabled={busy || micState === 'transcribing' || !text.trim()}>
                  {busy ? 'Thinking' : 'Ask'}
                </button>
                <button
                  type="button"
                  className={`jcc-mic${micState === 'listening' ? ' is-live' : ''}${micState === 'transcribing' ? ' is-stt' : ''}`}
                  aria-pressed={micState === 'listening'}
                  aria-label={micState === 'listening' ? 'Stop microphone' : 'Start microphone'}
                  title={status?.stt?.reachable === false ? (status.stt.reason || 'Qwen3-ASR is not reachable.') : 'Click to speak. Silence ends the utterance.'}
                  onClick={() => { void toggleMic(); }}
                >
                  <span className="jcc-mic__ring" aria-hidden="true" />
                  <span className="jcc-mic__icon" aria-hidden="true" />
                  <span className="jcc-mic__text">{micState === 'listening' ? 'Stop' : micState === 'transcribing' ? 'STT' : 'Mic'}</span>
                </button>
              </div>
              {heard ? (
                <p className="jcc-hint">
                  Heard: {heard}
                  {heardCaptureMs ? ` · capture ${formatLatencyMs(heardCaptureMs)}` : ''}
                </p>
              ) : null}
              {voice?.reason ? <p className="jcc-hint">{voice.reason}</p> : null}
              {error ? <p className="jcc-error" role="alert">{error}</p> : null}
            </form>
          </section>

          <aside className={`jcc-rail jcc-tools${rightOpen ? '' : ' is-closed'}`} aria-label="Operations">
            <button type="button" className="jcc-rail__collapse" onClick={() => setRightOpen(open => !open)} aria-label={rightOpen ? 'Collapse operations panel' : 'Open operations panel'}>
              {rightOpen ? '⟩' : '⟨'}
            </button>
            {rightOpen ? (
              <div className="jcc-rail__body">
                <CommandCenterPanels
                  snapshot={commandCenter}
                  domains={(research?.last?.sources ?? []).map(item => item.domain).filter(Boolean)}
                  busy={opsBusy}
                  onDemo={(scenario: DemoScenarioId) => { void postCommandCenter('/api/jarvis/command-center/demo', { scenario }); }}
                  onCancel={() => {
                    if (commandCenter?.task?.id) void postCommandCenter('/api/jarvis/command-center/cancel', { taskId: commandCenter.task.id });
                  }}
                  onGrant={() => {
                    const perm = commandCenter?.permission;
                    const taskId = commandCenter?.task?.id || perm?.taskId;
                    if (taskId) {
                      void postCommandCenter('/api/jarvis/command-center/grant', {
                        taskId,
                        stepId: perm?.stepId,
                        proposalId: perm?.proposalId,
                        capability: perm?.capability,
                      });
                    }
                  }}
                  onSimulation={enabled => { void postCommandCenter('/api/jarvis/command-center/control', { simulationMode: enabled }); }}
                  onRunTask={objective => { void postCommandCenter('/api/jarvis/command-center/task', { objective }); }}
                  onNight={() => { void postCommandCenter('/api/jarvis/command-center/night', { action: 'run' }); }}
                />
                <section className="jcc-block">
                  <h2>Tool activity</h2>
                  {response?.intent ? (
                    <p className="jcc-hint">{response.intent.stage}{response.intent.capabilityId ? ` · ${response.intent.capabilityId}` : ''}{response.intent.detail ? ` — ${response.intent.detail}` : ''}</p>
                  ) : null}
                  {actionResults.length > 0 ? (
                    <ul className="jcc-evidence">
                      {actionResults.map(action => (
                        <li key={`${action.proposalId || action.name}-${action.status}`} className={action.status === 'denied' || action.status === 'failed' ? 'is-failed' : ''}>
                          <code>{action.capabilityId || action.name}</code>
                          <span>
                            {action.status}
                            {action.risk ? ` · ${action.risk}` : ''}
                          </span>
                          <small>{actionActivityLabel(action)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {research?.last?.stages.length ? (
                    <ul className="jcc-evidence">
                      {research.last.stages.map(stage => (
                        <li key={stage.id} className={stage.state === 'failed' ? 'is-failed' : ''}>
                          <code>{stage.label}</code>
                          <span>{stage.state}</span>
                          <small>{stage.detail}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {workspace?.last?.stages.length ? (
                    <ul className="jcc-evidence">
                      {workspace.last.stages.map(stage => (
                        <li key={`ws-${stage.id}`} className={stage.state === 'failed' ? 'is-failed' : ''}>
                          <code>{stage.label.toUpperCase()}</code>
                          <span>{stage.state}</span>
                          <small>{stage.detail}</small>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {tools.length === 0 && actionResults.length === 0 && !research?.last && !workspace?.last ? (
                    <p className="jcc-empty">No tools called this turn.</p>
                  ) : tools.length === 0 ? null : (
                    <ul className="jcc-evidence">
                      {tools.map(tool => (
                        <li key={tool.id} className={tool.failed ? 'is-failed' : ''}>
                          <code>{tool.id}</code>
                          <span>
                            {tool.status}
                            {tool.provider ? ` · ${tool.provider}` : ''}
                            {tool.untrusted ? ' · untrusted' : ''}
                          </span>
                          {tool.summary && tool.summary !== tool.status ? <small>{tool.summary}</small> : null}
                          {tool.sourceUrls.map(url => (
                            <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="jcc-hint">
                    {!status
                      ? 'Checking capability registry…'
                      : status.capabilities?.attached
                        ? `${status.capabilities.ids.length} capabilities registered. Registry metadata only; live health is not probed.`
                        : 'No capability host attached.'}
                  </p>
                </section>

                <section className="jcc-block">
                  <h2>Sources</h2>
                  <p className="jcc-hint">
                    {research?.attached
                      ? (research.healthy ? 'public web research' : (research.reason || 'research degraded'))
                      : (status?.research?.reason || 'research unavailable')}
                    {research?.last?.cached ? ' · cached' : ''}
                  </p>
                  {!research?.last?.sources.length ? (
                    <p className="jcc-empty">No research sources this session.</p>
                  ) : (
                    <ul className="jcc-evidence jcc-sources">
                      {research.last.sources.map(source => (
                        <li key={source.sourceId}>
                          <button type="button" className="jcc-evidence__id" onClick={() => setSelectedSourceId(source.sourceId)}>
                            <code>{source.domain}</code>
                          </button>
                          <span>{researchClassLabel(source.sourceClass)}{source.publishedAt ? ` · pub ${source.publishedAt.slice(0, 10)}` : ' · published unknown'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedResearchSource ? (
                    <dl className="jcc-kv">
                      <div>
                        <dt>Title</dt>
                        <dd>{selectedResearchSource.title}</dd>
                      </div>
                      <div>
                        <dt>Class</dt>
                        <dd>{researchClassLabel(selectedResearchSource.sourceClass)}</dd>
                      </div>
                      <div>
                        <dt>Published</dt>
                        <dd>{selectedResearchSource.publishedAt || 'unknown'}</dd>
                      </div>
                      <div>
                        <dt>Fetched</dt>
                        <dd>{selectedResearchSource.fetchedAt || 'unknown'}</dd>
                      </div>
                      <div>
                        <dt>URL</dt>
                        <dd><a href={selectedResearchSource.canonicalUrl || selectedResearchSource.url} target="_blank" rel="noreferrer">{selectedResearchSource.domain}</a></dd>
                      </div>
                      {research?.last?.evidence.filter(item => item.sourceId === selectedResearchSource.sourceId).slice(0, 2).map(item => (
                        <div key={item.evidenceId}>
                          <dt>Excerpt</dt>
                          <dd>{item.excerpt}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </section>

                <section className="jcc-block">
                  <h2>Workspace</h2>
                  <p className="jcc-hint">
                    {workspace?.attached
                      ? `${workspace.displayName || 'Jarvis Project'} · ${workspace.documentCount ?? 0} documents · ${workspace.indexStatus || 'unknown'}${workspace.last?.stale ? ' · stale' : ''}`
                      : (status?.workspace?.reason || 'workspace unavailable')}
                  </p>
                  <p>
                    <button
                      type="button"
                      disabled={busy || !workspace?.attached}
                      onClick={() => {
                        void fetch('/api/jarvis/workspace/refresh', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ workspaceId: workspace?.workspaceId || 'jarvis-project' }),
                        }).then(() => refreshWorkspace());
                      }}
                    >
                      Refresh index
                    </button>
                  </p>
                  {!workspace?.last?.documents.length ? (
                    <p className="jcc-empty">No local workspace results this session.</p>
                  ) : (
                    <ul className="jcc-evidence">
                      {workspace.last.documents.slice(0, 6).map(doc => (
                        <li key={doc.documentId}>
                          <button type="button" className="jcc-evidence__id" onClick={() => setSelectedDocumentId(doc.documentId)}>
                            <code>{doc.displayName}</code>
                          </button>
                          <span>LOCAL{doc.stale ? ' · stale' : ''}</span>
                          <small>{doc.relativePath}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedWorkspaceDocument ? (
                    <dl className="jcc-kv">
                      <div>
                        <dt>File</dt>
                        <dd>{selectedWorkspaceDocument.displayName}</dd>
                      </div>
                      <div>
                        <dt>Relative path</dt>
                        <dd>{selectedWorkspaceDocument.relativePath}</dd>
                      </div>
                      <div>
                        <dt>Modified</dt>
                        <dd>{selectedWorkspaceDocument.modifiedAt}</dd>
                      </div>
                      <div>
                        <dt>Source type</dt>
                        <dd>LOCAL</dd>
                      </div>
                      {workspace?.last?.evidence.filter(item => item.documentId === selectedWorkspaceDocument.documentId).slice(0, 2).map(item => (
                        <div key={item.evidenceId}>
                          <dt>{typeof item.lineStart === 'number' ? `Lines ${item.lineStart}–${item.lineEnd ?? item.lineStart}` : 'Excerpt'}</dt>
                          <dd>{item.excerpt}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </section>

                <section className="jcc-block">
                  <h2>Reminders</h2>
                  <p className="jcc-hint">
                    {reminders?.scheduler.attached
                      ? `${reminders.scheduler.healthy ? 'scheduler healthy' : 'scheduler paused'}${reminders.scheduler.nextRunAt ? ` · next ${reminderLocalTime(reminders.scheduler.nextRunAt, reminders.scheduler.timezone)}` : ''}`
                      : (status?.reminders?.reason || 'scheduler unavailable')}
                  </p>
                  {(reminders?.reminders.length ?? 0) === 0 ? (
                    <p className="jcc-empty">No active reminders.</p>
                  ) : (
                    <ul className="jcc-evidence jcc-reminders">
                      {reminders?.reminders.map(item => (
                        <li key={item.id}>
                          <code>{reminderLocalTime(item.nextRunAt, reminders.scheduler.timezone)}</code>
                          <span>{item.title}{reminderScheduleTag(item) ? ` · ${reminderScheduleTag(item)}` : ''}{item.status === 'PAUSED' ? ' · paused' : ''}</span>
                          <small>
                            <button type="button" disabled={busy} onClick={() => { void requestReminderMutation(item.status === 'PAUSED' ? 'reminders.resume' : 'reminders.pause', { reminderId: item.id }); }}>
                              {item.status === 'PAUSED' ? 'Resume' : 'Pause'}
                            </button>
                            <button type="button" disabled={busy} onClick={() => { void requestReminderMutation('reminders.cancel', { reminderId: item.id }); }}>
                              Cancel
                            </button>
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="jcc-block">
                  <h2>System health</h2>
                  <ul className="jcc-meters">
                    <li>
                      <span>CPU</span>
                      <div className="jcc-meter"><i style={{ width: `${Math.min(100, system?.cpu?.usagePct ?? 0)}%` }} /></div>
                      <em>{system?.cpu ? `${formatPct(system.cpu.usagePct)} · ${system.cpu.cores}c` : 'unknown'}</em>
                    </li>
                    <li>
                      <span>RAM</span>
                      <div className="jcc-meter"><i style={{ width: `${Math.min(100, system?.ram?.usedPct ?? 0)}%` }} /></div>
                      <em>{system?.ram ? `${formatMb(system.ram.totalMb - system.ram.freeMb)} / ${formatMb(system.ram.totalMb)}` : 'unknown'}</em>
                    </li>
                    <li>
                      <span>GPU</span>
                      <div className="jcc-meter"><i style={{ width: `${Math.min(100, system?.gpu?.utilizationPct ?? 0)}%` }} /></div>
                      <em>{system?.gpu ? formatPct(system.gpu.utilizationPct) : 'unavailable'}</em>
                    </li>
                    <li>
                      <span>VRAM</span>
                      <div className="jcc-meter">
                        <i style={{ width: `${system?.gpu?.vramUsedMb && system.gpu.vramTotalMb ? Math.min(100, (system.gpu.vramUsedMb / system.gpu.vramTotalMb) * 100) : 0}%` }} />
                      </div>
                      <em>{system?.gpu?.vramTotalMb ? `${formatMb(system.gpu.vramUsedMb)} / ${formatMb(system.gpu.vramTotalMb)}` : 'unavailable'}</em>
                    </li>
                    <li>
                      <span>DISK</span>
                      <div className="jcc-meter"><i style={{ width: `${Math.min(100, system?.disk?.usedPct ?? 0)}%` }} /></div>
                      <em>{system?.disk ? `${system.disk.freeGb} GB free` : 'unknown'}</em>
                    </li>
                  </ul>
                  {system?.gpuUnavailableReason && !system.gpu ? <p className="jcc-hint">{system.gpuUnavailableReason}</p> : null}
                  <dl className="jcc-kv">
                    <div>
                      <dt>Battery</dt>
                      <dd>{system?.battery?.status === 'ok' && system.battery.percent !== undefined
                        ? `${system.battery.percent}%${system.battery.charging ? ' · charging' : system.battery.pluggedIn ? ' · plugged in' : ''}`
                        : (system?.battery?.reason || 'unavailable')}</dd>
                    </div>
                    <div>
                      <dt>Network</dt>
                      <dd>{system?.network?.status === 'ok'
                        ? (system.network.available ? (system.network.interfaceClass || 'up') : 'offline')
                        : (system?.network?.reason || 'unavailable')}</dd>
                    </div>
                  </dl>
                </section>

                <section className="jcc-block">
                  <h2>Model status</h2>
                  <dl className="jcc-kv">
                    <div><dt>CORE</dt><dd>{status ? (status.coreState === 'ready' ? 'healthy' : status.coreState) : '…'}</dd></div>
                    <div><dt>Model</dt><dd className="jcc-mono">{status?.llm?.model || (status ? 'offline' : '…')}</dd></div>
                    <div><dt>Reachable</dt><dd>{status?.llm ? (status.llm.reachable ? 'yes' : 'no') : '…'}</dd></div>
                    {status?.runtime?.contextTokens ? <div><dt>Context</dt><dd>{status.runtime.contextTokens.toLocaleString()} tokens</dd></div> : null}
                    {status?.runtime?.keepAlive ? <div><dt>Keep-alive</dt><dd>{String(status.runtime.keepAlive)}</dd></div> : null}
                    {response?.llm?.tokensPerSec ? <div><dt>Last turn</dt><dd>{response.llm.tokensPerSec.toFixed(1)} tok/s</dd></div> : null}
                    {response?.llm?.promptTokens ? <div><dt>Prompt</dt><dd>{response.llm.promptTokens} tokens</dd></div> : null}
                  </dl>
                  <ServiceRows
                    services={(status?.services ?? []).filter(item => item.id === 'ollama' || item.id === 'embedding')}
                    busy={busy}
                    onStart={id => { void requestServiceAction('jarvis.startService', id); }}
                    onRestart={id => { void requestServiceAction('jarvis.restartService', id); }}
                  />
                </section>

                <section className="jcc-block">
                  <h2>Voice / STT</h2>
                  <dl className="jcc-kv">
                    <div><dt>Voice</dt><dd>{voice ? `${voice.profileId}${voice.available ? ' · ready' : ' · unavailable'}` : '…'}</dd></div>
                    <div><dt>STT</dt><dd>{status?.stt ? (status.stt.reachable ? (status.stt.model || 'reachable') : 'offline') : '…'}</dd></div>
                    {status?.stt?.reason && !status.stt.reachable ? <div><dt>Reason</dt><dd>{status.stt.reason}</dd></div> : null}
                  </dl>
                  <ServiceRows
                    services={(status?.services ?? []).filter(item => item.id === 'qwen-asr' || item.id === 'jarvis-tts' || item.id === 'rvc')}
                    busy={busy}
                    onStart={id => { void requestServiceAction('jarvis.startService', id); }}
                    onRestart={id => { void requestServiceAction('jarvis.restartService', id); }}
                  />
                </section>

                <section className="jcc-block">
                  <h2>Night agent</h2>
                  {night?.available ? (
                    <dl className="jcc-kv">
                      <div><dt>Status</dt><dd className={nightRunning ? 'jcc-live' : ''}>{night.status}</dd></div>
                      {night.model ? <div><dt>Model</dt><dd className="jcc-mono">{night.model}</dd></div> : null}
                      {night.currentTaskId ? <div><dt>Task</dt><dd className="jcc-mono">{night.currentTaskId}</dd></div> : null}
                      {night.counts ? <div><dt>Tasks</dt><dd>{night.counts.pass} pass · {night.counts.blocked} blocked · {night.counts.total} total</dd></div> : null}
                      {night.endedAt ? <div><dt>Ended</dt><dd>{formatClock(night.endedAt)}</dd></div> : null}
                    </dl>
                  ) : (
                    <p className="jcc-empty">{night?.reason || 'No night-agent state on this machine.'}</p>
                  )}
                </section>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

function ServiceRows({
  services,
  busy,
  onStart,
  onRestart,
}: {
  services: LabServiceView[];
  busy: boolean;
  onStart: (id: string) => void;
  onRestart: (id: string) => void;
}) {
  if (services.length === 0) return null;
  return (
    <ul className="jcc-svc">
      {services.map(service => {
        const state = labServiceStateLabel(service);
        const showStart = service.startAllowed && (service.lifecycle === 'STOPPED' || service.health === 'offline');
        const showRestart = service.restartAllowed && service.lifecycle === 'RUNNING';
        return (
          <li key={service.id}>
            <span>{labServiceShortName(service.id)}</span>
            <em>{state}{service.reason ? ` · ${service.reason}` : ''}</em>
            {showStart ? (
              <button type="button" disabled={busy} onClick={() => onStart(service.id)}>Start</button>
            ) : showRestart ? (
              <button type="button" disabled={busy} onClick={() => onRestart(service.id)}>Restart</button>
            ) : <span />}
          </li>
        );
      })}
    </ul>
  );
}
