import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Mic, Send, Volume2 } from 'lucide-react';
import { SpeechTurnController } from '../../audio/SpeechTurnController';
import { STANDALONE_VAD } from '../../audio/utteranceQuality';
import { JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from '../../presentation/types';
import type { CommandCenterClientSnapshot } from '../../standalone/commandCenterView';
import type { TrustedOperatorSnapshot } from '../../security/trustedOperatorRuntime';
import { BrowserMicrophoneInput } from '../browserMicrophone';
import JarvisCoreVisual from '../JarvisCoreVisual';
import type { LabPendingConfirmation } from '../labUiState';
import type { LabResearchSnapshot, ReminderSnapshotView, SystemHealthView } from '../labViewModels';
import { PulseBus } from '../three/pulseBus';
import { parseQualityMode, qualityPreset, QUALITY_STORAGE_KEY, resolveQualityLevel, type QualityMode } from '../three/quality';
import { sceneMoodFor } from '../three/sceneState';
import { webglAvailable } from '../three/webglAvailability';
import EmergencyStop, { riskBriefFromPreflight, type RiskBriefModel } from '../operating/TrustedOperator';
import type { PersonalAiRuntimeStatus } from '../operating/JarvisPages';
import { PresenceApproval } from './PresenceApproval';
import { PresenceHud } from './PresenceHud';
import {
  collectPresenceAttention,
  derivePresenceHud,
  derivePresencePhase,
  desktopAuthorityMaturity,
  formatAttentionSpoken,
  inferDesktopAuthorityClass,
  interpretPresenceOwnerReply,
  interpretPresenceShellCommand,
  isPresenceAmbientPath,
  presencePhaseLabel,
  presencePhaseToLab,
  resolvePresenceApproval,
} from './presenceRuntime';
import '../jarvis-lab.css';
import './presence.css';

const CoreScene = lazy(() => import('../three/CoreScene'));

type RuntimeStatus = PersonalAiRuntimeStatus;
type MicState = 'idle' | 'listening' | 'transcribing' | 'permission-denied' | 'unavailable';
type AskResponse = {
  presented: { text: string };
  result: {
    toolResults: Array<{ toolName: string; status: string; summary?: string }>;
    actionResults?: Array<{ name: string; status: string; summary?: string; capabilityId?: string }>;
    uncertainty: string[];
  };
  route?: { route: string };
  taskId?: string;
  workOutcome?: { outcome: string; text: string };
  pendingConfirmation?: LabPendingConfirmation;
  coreState: string;
  research?: LabResearchSnapshot;
  speech?: {
    status?: string;
    turnId?: string;
    mime?: string;
    audioBase64?: string;
    reason?: string;
    fallback?: boolean;
  };
};

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJson<T>(url: string): Promise<T> {
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`${url} returned ${reply.status}`);
  return await reply.json() as T;
}

