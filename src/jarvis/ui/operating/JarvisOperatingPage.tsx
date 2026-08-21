import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Mic, Send, SlidersHorizontal, Volume2 } from 'lucide-react';
import { SpeechTurnController } from '../../audio/SpeechTurnController';
import { STANDALONE_VAD } from '../../audio/utteranceQuality';
import {
  GAM_PERSONA_ID,
  GAM_VOICE_ID,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
} from '../../presentation/types';
import type { HostSecuritySnapshot } from '../../security/types';
import type { CommandCenterClientSnapshot } from '../../standalone/commandCenterView';
import type { TrustedOperatorSnapshot } from '../../security/trustedOperatorRuntime';
import { BrowserMicrophoneInput } from '../browserMicrophone';
import JarvisCoreVisual from '../JarvisCoreVisual';
import type { GraphSnapshot } from '../graph/graphTypes';
import {
  deriveLabCorePhase,
  enrichToolActivity,
  formatTurnTimingsLine,
  type LabActionResult,
  type LabPendingConfirmation,
} from '../labUiState';
import type {
  LabResearchSnapshot,
  LabWorkspaceSnapshot,
  NightAgentView,
  ReminderSnapshotView,
  SystemHealthView,
} from '../labViewModels';
import { PulseBus } from '../three/pulseBus';
import {
  parseQualityMode,
  qualityPreset,
  QUALITY_STORAGE_KEY,
  resolveQualityLevel,
  type QualityMode,
} from '../three/quality';
import { sceneMoodFor } from '../three/sceneState';
import type { CoreSceneLayers } from '../three/CoreScene';
import { webglAvailable } from '../three/webglAvailability';
import JarvisOperatingShell, { parseJarvisPage, type JarvisPageId, type ShellStatus } from './JarvisOperatingShell';
import JarvisPages, { type ConversationView, type PersonalAiRuntimeStatus } from './JarvisPages';
import { OwnerApprovalDialog, riskBriefFromPreflight, type RiskBriefModel } from './TrustedOperator';
import { interpretPresenceOwnerReply, interpretPresenceShellCommand, resolvePresenceApproval } from '../presence/presenceRuntime';

const CoreScene = lazy(() => import('../three/CoreScene'));

type RuntimeStatus = PersonalAiRuntimeStatus & {
  presentation?: PersonalAiRuntimeStatus['presentation'] & {
    sessionId?: string;
    session?: {
      activeProfile: { personaProfileId: string; voiceProfileId: string; brainProfileId: string; personaMode: string };
    };
  };
};

type AskResponse = {
  presented: { text: string; personaProfileId: string; voiceProfileId: string };
  result: {
    memoryRefs: ConversationView['memoryRefs'];
    toolResults: Array<{ toolName: string; status: string; summary?: string; sourceUrls?: string[] }>;
    actionResults?: LabActionResult[];
    uncertainty: string[];
  };
  route?: ConversationView['route'];
  taskId?: string;
  workOutcome?: ConversationView['workOutcome'];
  pendingConfirmation?: LabPendingConfirmation;
  coreState: string;
  research?: LabResearchSnapshot;
  workspace?: LabWorkspaceSnapshot;
  presentation?: RuntimeStatus['presentation'];
  timings?: Parameters<typeof formatTurnTimingsLine>[0];
  llm?: Parameters<typeof formatTurnTimingsLine>[1];
  speech?: {
    status?: string;
    turnId?: string;
    profileId?: string;
    spokenProfileId?: string;
    fallback?: boolean;
    reason?: string;
    mime?: string;
    audioBase64?: string;
    timings?: { sourceTtsMs?: number; rvcMs?: number; totalMs?: number };
  };
};

type MicState = 'idle' | 'listening' | 'transcribing' | 'permission-denied' | 'unavailable';

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJson<T>(url: string): Promise<T> {
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`${url} returned ${reply.status}`);
  return await reply.json() as T;
}

