import type { WorkAgent } from '../agent/engine';
import type { WorkTask } from '../agent/types';
import { routeJarvisRequest, type RouteDecision } from '../intent/requestRouter';
import type { ResourcePriority } from '../ops/types';
import { GAM_PERSONA_ID, GAM_VOICE_ID, JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from '../presentation/types';
import { decideBargeIn, isMutatingWork } from './bargeIn';
import { classifyInterruption } from './classifyInterruption';
import { PlaybackClock, syncPresenterPlayback } from './playbackClock';
import { VoicePriorityBroker } from './priorityBroker';
import { assertIndependentPersonaVoice, defaultIndependentProfiles } from './personaVoice';
import { MockSttPort, MockTtsPort } from './mockProviders';
import { decideStreaming } from './streamingPolicy';
import type {
  BargeInDecision,
  InterruptionKind,
  SttPort,
  StreamingDecision,
  TtsPort,
  VoiceTurnSnapshot,
  VoiceTurnState,
} from './types';
import { transitionVoiceTurn } from './voiceTurnMachine';
import type { PresentationModel } from '../presentation/briefing/types';

export type VoiceInteractionOptions = {
  stt?: SttPort;
  tts?: TtsPort;
  agent?: WorkAgent;
  simulated?: boolean;
};

export type VoiceTurnResult = VoiceTurnSnapshot & {
  route?: RouteDecision;
  streaming?: StreamingDecision;
  bargeIn?: BargeInDecision;
  spoken?: { status: 'spoken' | 'cancelled' | 'unavailable' };
  transcript?: string;
  presentation?: PresentationModel;
};

/**
 * Coordinates listen → STT → route → think/work → speak → barge-in.
 * Mockable STT/TTS. Does not persist PCM. Not LIVE_VERIFIED.
 */
export class VoiceInteractionRuntime {
  public readonly clock = new PlaybackClock();
  public readonly priority = new VoicePriorityBroker();
  public readonly stt: SttPort;
  public readonly tts: TtsPort;
  private readonly agent?: WorkAgent;
  private state: VoiceTurnState = 'IDLE';
  private turnId: string | null = null;
  private cancelled = false;
  private bargeInFlag = false;
  private interruptionKind?: InterruptionKind;
  private personaProfileId = JARVIS_PERSONA_ID;
  private voiceProfileId = JARVIS_VOICE_ID;
  private error?: string;
  private provider?: 'stt' | 'tts' | 'none';
  private lastTaskId?: string;
  private briefing?: PresentationModel;
  private lastStreaming?: StreamingDecision;

  constructor(options: VoiceInteractionOptions = {}) {
    this.stt = options.stt ?? new MockSttPort();
    this.tts = options.tts ?? new MockTtsPort();
    this.agent = options.agent;
  }

  public snapshot(): VoiceTurnSnapshot {
    return {
      state: this.state,
      turnId: this.turnId,
      cancelled: this.cancelled,
      bargeInActive: this.bargeInFlag,
      interruptionKind: this.interruptionKind,
      playbackSource: this.clock.snapshot().source,
      playbackElapsedMs: this.clock.elapsedMs(),
      personaProfileId: this.personaProfileId,
      voiceProfileId: this.voiceProfileId,
      provider: this.provider,
      error: this.error,
    };
  }

  public resourcePriority(): ResourcePriority {
    return this.priority.current();
  }

  public selectPersona(personaProfileId: string): VoiceTurnSnapshot {
    const previousVoice = this.voiceProfileId;
    this.personaProfileId = personaProfileId;
    const check = assertIndependentPersonaVoice({
      personaProfileId: this.personaProfileId,
      voiceProfileId: this.voiceProfileId,
      previousVoiceProfileId: previousVoice,
      changed: 'persona',
    });
    if (!check.voiceUnchangedByPersona) this.voiceProfileId = previousVoice;
    return this.snapshot();
  }

  public selectVoice(voiceProfileId: string): VoiceTurnSnapshot {
    const previousPersona = this.personaProfileId;
    this.voiceProfileId = voiceProfileId;
    const check = assertIndependentPersonaVoice({
      personaProfileId: this.personaProfileId,
      voiceProfileId: this.voiceProfileId,
      previousPersonaProfileId: previousPersona,
      changed: 'voice',
    });
    if (!check.personaUnchangedByVoice) this.personaProfileId = previousPersona;
    return this.snapshot();
  }

  public listen(): VoiceTurnSnapshot {
    this.enter('LISTENING');
    this.cancelled = false;
    this.bargeInFlag = false;
    this.interruptionKind = undefined;
    this.error = undefined;
    this.provider = undefined;
    this.turnId = `voice-${Date.now()}`;
    this.stt.listen();
    if (!this.stt.available()) return this.fail('stt', 'STT provider unavailable');
    return this.snapshot();
  }

  public async transcribe(text: string): Promise<VoiceTurnResult> {
    if (this.state === 'IDLE' || this.state === 'ERROR') this.enter('LISTENING');
    if (this.state === 'LISTENING' || this.state === 'INTERRUPTED') this.enter('TRANSCRIBING');
    if (!this.stt.available()) return this.fail('stt', 'STT provider unavailable');
    const turnId = this.turnId || `voice-${Date.now()}`;
    this.turnId = turnId;
    const result = await this.stt.transcribe(turnId, text);
    if (result.status !== 'ok') return this.fail('stt', 'STT provider unavailable');
    return { ...this.snapshot(), transcript: result.text };
  }

  public think(text: string): VoiceTurnResult {
    if (this.state === 'ERROR') return { ...this.snapshot(), transcript: text };
    if (
      this.state === 'IDLE'
      || this.state === 'LISTENING'
      || this.state === 'TRANSCRIBING'
      || this.state === 'INTERRUPTED'
    ) {
      this.enter('THINKING');
    }
    const route = routeJarvisRequest({ text });
    const streaming = decideStreaming({ route: route.route, agentic: route.agentic });
    this.lastStreaming = streaming;
    if (route.agentic) this.enter('WORKING');
    return { ...this.snapshot(), route, streaming, transcript: text };
  }

  public waitingOwner(task?: WorkTask): VoiceTurnSnapshot {
    this.lastTaskId = task?.id;
    this.enter('WAITING_OWNER');
    return this.snapshot();
  }

  public attachBriefing(model: PresentationModel): PresentationModel {
    this.briefing = model;
    return model;
  }

  public async speak(text: string, briefing?: PresentationModel): Promise<VoiceTurnResult> {
    if (briefing) this.briefing = briefing;
    if (!this.tts.available()) return this.fail('tts', 'TTS provider unavailable');
    const turnId = this.turnId || `voice-${Date.now()}`;
    this.turnId = turnId;
    this.enter('SPEAKING');
    this.clock.startSpeech();
    const spoken = await this.tts.speak(turnId, text);
    if (spoken.status === 'unavailable') return this.fail('tts', 'TTS provider unavailable');
    if (spoken.status === 'cancelled' || this.cancelled) {
      this.clock.cancel();
      if (this.briefing) {
        this.briefing = { ...this.briefing, playback: { ...this.briefing.playback, playbackState: 'cancelled' } };
      }
      return { ...this.snapshot(), spoken, streaming: this.lastStreaming, presentation: this.briefing };
    }
    this.clock.setSpeechElapsed(this.tts.elapsedMs());
    if (this.briefing) this.briefing = syncPresenterPlayback(this.briefing, this.clock);
    this.clock.stopSpeech(true);
    this.enter('IDLE');
    return { ...this.snapshot(), spoken, streaming: this.lastStreaming, presentation: this.briefing };
  }

  public async cancelSpeak(): Promise<VoiceTurnSnapshot> {
    if (this.turnId) await this.tts.cancel(this.turnId);
    this.cancelled = true;
    this.clock.cancel();
    if (this.state === 'SPEAKING') this.enter('INTERRUPTED');
    if (this.briefing) {
      this.briefing = { ...this.briefing, playback: { ...this.briefing.playback, playbackState: 'cancelled' } };
    }
    return this.snapshot();
  }

  public async resumeSpeak(): Promise<VoiceTurnResult> {
    if (!this.turnId) return this.snapshot();
    if (!this.tts.available()) return this.fail('tts', 'TTS provider unavailable');
    this.cancelled = false;
    if (this.state !== 'SPEAKING') this.enter('SPEAKING');
    this.clock.startSpeech();
    const spoken = await this.tts.resume(this.turnId);
    if (spoken.status === 'unavailable') return this.fail('tts', 'TTS provider unavailable');
    if (spoken.status === 'cancelled') {
      this.clock.cancel();
      if (this.state === 'SPEAKING') this.enter('INTERRUPTED');
      return { ...this.snapshot(), spoken, presentation: this.briefing };
    }
    this.clock.setSpeechElapsed(this.tts.elapsedMs());
    if (this.briefing) this.briefing = syncPresenterPlayback(this.briefing, this.clock);
    this.clock.stopSpeech(true);
    this.enter('IDLE');
    return { ...this.snapshot(), spoken, presentation: this.briefing };
  }

  public async bargeIn(text: string, task?: WorkTask): Promise<VoiceTurnResult> {
    const speaking = this.state === 'SPEAKING';
    const kind = classifyInterruption(text);
    this.interruptionKind = kind;
    this.bargeInFlag = true;
    const decision = decideBargeIn({ kind, speaking, task: task ?? this.activeTask() });
    if (decision.cancelPlayback) await this.cancelSpeak();
    this.applyWorkAction(decision.workAction, task);
    if (this.state !== decision.nextState) {
      if (this.state === 'SPEAKING' && decision.nextState !== 'INTERRUPTED') {
        this.enter('INTERRUPTED');
      }
      if (this.state !== decision.nextState) this.enter(decision.nextState);
    }
    return { ...this.snapshot(), bargeIn: decision, bargeInActive: true, transcript: text };
  }

  public async runTurn(text: string): Promise<VoiceTurnResult> {
    this.listen();
    const transcribed = await this.transcribe(text);
    if (transcribed.state === 'ERROR') return transcribed;
    const thought = this.think(text);
    if (thought.route?.agentic) {
      return { ...thought, streaming: thought.streaming };
    }
    if (thought.streaming?.mayBeginPresentation) {
      return this.speak(text);
    }
    return thought;
  }

  public grantAndContinue(): VoiceTurnSnapshot {
    if (this.state === 'WAITING_OWNER') this.enter('WORKING');
    return this.snapshot();
  }

  public presentation(): PresentationModel | undefined {
    return this.briefing;
  }

  public profiles(): { personaProfileId: string; voiceProfileId: string } {
    return { personaProfileId: this.personaProfileId, voiceProfileId: this.voiceProfileId };
  }

  private activeTask(): WorkTask | undefined {
    if (!this.agent) return undefined;
    return this.agent.store.active()[0];
  }

  private applyWorkAction(action: BargeInDecision['workAction'], task?: WorkTask): void {
    const current = task ?? this.activeTask();
    if (!current || action === 'none' || action === 'cancel') return;
    if (isMutatingWork(current)) return;
    if (!this.agent?.store.get(current.id)) return;
    if (action === 'pause') {
      try {
        this.agent.pause(current.id);
      } catch {
        /* barge-in preserves work if pause is not a legal task transition */
      }
    }
  }

  private enter(next: VoiceTurnState): void {
    if (this.state !== next) this.state = transitionVoiceTurn(this.state, next);
    this.priority.setVoiceState(this.state);
  }

  private fail(provider: 'stt' | 'tts', message: string): VoiceTurnResult {
    this.provider = provider;
    this.error = message;
    if (this.state !== 'ERROR') this.enter('ERROR');
    return this.snapshot();
  }
}

export { defaultIndependentProfiles, GAM_PERSONA_ID, GAM_VOICE_ID, JARVIS_PERSONA_ID, JARVIS_VOICE_ID };