export default function JarvisPresencePage() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [system, setSystem] = useState<SystemHealthView | null>(null);
  const [commandCenter, setCommandCenter] = useState<CommandCenterClientSnapshot | null>(null);
  const [operator, setOperator] = useState<TrustedOperatorSnapshot | null>(null);
  const [reminders, setReminders] = useState<ReminderSnapshotView | null>(null);
  const [research, setResearch] = useState<LabResearchSnapshot | null>(null);
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
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [lastAsk, setLastAsk] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const [ambient, setAmbient] = useState(() => isPresenceAmbientPath(window.location.pathname, window.location.search));
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [webglLost, setWebglLost] = useState(false);
  const [qualityMode, setQualityMode] = useState<QualityMode>('auto');

  const askField = useRef<HTMLTextAreaElement>(null);
  const microphone = useRef<BrowserMicrophoneInput | null>(null);
  const speechTurns = useRef(new SpeechTurnController(STANDALONE_VAD));
  const unsubMic = useRef<(() => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const currentSpeechTurn = useRef<string | null>(null);
  const playGeneration = useRef(0);
  const confirming = useRef(false);
  const pulses = useRef(new PulseBus());
  const webglOk = useMemo(() => webglAvailable(), []);

  const refreshStatus = useCallback(() => readJson<RuntimeStatus>('/api/jarvis/status').then(setStatus), []);
  const refreshSystem = useCallback(() => readJson<SystemHealthView>('/api/jarvis/system').then(setSystem).catch(() => undefined), []);
  const refreshCommandCenter = useCallback(() => readJson<CommandCenterClientSnapshot>('/api/jarvis/command-center').then(setCommandCenter).catch(() => undefined), []);
  const refreshOperator = useCallback(() => readJson<TrustedOperatorSnapshot>('/api/jarvis/operator').then(setOperator).catch(() => undefined), []);
  const refreshReminders = useCallback(() => readJson<ReminderSnapshotView>('/api/jarvis/reminders').then(setReminders).catch(() => undefined), []);
  const refreshResearch = useCallback(() => readJson<LabResearchSnapshot>('/api/jarvis/research').then(setResearch).catch(() => undefined), []);

  useEffect(() => {
    document.title = ambient ? 'JARVIS — Ambient Presence' : 'JARVIS';
  }, [ambient]);

  useEffect(() => {
    void refreshStatus().catch(err => setError(safeError(err)));
    void refreshSystem();
    void refreshCommandCenter();
    void refreshOperator();
    void refreshReminders();
    void refreshResearch();
    try { setQualityMode(parseQualityMode(window.localStorage.getItem(QUALITY_STORAGE_KEY))); } catch { /* optional */ }
  }, []);

  useEffect(() => {
    if (documentHidden) return;
    const fast = window.setInterval(() => {
      void refreshCommandCenter();
      void refreshReminders();
      void refreshOperator();
    }, 5_000);
    const slow = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
      void refreshSystem();
    }, 30_000);
    const tick = window.setInterval(() => setClock(new Date()), 15_000);
    return () => { window.clearInterval(fast); window.clearInterval(slow); window.clearInterval(tick); };
  }, [documentHidden, refreshCommandCenter, refreshOperator, refreshReminders, refreshStatus, refreshSystem]);

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

  const setAmbientMode = (next: boolean) => {
    setAmbient(next);
    const url = next ? '/jarvis?mode=ambient' : '/jarvis';
    window.history.replaceState(null, '', url);
  };

  const openControlCenter = () => { window.location.assign('/jarvis-lab'); };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        openControlCenter();
      } else if ((event.ctrlKey || event.metaKey) && event.key === '.') {
        event.preventDefault();
        setAmbientMode(!ambient);
      } else if (event.key === 'Escape') {
        setEmergencyOpen(false);
        if (ambient) setAmbientMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ambient]);

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
      return;
    }
    const generation = ++playGeneration.current;
    player.current?.pause();
    currentSpeechTurn.current = speech.turnId || null;
    const audio = new Audio(`data:${speech.mime || 'audio/mpeg'};base64,${speech.audioBase64}`);
    player.current = audio;
    setSpeechState('speaking');
    audio.onended = () => { if (generation === playGeneration.current) { setSpeechState('idle'); currentSpeechTurn.current = null; } };
    audio.onerror = () => { if (generation === playGeneration.current) setSpeechState('idle'); };
    void audio.play().catch(() => setSpeechState('idle'));
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

  const approvalTarget = resolvePresenceApproval({
    pendingConfirmation,
    waitingPermission: commandCenter?.permission,
  });

  const pendingRisk: RiskBriefModel | null = pendingConfirmation?.preflight
    ? riskBriefFromPreflight(pendingConfirmation.preflight)
    : commandCenter?.permission.preflight
      ? riskBriefFromPreflight(commandCenter.permission.preflight)
      : pendingConfirmation ? {
          action: pendingConfirmation.displayName,
          why: pendingConfirmation.reason,
          risk: pendingConfirmation.risk || 'CONFIRM_REQUIRED',
          changes: [pendingConfirmation.summary || 'Only the proposal-bound action declared by the capability.'],
          protection: ['Single-use proposal token', 'Owner confirmation'],
          rollback: 'not_declared',
          permissionScope: [pendingConfirmation.capabilityId],
          target: pendingConfirmation.target,
        } : commandCenter?.permission.waiting ? {
          action: commandCenter.permission.capability || 'Scoped task permission',
          why: 'This step waits for a request-bound owner decision.',
          risk: 'CONFIRM_REQUIRED',
          rollback: 'not_declared',
          permissionScope: [commandCenter.permission.capability || 'task'],
        } : null;

  const settleConfirm = async (decision: 'allow' | 'deny') => {
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
          decision,
          sessionId: 'jarvis-lab',
          speak: speakEnabled,
          actionSource: 'ui',
        }),
      });
      const payload = await reply.json() as AskResponse & { error?: string };
      if (!reply.ok) throw new Error(payload.error || `Confirmation returned ${reply.status}`);
      setResponse(payload);
      setPendingConfirmation(payload.pendingConfirmation ?? null);
      playSpeech(payload.speech);
      void refreshCommandCenter();
      void refreshOperator();
    } catch (err) {
      setError(safeError(err));
    } finally {
      confirming.current = false;
      setBusy(false);
    }
  };

  const settleGrant = async (decision: 'allow' | 'deny') => {
    const permission = commandCenter?.permission;
    const taskId = commandCenter?.task?.id || permission?.taskId;
    if (!taskId) return;
    setOpsBusy(true);
    try {
      if (decision === 'deny') {
        await fetch('/api/jarvis/command-center/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
      } else {
        const reply = await fetch('/api/jarvis/command-center/grant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            stepId: permission?.stepId,
            proposalId: permission?.proposalId,
            capability: permission?.capability,
          }),
        });
        const payload = await reply.json() as { error?: string };
        if (!reply.ok) throw new Error(payload.error || `Grant returned ${reply.status}`);
      }
      await refreshCommandCenter();
    } catch (err) {
      setError(safeError(err));
    } finally {
      setOpsBusy(false);
    }
  };

  const settleApproval = async (decision: 'allow' | 'deny') => {
    if (approvalTarget.kind === 'confirm') return settleConfirm(decision);
    if (approvalTarget.kind === 'grant') return settleGrant(decision);
  };

  const askOnce = async (payloadText: string, spoken = false) => {
    const reply = await fetch('/api/jarvis/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payloadText,
        personaProfileId: JARVIS_PERSONA_ID,
        voiceProfileId: JARVIS_VOICE_ID,
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
        personaProfileId: JARVIS_PERSONA_ID,
        voiceProfileId: JARVIS_VOICE_ID,
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
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    if (buffer.trim()) consume(buffer);
    return finalPayload;
  };

  const speakLocal = (message: string) => {
    setResponse({
      presented: { text: message },
      result: { toolResults: [], uncertainty: [] },
      coreState: 'IDLE',
    });
  };

  const submitAsk = async (event?: FormEvent, spokenText?: string) => {
    event?.preventDefault();
    const payloadText = (spokenText ?? text).trim();
    if (!payloadText || busy) return;

    const shell = interpretPresenceShellCommand(payloadText);
    if (shell.kind === 'presence') {
      window.location.assign('/jarvis');
      return;
    }
    if (shell.kind === 'control-center') {
      if (!spokenText) setText('');
      openControlCenter();
      return;
    }
    if (shell.kind === 'ambient-on') {
      if (!spokenText) setText('');
      setAmbientMode(true);
      speakLocal('Ambient presence mode.');
      return;
    }
    if (shell.kind === 'ambient-off') {
      if (!spokenText) setText('');
      setAmbientMode(false);
      return;
    }
    if (shell.kind === 'emergency-stop') {
      if (!spokenText) setText('');
      setEmergencyOpen(true);
      return;
    }

    const reply = interpretPresenceOwnerReply(payloadText, approvalTarget);
    if (reply.kind === 'allow' || reply.kind === 'deny') {
      await settleApproval(reply.kind);
      if (!spokenText) setText('');
      return;
    }
    if (reply.kind === 'unbound') {
      speakLocal('Nothing is waiting for approval. Say the request you want instead.');
      if (!spokenText) setText('');
      return;
    }
    if (reply.kind === 'ambiguous') {
      speakLocal('More than one permission is waiting. Choose Allow Once on the exact request.');
      if (!spokenText) setText('');
      return;
    }

    if (shell.kind === 'attention') {
      const spoken = formatAttentionSpoken(collectPresenceAttention({
        emergencyActive: operator?.emergency.active,
        waitingPermission: commandCenter?.permission.waiting,
        permissionLabel: commandCenter?.permission.capability,
        waitingOwnerInput: commandCenter?.task?.waitingOwnerInput,
        waitingQuestion: commandCenter?.task?.waitingInput?.question,
        reminderPendingCount: reminders?.scheduler.pendingCount,
        taskActive: commandCenter?.task?.active,
        taskObjective: commandCenter?.task?.objective,
        degraded: status?.ready === false,
      }));
      speakLocal(spoken);
      if (!spokenText) setText('');
      return;
    }

    setLastAsk(payloadText);
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
      setDraft(null);
      if (!spokenText) setText('');
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

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitAsk();
    }
  };

  const phase = derivePresencePhase({
    busy,
    error,
    ready: status?.ready,
    llmReachable: status?.llm?.reachable,
    micState: micState === 'listening' || micState === 'transcribing' ? micState : 'idle',
    speechState,
    visualState: commandCenter?.visualState,
    emergencyActive: operator?.emergency.active,
    waitingPermission: commandCenter?.permission.waiting || Boolean(pendingConfirmation),
    waitingOwnerInput: commandCenter?.task?.waitingOwnerInput,
    taskActive: commandCenter?.task?.active,
  });
  const labPhase = presencePhaseToLab(phase);
  const mood = sceneMoodFor(labPhase);
  const effectiveQuality = resolveQualityLevel(qualityMode, 'high');
  const use3d = webglOk && !webglLost && qualityMode !== '2d';
  const attention = collectPresenceAttention({
    emergencyActive: operator?.emergency.active,
    waitingPermission: commandCenter?.permission.waiting || Boolean(pendingConfirmation),
    permissionLabel: pendingConfirmation?.displayName || commandCenter?.permission.capability,
    waitingOwnerInput: commandCenter?.task?.waitingOwnerInput,
    waitingQuestion: commandCenter?.task?.waitingInput?.question,
    reminderPendingCount: reminders?.scheduler.pendingCount,
    taskActive: commandCenter?.task?.active,
    taskObjective: commandCenter?.task?.objective,
    degraded: status?.ready === false,
  });
  const desktopClass = inferDesktopAuthorityClass(lastAsk);
  const hudKind = derivePresenceHud({
    phase,
    waitingPermission: commandCenter?.permission.waiting || Boolean(pendingConfirmation),
    waitingOwnerInput: commandCenter?.task?.waitingOwnerInput,
    taskActive: commandCenter?.task?.active,
    verificationComplete: commandCenter?.task?.verification?.state === 'VERIFIED',
    researchActive: Boolean(research?.last?.sources.length) && /research|ค้นหา|qwen/i.test(lastAsk + (response?.presented.text ?? '')),
    researchSources: research?.last?.sources.length,
    systemAsked: /system status|สถานะระบบ|runtime/i.test(lastAsk),
    reminderPending: (reminders?.scheduler.pendingCount ?? 0) > 0,
    reminderActive: /remind|เตือน/i.test(lastAsk),
    cctvAsked: /cctv|camera|กล้อง/i.test(lastAsk),
    mediaAsked: /spotify|music|เพลง|youtube/i.test(lastAsk),
    desktopAsked: Boolean(desktopClass),
    attentionCount: attention.length,
  });
  const showPermission = Boolean(pendingRisk) && (approvalTarget.kind === 'confirm' || approvalTarget.kind === 'grant');
  const approvalLabel = approvalTarget.kind === 'confirm' || approvalTarget.kind === 'grant' ? approvalTarget.label : 'this request';
  const answer = draft || response?.presented.text || response?.workOutcome?.text;
  const tone = phase === 'EMERGENCY_STOP' || phase === 'CRITICAL' ? 'critical' : phase === 'WARNING' || phase === 'WAITING_OWNER' ? 'warning' : phase === 'IDLE' ? 'ok' : undefined;
  const timeLabel = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(clock);
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(clock);
  const systemLines = system ? [
    system.cpu ? `CPU ${Math.round(system.cpu.usagePct)}%` : null,
    system.ram ? `RAM ${Math.round(system.ram.usedPct)}%` : null,
    system.gpu?.name ? system.gpu.name : null,
  ].filter((line): line is string => Boolean(line)) : [];

  const coreVisual = use3d ? (
    <Suspense fallback={<JarvisCoreVisual phase={labPhase} fx={reducedMotion ? 'off' : 'full'} memoryActive={false} toolActive={hudKind === 'research'} />}>
      <CoreScene
        mood={mood}
        quality={qualityPreset(effectiveQuality === '2d' ? 'minimal' : effectiveQuality)}
        reducedMotion={reducedMotion}
        hidden={documentHidden}
        graph={null}
        layers={{ graph: false, rings: true, filaments: true, tools: hudKind === 'research' || hudKind === 'execution' }}
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
  ) : <JarvisCoreVisual phase={labPhase} fx={reducedMotion ? 'off' : 'full'} memoryActive={false} toolActive={false} />;

  return (
    <div className="jp jai" data-ambient={ambient ? 'true' : 'false'} data-hidden={documentHidden ? 'true' : 'false'} data-phase={phase}>
      <div className="jp-orbit" aria-hidden="true" />
      <header className="jp-mark">
        <strong>JARVIS</strong>
        <span>{ambient ? 'Ambient presence' : 'Presence'}</span>
      </header>
      <div className="jp-clock">
        <time dateTime={clock.toISOString()}>{timeLabel}</time>
        <small>{dateLabel}</small>
      </div>
      <div className="jp-state" data-tone={tone}>
        <em>{phase.replaceAll('_', ' ')}</em>
        <p>{presencePhaseLabel(phase)}</p>
      </div>
      {attention[0] && hudKind !== 'permission' ? (
        <div className="jp-attention" data-tone={attention[0].tone}>
          <span>Attention</span>
          <p>{attention[0].title}</p>
        </div>
      ) : null}
      <div className="jp-core">{coreVisual}</div>
      {showPermission && pendingRisk ? (
        <PresenceApproval
          model={pendingRisk}
          busy={busy || opsBusy}
          spokenPrompt={`I need approval for ${approvalLabel}. Proceed?`}
          onDeny={() => { void settleApproval('deny'); }}
          onAllow={() => { void settleApproval('allow'); }}
        />
      ) : (
        <PresenceHud
          kind={hudKind === 'permission' ? 'none' : hudKind}
          phase={phase}
          researchSources={research?.last?.sources.map(source => ({ id: source.sourceId, title: source.title || source.domain, url: source.url, status: source.status }))}
          systemLines={systemLines}
          taskObjective={commandCenter?.task?.objective}
          taskStatus={commandCenter?.task?.status}
          stepsDone={commandCenter?.task?.steps.filter(step => step.state === 'done').length}
          stepsTotal={commandCenter?.task?.steps.length}
          verificationState={commandCenter?.task?.verification?.state}
          verificationSummary={commandCenter?.task?.verification?.summary}
          reminderTitle={reminders?.pendingDeliveries[0]?.title || reminders?.reminders[0]?.title}
          waitingQuestion={commandCenter?.task?.waitingInput?.question}
          simulated={commandCenter?.simulationMode}
          desktopNote={desktopClass ? desktopAuthorityMaturity(desktopClass).note : undefined}
          cctvNote="Camera context is prepared. Live CCTV stays PREPARE_CONTRACT until a reviewed provider is accepted."
        />
      )}
      {error ? <p className="jp-error">{error}</p> : null}
      {!ambient ? (
        <div className="jp-dock">
          <div className="jp-reply" data-empty={answer ? 'false' : 'true'}>
            {heard ? <div className="jp-heard">{heard}</div> : null}
            {answer || 'Speak or type. Jarvis will operate the system.'}
          </div>
          <form className="jp-composer" onSubmit={submitAsk} aria-busy={busy}>
            <button type="button" className={`jp-icon${micState === 'listening' ? ' is-on' : ''}`} onClick={() => { void toggleMic(); }} aria-label="Listen" disabled={busy}>
              <Mic size={16} />
            </button>
            <textarea
              ref={askField}
              rows={1}
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={onComposerKey}
              placeholder="Talk to Jarvis"
              aria-label="Talk to Jarvis"
            />
            <button type="button" className={`jp-icon${speakEnabled ? ' is-on' : ''}`} onClick={() => setSpeakEnabled(value => !value)} aria-label="Speech">
              <Volume2 size={16} />
            </button>
            <button type="submit" className="jp-send" disabled={busy || !text.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </form>
        </div>
      ) : null}
      <nav className="jp-ghost">
        <button type="button" onClick={openControlCenter}>Control Center</button>
        <button type="button" onClick={() => setAmbientMode(!ambient)}>{ambient ? 'Leave ambient' : 'Ambient'}</button>
        <button type="button" onClick={() => setEmergencyOpen(true)}>Emergency Stop</button>
      </nav>
      <EmergencyStop
        open={emergencyOpen || Boolean(operator?.emergency.active)}
        available={Boolean(operator)}
        active={Boolean(operator?.emergency.active)}
        busy={opsBusy}
        onClose={() => setEmergencyOpen(false)}
        onActivate={() => { void postOperator('/api/jarvis/emergency-stop', { reason: 'Owner activated Emergency Stop from Jarvis Presence.' }); }}
        onResume={() => { void postOperator('/api/jarvis/emergency-resume', { reason: 'Owner explicitly resumed operation from Jarvis Presence.' }); }}
      />
    </div>
  );
}