export default function JarvisOperatingPage() {
  const [page, setPage] = useState<JarvisPageId>(() => parseJarvisPage(window.location.pathname));
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [system, setSystem] = useState<SystemHealthView | null>(null);
  const [security, setSecurity] = useState<HostSecuritySnapshot | null>(null);
  const [night, setNight] = useState<NightAgentView | null>(null);
  const [reminders, setReminders] = useState<ReminderSnapshotView | null>(null);
  const [research, setResearch] = useState<LabResearchSnapshot | null>(null);
  const [workspace, setWorkspace] = useState<LabWorkspaceSnapshot | null>(null);
  const [commandCenter, setCommandCenter] = useState<CommandCenterClientSnapshot | null>(null);
  const [operator, setOperator] = useState<TrustedOperatorSnapshot | null>(null);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<LabPendingConfirmation | null>(null);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opsBusy, setOpsBusy] = useState(false);
  const [micState, setMicState] = useState<MicState>('idle');
  const [speechState, setSpeechState] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const [speechNote, setSpeechNote] = useState<string | null>(null);
  const [personaProfileId, setPersonaProfileId] = useState(JARVIS_PERSONA_ID);
  const [voiceProfileId, setVoiceProfileId] = useState(JARVIS_VOICE_ID);
  const [oneTurn, setOneTurn] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [qualityMode, setQualityMode] = useState<QualityMode>('auto');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [webglLost, setWebglLost] = useState(false);

  const askField = useRef<HTMLTextAreaElement>(null);
  const askForm = useRef<HTMLFormElement>(null);
  const microphone = useRef<BrowserMicrophoneInput | null>(null);
  const speechTurns = useRef(new SpeechTurnController(STANDALONE_VAD));
  const unsubMic = useRef<(() => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const currentSpeechTurn = useRef<string | null>(null);
  const playGeneration = useRef(0);
  const confirming = useRef(false);
  const pulses = useRef(new PulseBus());
  const webglOk = useMemo(() => webglAvailable(), []);

  const refreshStatus = useCallback(async () => {
    const value = await readJson<RuntimeStatus>('/api/jarvis/status');
    setStatus(value);
    if (!oneTurn && value.presentation) {
      setPersonaProfileId(value.presentation.persona.id);
      setVoiceProfileId(value.presentation.voice.profileId);
    }
  }, [oneTurn]);
  const refreshSystem = useCallback(() => readJson<SystemHealthView>('/api/jarvis/system').then(setSystem).catch(() => undefined), []);
  const refreshSecurity = useCallback(() => readJson<HostSecuritySnapshot>('/api/jarvis/security').then(setSecurity).catch(() => undefined), []);
  const refreshNight = useCallback(() => readJson<NightAgentView>('/api/jarvis/night').then(setNight).catch(() => undefined), []);
  const refreshReminders = useCallback(() => readJson<ReminderSnapshotView>('/api/jarvis/reminders').then(setReminders).catch(() => undefined), []);
  const refreshResearch = useCallback(() => readJson<LabResearchSnapshot>('/api/jarvis/research').then(setResearch).catch(() => undefined), []);
  const refreshWorkspace = useCallback(() => readJson<LabWorkspaceSnapshot>('/api/jarvis/workspace').then(setWorkspace).catch(() => undefined), []);
  const refreshCommandCenter = useCallback(() => readJson<CommandCenterClientSnapshot>('/api/jarvis/command-center').then(setCommandCenter).catch(() => undefined), []);
  const refreshOperator = useCallback(() => readJson<TrustedOperatorSnapshot>('/api/jarvis/operator').then(setOperator).catch(() => undefined), []);
  const refreshGraph = useCallback(() => readJson<GraphSnapshot>('/api/jarvis/memory/graph').then(setGraph).catch(() => undefined), []);

  useEffect(() => {
    void refreshStatus().catch(err => setError(safeError(err)));
    void refreshSystem();
    void refreshSecurity();
    void refreshNight();
    void refreshReminders();
    void refreshResearch();
    void refreshWorkspace();
    void refreshCommandCenter();
    void refreshOperator();
    void refreshGraph();
    try { setQualityMode(parseQualityMode(window.localStorage.getItem(QUALITY_STORAGE_KEY))); } catch { /* storage is optional */ }
  }, []);

  useEffect(() => {
    if (documentHidden) return;
    const foreground = window.setInterval(() => {
      void refreshSystem();
      void refreshCommandCenter();
      void refreshReminders();
      void refreshResearch();
      void refreshWorkspace();
      void refreshOperator();
    }, 5_000);
    const background = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
      void refreshSecurity();
      void refreshNight();
    }, 30_000);
    return () => { window.clearInterval(foreground); window.clearInterval(background); };
  }, [documentHidden, refreshCommandCenter, refreshNight, refreshOperator, refreshReminders, refreshResearch, refreshSecurity, refreshStatus, refreshSystem, refreshWorkspace]);

  useEffect(() => {
    const syncVisibility = () => setDocumentHidden(document.hidden);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(media.matches);
    syncVisibility();
    syncMotion();
    document.addEventListener('visibilitychange', syncVisibility);
    media.addEventListener('change', syncMotion);
    return () => { document.removeEventListener('visibilitychange', syncVisibility); media.removeEventListener('change', syncMotion); };
  }, []);

  useEffect(() => {
    const onPopState = () => setPage(parseJarvisPage(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (documentHidden) return;
    const source = new EventSource('/api/jarvis/events?stream=1');
    source.onmessage = () => { void refreshCommandCenter(); };
    return () => source.close();
  }, [documentHidden, refreshCommandCenter]);

  useEffect(() => () => {
    unsubMic.current?.();
    void microphone.current?.stop();
    player.current?.pause();
  }, []);

  const navigate = (next: JarvisPageId) => {
    const path = next === 'home' ? '/jarvis-lab' : `/jarvis-lab/${next}`;
    window.history.pushState(null, '', path);
    setPage(next);
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const postCommandCenter = async (url: string, body: Record<string, unknown>) => {
    setOpsBusy(true);
    try {
      const reply = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await reply.json() as CommandCenterClientSnapshot & { error?: string };
      if (!reply.ok) throw new Error(payload.error || `Command Center returned ${reply.status}`);
      setCommandCenter(payload);
    } catch (err) {
      setError(safeError(err));
    } finally {
      setOpsBusy(false);
    }
  };

  const postOperator = async (url: string, body: Record<string, unknown> = {}) => {
    setOpsBusy(true);
    try {
      const reply = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await reply.json() as { error?: string };
      if (!reply.ok) throw new Error(payload.error || `Owner control returned ${reply.status}`);
      await Promise.all([refreshOperator(), refreshCommandCenter()]);
    } catch (err) {
      setError(safeError(err));
    } finally {
      setOpsBusy(false);
    }
  };

  const playSpeech = (speech?: AskResponse['speech']) => {
    if (!speech || speech.status !== 'spoken' || !speech.audioBase64) {
      setSpeechState('idle');
      if (speech?.reason) setSpeechNote(speech.reason);
      return;
    }
    const generation = ++playGeneration.current;
    player.current?.pause();
    currentSpeechTurn.current = speech.turnId || null;
    const audio = new Audio(`data:${speech.mime || 'audio/mpeg'};base64,${speech.audioBase64}`);
    player.current = audio;
    setSpeechState('speaking');
    setSpeechNote(speech.fallback ? `Fallback voice ${speech.spokenProfileId || 'unknown'}` : null);
    audio.onended = () => { if (generation === playGeneration.current) { setSpeechState('idle'); currentSpeechTurn.current = null; } };
    audio.onerror = () => { if (generation === playGeneration.current) { setSpeechState('idle'); setSpeechNote('Local playback failed.'); } };
    void audio.play().catch(() => { setSpeechState('idle'); setSpeechNote('Local playback was blocked.'); });
  };

  const stopPlayback = () => {
    playGeneration.current += 1;
    player.current?.pause();
    player.current = null;
    setSpeechState('idle');
    const turnId = currentSpeechTurn.current;
    currentSpeechTurn.current = null;
    if (turnId) {
      void fetch('/api/jarvis/speak/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId }),
      }).catch(() => undefined);
    }
  };

  const askOnce = async (payloadText: string, spoken = false) => {
    const reply = await fetch('/api/jarvis/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payloadText,
        personaProfileId,
        voiceProfileId,
        oneTurn,
        capabilities: status?.capabilities?.ids.includes(payloadText) ? [payloadText] : [],
        speak: spoken || speakEnabled,
        actionSource: spoken ? 'voice' : 'text',
      }),
    });
    const payload = await reply.json() as AskResponse & { error?: string };
    if (!reply.ok) throw new Error(payload.error || `Ask returned ${reply.status}`);
    return payload;
  };

  const askStream = async (payloadText: string, spoken = false): Promise<AskResponse | null> => {
    const reply = await fetch('/api/jarvis/ask-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payloadText,
        personaProfileId,
        voiceProfileId,
        oneTurn,
        capabilities: status?.capabilities?.ids.includes(payloadText) ? [payloadText] : [],
        speak: spoken || speakEnabled,
        actionSource: spoken ? 'voice' : 'text',
      }),
    });
    if (!reply.ok || !reply.body) return null;
    const reader = reply.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: AskResponse | null = null;
    const consume = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as { type?: string; text?: string; payload?: AskResponse; error?: string };
        if (event.type === 'draft' && event.text) setDraft(event.text);
        if (event.type === 'final' && event.payload) finalPayload = event.payload;
        if (event.type === 'error' && event.error) throw new Error(event.error);
      } catch (err) {
        if (err instanceof SyntaxError) return;
        throw err;
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    consume(buffer);
    return finalPayload;
  };

  const settleConfirmation = async (decision: 'allow' | 'deny') => {
    if (!pendingConfirmation || confirming.current) return;
    confirming.current = true;
    setBusy(true);
    try {
      const reply = await fetch(decision === 'allow' ? '/api/jarvis/actions/confirm' : '/api/jarvis/actions/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: pendingConfirmation.proposalId,
          token: pendingConfirmation.token,
          sessionId: 'jarvis-lab',
          speak: speakEnabled,
          actionSource: 'ui',
        }),
      });
      const payload = await reply.json() as AskResponse & { error?: string };
      if (!reply.ok) throw new Error(payload.error || 'Confirmation failed.');
      setResponse(payload);
      setPendingConfirmation(payload.pendingConfirmation ?? null);
      playSpeech(payload.speech);
      void refreshStatus();
      void refreshCommandCenter();
      void refreshOperator();
    } catch (err) {
      setError(safeError(err));
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  };

  const submitAsk = async (event?: FormEvent, spokenText?: string) => {
    event?.preventDefault();
    const payloadText = (spokenText ?? text).trim();
    if (!payloadText || busy) return;
    const shell = interpretPresenceShellCommand(payloadText);
    if (shell.kind === 'control-center') {
      if (!window.location.pathname.startsWith('/jarvis-lab')) window.location.assign('/jarvis-lab');
      if (!spokenText) setText('');
      return;
    }
    if (shell.kind === 'presence') {
      window.location.assign('/jarvis');
      return;
    }
    const approvalTarget = resolvePresenceApproval({
      pendingConfirmation,
      waitingPermission: commandCenter?.permission,
    });
    const ownerReply = interpretPresenceOwnerReply(payloadText, approvalTarget);
    if (ownerReply.kind === 'allow' || ownerReply.kind === 'deny') {
      if (ownerReply.target.kind === 'confirm') await settleConfirmation(ownerReply.kind);
      else {
        const permission = commandCenter?.permission;
        const taskId = commandCenter?.task?.id || permission?.taskId;
        if (taskId) {
          if (ownerReply.kind === 'deny') await postCommandCenter('/api/jarvis/command-center/cancel', { taskId });
          else await postCommandCenter('/api/jarvis/command-center/grant', { taskId, stepId: permission?.stepId, proposalId: permission?.proposalId, capability: permission?.capability });
        }
      }
      if (!spokenText) setText('');
      return;
    }
    if (ownerReply.kind === 'unbound' || ownerReply.kind === 'ambiguous') {
      setError(ownerReply.kind === 'ambiguous'
        ? 'More than one permission is waiting. Allow Once binds a single request.'
        : 'Nothing is waiting for approval.');
      if (!spokenText) setText('');
      return;
    }
    setBusy(true);
    setError(null);
    setDraft('Working…');
    stopPlayback();
    if (spokenText || speakEnabled) setSpeechState('loading');
    try {
      const payload = await askStream(payloadText, Boolean(spokenText)) ?? await askOnce(payloadText, Boolean(spokenText));
      setResponse(payload);
      setPendingConfirmation(payload.pendingConfirmation ?? null);
      setResearch(payload.research ?? research);
      setWorkspace(payload.workspace ?? workspace);
      setDraft(null);
      if (!spokenText) setText('');
      const refIds = payload.result.memoryRefs.map(ref => ref.canonicalId);
      if (refIds.length) { pulses.current.emit({ kind: 'memory', nodeIds: refIds }); void refreshGraph(); }
      if (payload.result.toolResults.length) pulses.current.emit({ kind: 'response' });
      playSpeech(payload.speech);
      void refreshReminders();
      void refreshCommandCenter();
    } catch (err) {
      setDraft(null);
      setSpeechState('idle');
      setError(safeError(err));
    } finally {
      setBusy(false);
    }
  };

  const stopMic = async () => {
    unsubMic.current?.();
    unsubMic.current = null;
    await microphone.current?.stop();
  };

  const transcribe = async (turn: { turnId: string; pcm: Uint8Array; sampleRate: number; channels: number; captureDurationMs?: number }) => {
    await stopMic();
    setMicState('transcribing');
    try {
      const reply = await fetch('/api/jarvis/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Jarvis-Sample-Rate': String(turn.sampleRate),
          'X-Jarvis-Channels': String(turn.channels),
          'X-Jarvis-Turn-Id': turn.turnId,
          'X-Jarvis-Capture-Ms': String(turn.captureDurationMs ?? ''),
        },
        body: turn.pcm,
      });
      const payload = await reply.json() as { status?: string; text?: string; confidence?: number; reason?: string; error?: string };
      if (!reply.ok) throw new Error(payload.error || `STT returned ${reply.status}`);
      if (payload.status !== 'final' || !payload.text?.trim() || (payload.confidence ?? 1) < 0.8) {
        if (payload.text) { setText(payload.text); setHeard(payload.text); }
        throw new Error(payload.reason || 'Review the transcript before asking.');
      }
      setText(payload.text);
      setHeard(payload.text);
      setMicState('idle');
      await submitAsk(undefined, payload.text);
    } catch (err) {
      setMicState('idle');
      setError(safeError(err));
    }
  };

  const toggleMic = async () => {
    if (speechState === 'speaking' || speechState === 'loading') stopPlayback();
    if (busy || micState === 'transcribing') return;
    if (micState === 'listening') {
      const result = speechTurns.current.stopListening();
      await stopMic();
      if (result.kind === 'utterance') await transcribe(result.turn);
      else setMicState('idle');
      return;
    }
    try {
      if (!microphone.current) microphone.current = new BrowserMicrophoneInput();
      const started = speechTurns.current.startListening();
      if (!started.ok) throw new Error('Audio pipeline is busy.');
      unsubMic.current?.();
      unsubMic.current = microphone.current.onFrame(frame => {
        const result = speechTurns.current.pushFrame(frame);
        if (result.kind === 'utterance') void transcribe(result.turn);
      });
      await microphone.current.start();
      setHeard(null);
      setError(null);
      setMicState('listening');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setMicState(code === 'permission-denied' ? 'permission-denied' : 'unavailable');
      setError(safeError(err));
      await stopMic();
    }
  };

  const persistPresentation = async (nextPersona: string, nextVoice: string) => {
    if (oneTurn) return;
    const reply = await fetch('/api/jarvis/presentation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaProfileId: nextPersona, voiceProfileId: nextVoice }),
    });
    if (!reply.ok) throw new Error(`Presentation returned ${reply.status}`);
    const presentation = await reply.json() as RuntimeStatus['presentation'];
    setStatus(current => current ? { ...current, presentation } : current);
  };

  const setQuality = (mode: QualityMode) => {
    setQualityMode(mode);
    setWebglLost(false);
    try { window.localStorage.setItem(QUALITY_STORAGE_KEY, mode); } catch { /* optional */ }
  };

  const tools = useMemo(() => {
    const catalog = (status?.capabilities?.catalog ?? []).map(item => ({
      id: item.id,
      providerKind: item.providerKind,
      untrustedOutput: item.untrustedOutput,
      requiredService: item.requiredService,
    }));
    return (response?.result.toolResults ?? []).map(item => enrichToolActivity(item, catalog));
  }, [response, status]);
  const actionResults = response?.result.actionResults ?? [];
  const memoryRefs = response?.result.memoryRefs ?? [];
  const phase = deriveLabCorePhase({
    busy,
    error,
    statusReady: status?.ready,
    llmReachable: status?.llm?.reachable,
    coreState: response?.coreState || status?.coreState,
    hasResponse: Boolean(response),
    memoryCount: memoryRefs.length,
    toolCount: tools.length + actionResults.length,
    micState: micState === 'listening' || micState === 'transcribing' ? micState : 'idle',
    speechState,
    visualState: commandCenter?.visualState,
  });
  const mood = sceneMoodFor(phase, { nightActive: night?.status === 'running' });
  const effectiveQuality = resolveQualityLevel(qualityMode, 'high');
  const use3d = webglOk && !webglLost && qualityMode !== '2d';
  const coreLayers: CoreSceneLayers = { graph: false, rings: true, filaments: true, tools: false };
  const coreVisual = use3d ? (
    <Suspense fallback={<JarvisCoreVisual phase={phase} fx={reducedMotion ? 'off' : 'full'} memoryActive={memoryRefs.length > 0} toolActive={tools.length > 0} />}>
      <CoreScene
        mood={mood}
        quality={qualityPreset(effectiveQuality === '2d' ? 'minimal' : effectiveQuality)}
        reducedMotion={reducedMotion}
        hidden={documentHidden}
        graph={null}
        layers={coreLayers}
        visibleCategories={null}
        searchMatches={null}
        selectedId={null}
        pathIds={null}
        tools={[]}
        pulses={pulses.current}
        cameraAction={null}
        onSelectNode={() => undefined}
        onFps={() => undefined}
        onContextLost={() => setWebglLost(true)}
      />
    </Suspense>
  ) : <JarvisCoreVisual phase={phase} fx={reducedMotion ? 'off' : 'full'} memoryActive={memoryRefs.length > 0} toolActive={tools.length > 0} />;

  const pendingRisk: RiskBriefModel | null = pendingConfirmation?.preflight
    ? riskBriefFromPreflight(pendingConfirmation.preflight)
    : commandCenter?.permission.preflight
      ? riskBriefFromPreflight(commandCenter.permission.preflight)
      : pendingConfirmation ? {
          action: pendingConfirmation.displayName,
          why: pendingConfirmation.reason,
          risk: pendingConfirmation.risk || 'CONFIRM_REQUIRED',
          possibleImpact: ['The current capability contract did not expose detailed effects for this older proposal.'],
          changes: [pendingConfirmation.summary || 'Only the proposal-bound action declared by the capability.'],
          protection: ['Single-use proposal token', 'Owner confirmation', `Expires ${pendingConfirmation.expiresAt}`],
          rollback: 'not_declared',
          permissionScope: [pendingConfirmation.capabilityId, pendingConfirmation.target],
          target: pendingConfirmation.target,
        } : null;

  const shellStatuses: ShellStatus[] = [
    { label: 'Core', value: status?.ready ? 'Ready' : status ? 'Degraded' : 'Checking', tone: status?.ready ? 'active' : status ? 'warning' : 'neutral' },
    { label: 'Memory', value: status?.memory.attached ? 'Healthy' : status ? 'Unavailable' : 'Checking', tone: status?.memory.attached ? 'healthy' : status ? 'warning' : 'neutral' },
    { label: 'Security', value: operator?.emergency.active ? 'Stopped' : hostSecuritySummary(security), tone: operator?.emergency.active ? 'critical' : hostSecurityTone(security) },
    { label: 'Tasks', value: commandCenter?.task?.waitingPermission ? 'Waiting' : commandCenter?.task?.active ? 'Running' : 'Idle', tone: commandCenter?.task?.waitingPermission ? 'warning' : commandCenter?.task?.active ? 'active' : 'neutral' },
  ];

  const composer = (
    <form className="jai-composer" ref={askForm} onSubmit={submitAsk} aria-busy={busy}>
      <textarea
        ref={askField}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askForm.current?.requestSubmit(); }
        }}
        placeholder="Ask Jarvis anything…"
        rows={1}
        disabled={busy || micState === 'transcribing'}
        aria-label="Ask Jarvis"
      />
      <button type="button" className={`jai-composer__mic${micState === 'listening' ? ' is-live' : ''}`} onClick={() => { void toggleMic(); }} aria-label={micState === 'listening' ? 'Stop microphone' : 'Start microphone'}><Mic size={18} /></button>
      <button type="submit" className="jai-button jai-button--primary" disabled={busy || !text.trim()}>{busy ? 'Working' : 'Ask'} <Send size={16} /></button>
    </form>
  );

  const settings = (
    <div className="jai-settings-stack">
      <ControlChoice label="Persona" values={[['Jarvis', JARVIS_PERSONA_ID], ['Gam', GAM_PERSONA_ID]]} selected={personaProfileId} onSelect={value => { setPersonaProfileId(value); void persistPresentation(value, voiceProfileId).catch(err => setError(safeError(err))); }} />
      <ControlChoice label="Voice" values={[['Jarvis', JARVIS_VOICE_ID], ['Gam', GAM_VOICE_ID]]} selected={voiceProfileId} onSelect={value => { setVoiceProfileId(value); void persistPresentation(personaProfileId, value).catch(err => setError(safeError(err))); }} />
      <label className="jai-setting-toggle"><input type="checkbox" checked={oneTurn} onChange={event => setOneTurn(event.target.checked)} /><span><strong>One-turn presentation</strong><small>Do not persist this persona/voice choice.</small></span></label>
      <label className="jai-setting-toggle"><input type="checkbox" checked={speakEnabled} onChange={event => setSpeakEnabled(event.target.checked)} /><span><strong>Speak replies</strong><small>{speechNote || status?.presentation?.voice.reason || 'Uses the configured local voice route.'}</small></span><Volume2 size={17} /></label>
      <div className="jai-quality"><span><SlidersHorizontal size={16} /> Core quality</span>{(['auto', 'high', 'medium', 'minimal', '2d'] as QualityMode[]).map(mode => <button type="button" key={mode} className={qualityMode === mode ? 'is-active' : ''} onClick={() => setQuality(mode)}>{mode}</button>)}</div>
    </div>
  );

  const memoryExplorer = (
    <div className="jai-memory-explorer">
      <label><span>Search canonical memory</span><input value={memoryQuery} onChange={event => setMemoryQuery(event.target.value)} placeholder="Filter labels or IDs" /></label>
      {!graph?.attached ? <p className="jai-muted">Canonical memory graph is not attached.</p> : <ul>{graph.nodes.filter(node => `${node.label} ${node.id}`.toLowerCase().includes(memoryQuery.toLowerCase())).slice(0, 18).map(node => <li key={node.id}><strong>{node.label}</strong><span>{node.category} · confidence {Math.round(node.confidence * 100)}%</span><code>{node.id}</code></li>)}</ul>}
    </div>
  );

  const conversation: ConversationView = {
    answer: response?.presented.text,
    draft: draft || undefined,
    busy,
    error,
    route: response?.route,
    taskId: response?.taskId,
    workOutcome: response?.workOutcome,
    heard,
    timingsLine: formatTurnTimingsLine(response?.timings, response?.llm),
    memoryRefs,
    uncertainty: response?.result.uncertainty ?? [],
    tools,
    actionResults,
    modelMetrics: response?.llm,
  };

  return (
    <div className="jarvis-lab jai" data-quality={String(effectiveQuality)} data-hidden={documentHidden ? 'true' : 'false'}>
      <JarvisOperatingShell
        activePage={page}
        statuses={shellStatuses}
        pendingApprovals={pendingRisk || commandCenter?.permission.waiting ? 1 : 0}
        simulation={Boolean(commandCenter?.simulationMode)}
        onNavigate={navigate}
        onFocusAsk={() => askField.current?.focus()}
        emergencyAvailable={Boolean(operator)}
        emergencyActive={Boolean(operator?.emergency.active)}
        emergencyBusy={opsBusy}
        onEmergencyActivate={() => { void postOperator('/api/jarvis/emergency-stop', { reason: 'Owner activated Emergency Stop from the Jarvis interface.' }); }}
        onEmergencyResume={() => { void postOperator('/api/jarvis/emergency-resume', { reason: 'Owner explicitly resumed operation from the Jarvis interface.' }); }}
      >
        <JarvisPages
          page={page}
          status={status}
          system={system}
          security={security}
          night={night}
          reminders={reminders}
          research={research}
          workspace={workspace}
          commandCenter={commandCenter}
          operator={operator}
          graph={graph}
          coreTitle={phase}
          coreSubtitle={coreSubtitle(phase)}
          coreVisual={coreVisual}
          composer={composer}
          conversation={conversation}
          settings={settings}
          memoryExplorer={memoryExplorer}
          pendingRisk={pendingRisk}
          busy={busy || opsBusy}
          selectedSourceId={selectedSourceId}
          selectedDocumentId={selectedDocumentId}
          onNavigate={navigate}
          onSelectSource={setSelectedSourceId}
          onSelectDocument={setSelectedDocumentId}
          onRefreshWorkspace={() => { void fetch('/api/jarvis/workspace/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: workspace?.workspaceId || 'jarvis-project' }) }).then(() => refreshWorkspace()); }}
          onTask={objective => { void postCommandCenter('/api/jarvis/command-center/task', { objective }); }}
          onCancelTask={() => { if (commandCenter?.task?.id) void postCommandCenter('/api/jarvis/command-center/cancel', { taskId: commandCenter.task.id }); }}
          onGrantTask={() => { const permission = commandCenter?.permission; const taskId = commandCenter?.task?.id || permission?.taskId; if (taskId) void postCommandCenter('/api/jarvis/command-center/grant', { taskId, stepId: permission?.stepId, proposalId: permission?.proposalId, capability: permission?.capability }); }}
          onDemo={scenario => { void postCommandCenter('/api/jarvis/command-center/demo', { scenario }); }}
          onNight={action => { void postCommandCenter('/api/jarvis/command-center/night', { action }); }}
          onSimulation={enabled => { void postCommandCenter('/api/jarvis/command-center/control', { simulationMode: enabled }); }}
          onRevokeLease={leaseId => { void postOperator('/api/jarvis/leases/revoke', { leaseId }); }}
          onRollback={checkpointId => { void requestRecoveryRollback(checkpointId, personaProfileId, voiceProfileId, oneTurn).then(payload => { setResponse(payload); setPendingConfirmation(payload.pendingConfirmation ?? null); void refreshCommandCenter(); void refreshOperator(); }).catch(err => setError(safeError(err))); }}
          onReminder={(capabilityId, input) => { void requestReminderMutation(capabilityId, input, personaProfileId, voiceProfileId, oneTurn).then(() => refreshReminders()).catch(err => setError(safeError(err))); }}
          onAckReminder={(action, delivery, minutes) => { void ackReminder(action, delivery, minutes).then(setReminders).catch(err => setError(safeError(err))); }}
          onService={(capabilityId, serviceId) => { void requestServiceAction(capabilityId, serviceId, personaProfileId, voiceProfileId, oneTurn, speakEnabled).then(payload => { setResponse(payload); setPendingConfirmation(payload.pendingConfirmation ?? null); playSpeech(payload.speech); void refreshStatus(); }).catch(err => setError(safeError(err))); }}
        />
      </JarvisOperatingShell>
      <OwnerApprovalDialog
        open={Boolean(pendingRisk)}
        model={pendingRisk}
        busy={busy}
        onDeny={() => { void settleConfirmation('deny'); }}
        onAllow={() => { void settleConfirmation('allow'); }}
        onModify={() => { const target = pendingConfirmation?.target || ''; void settleConfirmation('deny'); setText(`Modify this request: ${target}`); navigate('assistant'); window.setTimeout(() => askField.current?.focus(), 0); }}
      />
    </div>
  );
}

function ControlChoice({ label, values, selected, onSelect }: { label: string; values: Array<[string, string]>; selected: string; onSelect: (value: string) => void }) {
  return <div className="jai-control-choice"><span>{label}</span><div>{values.map(([name, value]) => <button type="button" key={value} className={selected === value ? 'is-active' : ''} onClick={() => onSelect(value)}>{name}</button>)}</div></div>;
}

function coreSubtitle(phase: string) {
  const labels: Record<string, string> = {
    idle: 'Awaiting a request', listening: 'Listening for the owner', transcribing: 'Transcribing local audio', thinking: 'Processing the request', planning: 'Building a structured plan', searching: 'Reviewing sources', permission: 'Waiting for owner approval', executing: 'Executing the scoped next step', verifying: 'Verifying the result', memory: 'Canonical memory evidence attached', tool: 'Capability activity recorded', responding: 'Preparing the response', speaking: 'Speaking through the configured route', evolving: 'Running background evolution', reflecting: 'Recording a structured reflection', degraded: 'One or more required services are limited', error: 'Attention is required',
  };
  return labels[phase] || phase;
}

function hostSecuritySummary(security: HostSecuritySnapshot | null) {
  if (!security) return 'Checking';
  const states = [security.defender, security.firewall, security.tamperProtection, security.memoryIntegrity, security.virtualizationBasedSecurity, security.secureBoot, security.uac].map(item => item.state);
  if (security.weakenedByJarvis || states.includes('OFF')) return 'Attention';
  if (states.includes('UNKNOWN')) return 'Partially known';
  return 'Protected';
}

function hostSecurityTone(security: HostSecuritySnapshot | null): ShellStatus['tone'] {
  const summary = hostSecuritySummary(security);
  if (summary === 'Attention') return 'critical';
  if (summary === 'Partially known') return 'warning';
  if (summary === 'Protected') return 'healthy';
  return 'neutral';
}

async function requestReminderMutation(capabilityId: string, input: Record<string, unknown>, personaProfileId: string, voiceProfileId: string, oneTurn: boolean) {
  const reply = await fetch('/api/jarvis/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: capabilityId, personaProfileId, voiceProfileId, oneTurn, capabilityCalls: [{ id: capabilityId, input }], speak: false, actionSource: 'ui' }) });
  if (!reply.ok) throw new Error(`Reminder mutation returned ${reply.status}`);
}

async function ackReminder(action: 'dismiss' | 'complete' | 'snooze', delivery: ReminderSnapshotView['pendingDeliveries'][number], minutes?: number) {
  const reply = await fetch('/api/jarvis/reminders/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reminderId: delivery.reminderId, occurrenceAt: delivery.occurrenceAt, action, ...(minutes ? { minutes } : {}) }) });
  if (!reply.ok) throw new Error(`Reminder acknowledgement returned ${reply.status}`);
  return await reply.json() as ReminderSnapshotView;
}

async function requestServiceAction(capabilityId: 'jarvis.startService' | 'jarvis.restartService', serviceId: string, personaProfileId: string, voiceProfileId: string, oneTurn: boolean, speak: boolean) {
  const reply = await fetch('/api/jarvis/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `${capabilityId === 'jarvis.startService' ? 'Start' : 'Restart'} ${serviceId}`, personaProfileId, voiceProfileId, oneTurn, capabilityCalls: [{ id: capabilityId, input: { serviceId } }], speak, actionSource: 'ui' }) });
  const payload = await reply.json() as AskResponse & { error?: string };
  if (!reply.ok) throw new Error(payload.error || `Service action returned ${reply.status}`);
  return payload;
}

async function requestRecoveryRollback(checkpointId: string, personaProfileId: string, voiceProfileId: string, oneTurn: boolean) {
  const capabilityId = 'operator.sandbox.rollbackConfig';
  const rollbackId = `rollback_${Date.now().toString(36)}`;
  const reply = await fetch('/api/jarvis/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Restore the selected Jarvis recovery checkpoint',
      personaProfileId,
      voiceProfileId,
      oneTurn,
      capabilityCalls: [{ id: capabilityId, input: { checkpointId, rollbackId } }],
      speak: false,
      actionSource: 'ui',
    }),
  });
  const payload = await reply.json() as AskResponse & { error?: string };
  if (!reply.ok) throw new Error(payload.error || `Recovery rollback returned ${reply.status}`);
  return payload;
}
