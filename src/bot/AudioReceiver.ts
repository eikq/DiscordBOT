import { VoiceConnection, EndBehaviorType } from '@discordjs/voice';
import { SafeOpusDecoder } from './SafeOpusDecoder';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import { SpeechToTextProvider, SpeechStream } from './stt/SpeechToTextProvider';
import { SocialBrain } from './brain/SocialBrain';
import { GroupConversationState } from './brain/GroupConversationState';
import { ResponseGenerator } from './personality/ResponseGenerator';
import { DiscordJarvisAdapter } from '../jarvis/clients/discord/DiscordJarvisAdapter';
import { ResponseGeneratorPresentationEngine } from '../jarvis/clients/discord/ResponseGeneratorPresentationEngine';
import { defaultJarvisPresentation, legacyVoiceCommandProfile } from '../jarvis/presentation/compatibility';
import type { PresentationProfile } from '../jarvis/presentation/types';
import { Client, VoiceChannel } from 'discord.js';
import { VoiceConnectionManager } from './VoiceConnectionManager';
import { VoiceOutputManager } from './tts/VoiceOutputManager';
import { FriendMemoryManager } from './memory/FriendMemoryManager';
import { VoiceConsentManager } from './voice/VoiceConsentManager';
import { VoiceServiceClient } from './voice/VoiceServiceClient';
import { PersonaProfile } from './personality/PersonaProfileManager';
import { VoiceDatasetWriter, VoiceTranscriptData, type VoiceUtteranceRecord } from './voice/VoiceDatasetWriter';
import { SocialMemoryBrain } from './memory/SocialMemoryBrain';
import { TranscriptFinalEvent } from './types/events';
import { SustainedVoiceDetector } from './audio/SustainedVoiceDetector';

export type BotState = 'LISTENING' | 'PREDICTING' | 'GENERATING' | 'SPEAKING' | 'INTERRUPTED' | 'COOLDOWN';

function readTiming(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback;
}

const SPEECH_END_SILENCE_MS = readTiming('VOICE_END_SILENCE_MS', 650, 300, 2_000);
const UTTERANCE_GRACE_MS = readTiming('VOICE_UTTERANCE_GRACE_MS', 350, 0, 1_500);
const RESPONSE_COOLDOWN_MS = readTiming('VOICE_RESPONSE_COOLDOWN_MS', 700, 0, 5_000);
const BARGE_IN_MIN_MS = readTiming('VOICE_BARGE_IN_MIN_MS', 320, 100, 1_500);
const MIN_CONVERSATION_AUDIO_MS = readTiming('VOICE_MIN_UTTERANCE_MS', 250, 150, 1_000);

function readLevel(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

const BARGE_IN_MIN_RMS_DBFS = readLevel('VOICE_BARGE_IN_MIN_RMS_DBFS', -42, -70, -15);

interface ActiveUserSession {
  userId: string;
  username: string;
  displayName: string;
  eventId: string;
  speechStartedAt: number;
  sttStream: SpeechStream;
  audioChunks: Buffer[];
  overlapDetected: boolean;
  voiceDetector: SustainedVoiceDetector;
  voiceConfirmed: boolean;
  nonSpeechDetected: boolean;
  silenceTimer?: NodeJS.Timeout;
  isReceivingStream: boolean;
}

export class AudioReceiver {
  private connection: VoiceConnection;
  private timeline: ConversationTimeline;
  private sttProvider: SpeechToTextProvider;
  private sessionId: string;
  private client: Client;
  private socialBrain: SocialBrain;
  private responseGenerator: ResponseGenerator;
  private presentationEngine: ResponseGeneratorPresentationEngine;
  private voiceManager: VoiceConnectionManager;
  private voiceOutputManager: VoiceOutputManager;
  private memoryManager: FriendMemoryManager;
  private socialMemory: SocialMemoryBrain;
  private consentManager: VoiceConsentManager;
  private voiceServiceClient: VoiceServiceClient;
  private selectedVoiceForGuild: (guildId: string) => string | undefined;
  private personaForGuild: (guildId: string) => PersonaProfile | null;
  private presentationForGuild: (guildId: string) => PresentationProfile | undefined;
  private discordJarvisAdapter: DiscordJarvisAdapter;
  private selectedCaptureTargetForGuild: (guildId: string) => string | undefined;
  private learningSessionForGuild: (guildId: string) => { id: string; targetUserId: string } | null;
  private onLearningUtterance: (guildId: string, record: VoiceUtteranceRecord) => void | Promise<void>;
  private backgroundProcessingEnabledForGuild: (guildId: string) => boolean;
  private datasetWriter = new VoiceDatasetWriter();
  private currentState: BotState = 'LISTENING';
  private activeSessions: Map<string, ActiveUserSession> = new Map();
  private readonly pendingSampleWrites = new Set<Promise<void>>();
  private speechRevision = 0;
  private turnInProgress = false;

  constructor(
    connection: VoiceConnection, 
    timeline: ConversationTimeline, 
    sttProvider: SpeechToTextProvider,
    sessionId: string,
    client: Client,
    socialBrain: SocialBrain,
    voiceManager: VoiceConnectionManager,
    consentManager: VoiceConsentManager,
    voiceServiceClient: VoiceServiceClient,
    selectedVoiceForGuild: (guildId: string) => string | undefined,
    selectedCaptureTargetForGuild: (guildId: string) => string | undefined,
    personaForGuild: (guildId: string) => PersonaProfile | null,
    socialMemory: SocialMemoryBrain,
    learningSessionForGuild: (guildId: string) => { id: string; targetUserId: string } | null = () => null,
    onLearningUtterance: (guildId: string, record: VoiceUtteranceRecord) => void | Promise<void> = () => undefined,
    backgroundProcessingEnabledForGuild: (guildId: string) => boolean = () => true,
    presentationForGuild: (guildId: string) => PresentationProfile | undefined = () => undefined,
    discordJarvisAdapter: DiscordJarvisAdapter = new DiscordJarvisAdapter(),
  ) {
    this.connection = connection;
    this.timeline = timeline;
    this.sttProvider = sttProvider;
    this.sessionId = sessionId;
    this.client = client;
    this.socialBrain = socialBrain;
    this.voiceManager = voiceManager;
    this.consentManager = consentManager;
    this.voiceServiceClient = voiceServiceClient;
    this.selectedVoiceForGuild = selectedVoiceForGuild;
    this.selectedCaptureTargetForGuild = selectedCaptureTargetForGuild;
    this.personaForGuild = personaForGuild;
    this.presentationForGuild = presentationForGuild;
    this.discordJarvisAdapter = discordJarvisAdapter;
    this.socialMemory = socialMemory;
    this.learningSessionForGuild = learningSessionForGuild;
    this.onLearningUtterance = onLearningUtterance;
    this.backgroundProcessingEnabledForGuild = backgroundProcessingEnabledForGuild;
    this.responseGenerator = new ResponseGenerator();
    this.presentationEngine = new ResponseGeneratorPresentationEngine(this.responseGenerator);
    this.voiceOutputManager = new VoiceOutputManager(voiceManager);
    this.memoryManager = new FriendMemoryManager();
  }

  public getState(): BotState {
    return this.currentState;
  }

  public async flushPendingWrites(): Promise<void> {
    await Promise.allSettled([...this.pendingSampleWrites]);
  }

  public pauseBackgroundProcessing(guildId: string): void {
    this.speechRevision++;
    for (const session of this.activeSessions.values()) {
      if (session.silenceTimer) clearTimeout(session.silenceTimer);
      session.sttStream.discard();
      session.audioChunks = [];
      session.isReceivingStream = false;
    }
    this.activeSessions.clear();
    this.voiceOutputManager.cancelCurrentTurn(guildId);
    this.currentState = 'LISTENING';
  }

  public startListening() {
    const receiver = this.connection.receiver;
    const guildId = this.connection.joinConfig.guildId;

    receiver.speaking.on('start', async (userId) => {
      if (!this.backgroundProcessingEnabledForGuild(guildId)) return;
      // The capture target limits raw training files, not conversation. Every
      // actively consented participant may still address the selected persona.
      if (!this.consentManager.hasActiveConsent(guildId, userId)) return;

      const user = await this.client.users.fetch(userId).catch(() => null);
      if (!this.backgroundProcessingEnabledForGuild(guildId)) return;
      if (!user || user.bot) return;

      const displayName = user.displayName ?? user.username;
      let session = this.activeSessions.get(userId);
      const overlappingSessions = [...this.activeSessions.values()]
        .filter(candidate => candidate.userId !== userId && candidate.isReceivingStream);
      if (overlappingSessions.length > 0) {
        for (const candidate of overlappingSessions) candidate.overlapDetected = true;
        if (session) session.overlapDetected = true;
      }

      if (session) {
        // Speaker is continuing or resuming speech in the same sentence
        if (session.silenceTimer) {
          clearTimeout(session.silenceTimer);
          session.silenceTimer = undefined;
        }
        if (session.isReceivingStream) {
          return;
        }
      } else {
        // Start brand new speaker session
        const eventId = Math.random().toString(36).substring(2, 9);
        const speechStartedAt = Date.now();

        const sttStream = this.sttProvider.createStream({
          userId,
          username: user.username,
          displayName,
          sessionId: this.sessionId,
        });

        session = {
          userId,
          username: user.username,
          displayName,
          eventId,
          speechStartedAt,
          sttStream,
          audioChunks: [],
          overlapDetected: overlappingSessions.length > 0,
          voiceDetector: new SustainedVoiceDetector({
            minimumVoicedMs: BARGE_IN_MIN_MS,
            minimumRmsDbfs: BARGE_IN_MIN_RMS_DBFS,
          }),
          voiceConfirmed: false,
          nonSpeechDetected: false,
          isReceivingStream: false
        };

        this.activeSessions.set(userId, session);

        this.timeline.addEvent({
          type: 'SPEECH_STARTED',
          eventId,
          sessionId: this.sessionId,
          discordUserId: userId,
          username: user.username,
          displayName,
          timestamp: speechStartedAt
        });

        sttStream.on('partial', (text, confidence) => {
          this.timeline.addEvent({
            type: 'TRANSCRIPT_PARTIAL',
            eventId,
            sessionId: this.sessionId,
            discordUserId: userId,
            username: user.username,
            displayName,
            rawText: text,
            confidence,
            timestamp: Date.now(),
            speechStartedAt
          });
        });

        sttStream.on('final', (text, confidence, latencyMs, metadata) => {
          if (!text || text.trim().length === 0) return;

          const finalEvent: TranscriptFinalEvent = {
            type: 'TRANSCRIPT_FINAL',
            eventId,
            sessionId: this.sessionId,
            discordUserId: userId,
            username: user.username,
            displayName,
            rawText: text,
            confidence,
            timestamp: Date.now(),
            speechStartedAt,
            speechEndedAt: Date.now() - latencyMs,
            sttLatencyMs: latencyMs,
            detectedLanguage: metadata?.detectedLanguage,
            sttModel: metadata?.model,
            languageFallbackApplied: metadata?.languageFallbackApplied,
            verified: metadata?.verified,
            verificationMethod: metadata?.verificationMethod,
            speechConfidence: metadata?.speechConfidence,
          };
          this.timeline.addEvent(finalEvent);

          // Evaluate friend memory in background
          if (process.env.MEMORY_ENABLED !== 'false') {
            this.memoryManager.evaluateAndWriteMemory(userId, displayName, text);
            this.socialMemory.recordTranscript(guildId, finalEvent, this.timeline.getRecentFinalTranscripts(30));
          }
        });

        sttStream.on('nonSpeech', metadata => {
          if (metadata.subtype !== 'NOISE') return;
          session!.nonSpeechDetected = true;
          this.timeline.addEvent({
            type: 'NON_SPEECH',
            eventId,
            sessionId: this.sessionId,
            discordUserId: userId,
            username: user.username,
            displayName,
            subtype: metadata.subtype,
            displayText: metadata.displayText || '[เสียงรบกวน]',
            durationMs: metadata.durationMs,
            rmsDbfs: metadata.rmsDbfs,
            reason: metadata.reason,
            rejectedText: metadata.rejectedText,
            debugAudioPath: metadata.debugAudioPath,
            timestamp: Date.now(),
          });
        });

        sttStream.on('error', (error) => {
          console.error(`[AudioReceiver] STT stream error for ${displayName}:`, error);
        });
      }

      session.isReceivingStream = true;
      const currentSession = session;

      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SPEECH_END_SILENCE_MS,
        },
      });

      const opusDecoder = new SafeOpusDecoder({ rate: 48000, channels: 2 });
      const pcmStream = audioStream.pipe(opusDecoder);

      pcmStream.on('data', (chunk: Buffer) => {
        if (!this.backgroundProcessingEnabledForGuild(guildId)) return;
        currentSession.audioChunks.push(chunk);
        currentSession.sttStream.write(chunk);
        if (!currentSession.voiceConfirmed) {
          const activity = currentSession.voiceDetector.observePcm(chunk);
          if (activity.confirmed) {
            currentSession.voiceConfirmed = true;
            this.speechRevision++;
            if (this.voiceOutputManager.cancelCurrentTurn(guildId)) {
              console.log(
                `[AudioReceiver] Confirmed human speech (${activity.voicedMs.toFixed(0)}ms, `
                + `${activity.rmsDbfs.toFixed(1)} dBFS) -> barge-in.`
              );
              this.currentState = 'INTERRUPTED';
              this.timeline.addEvent({
                type: 'BOT_SPEECH_CANCELLED',
                sessionId: this.sessionId,
                timestamp: Date.now()
              });
            }
          }
        }
      });

      pcmStream.on('end', () => {
        currentSession.isReceivingStream = false;

        // Short grace period merges breath gaps without making every reply feel delayed.
        if (currentSession.silenceTimer) clearTimeout(currentSession.silenceTimer);
        currentSession.silenceTimer = setTimeout(() => {
          void this.finalizeUserUtterance(userId, guildId);
        }, UTTERANCE_GRACE_MS);
      });

      opusDecoder.on('error', (err) => {
        console.warn('[SafeOpusDecoder Warning]', err?.message || err);
      });
    });
  }

  private async finalizeUserUtterance(userId: string, guildId: string): Promise<void> {
    const finalizeStartedAt = Date.now();
    const session = this.activeSessions.get(userId);
    if (!session) return;

    if (!this.backgroundProcessingEnabledForGuild(guildId)) {
      if (session.silenceTimer) clearTimeout(session.silenceTimer);
      session.sttStream.discard();
      session.audioChunks = [];
      this.activeSessions.delete(userId);
      this.currentState = 'LISTENING';
      return;
    }

    this.activeSessions.delete(userId);

    const speechEndedAt = Date.now();
    this.timeline.addEvent({
      type: 'SPEECH_ENDED',
      eventId: session.eventId,
      sessionId: this.sessionId,
      discordUserId: userId,
      username: session.username,
      displayName: session.displayName,
      timestamp: speechEndedAt
    });

    try {
      await session.sttStream.endStream();
    } catch (error) {
      console.error(`[AudioReceiver] Failed to finalize STT for ${session.displayName}:`, error);
      this.currentState = 'LISTENING';
      return;
    }
    console.log(`[Latency] End-of-turn + STT: ${Date.now() - finalizeStartedAt}ms for ${session.displayName}.`);

    const rawPcm = Buffer.concat(session.audioChunks);
    const selectedCaptureTarget = this.selectedCaptureTargetForGuild(guildId);
    const finalTranscript = this.timeline
      .getRecentFinalTranscripts(20)
      .find(event => event.eventId === session.eventId);
    const transcript: VoiceTranscriptData | null = finalTranscript ? {
      text: finalTranscript.rawText,
      confidence: finalTranscript.confidence,
      latencyMs: finalTranscript.sttLatencyMs,
      detectedLanguage: finalTranscript.detectedLanguage,
      model: finalTranscript.sttModel,
      languageFallbackApplied: finalTranscript.languageFallbackApplied,
    } : null;

    // Raw voice capture requires both the owner-side switch and this Discord user's explicit consent.
    if (
      process.env.RECORD_RAW_AUDIO === 'true'
      && this.consentManager.hasActiveConsent(guildId, userId)
      && selectedCaptureTarget === userId
      && !session.nonSpeechDetected
      && rawPcm.length >= 115200
    ) {
      const pendingWrite = this.saveVoiceSample(guildId, session, rawPcm, transcript, speechEndedAt);
      this.pendingSampleWrites.add(pendingWrite);
      void pendingWrite.finally(() => this.pendingSampleWrites.delete(pendingWrite));
    }

    if (!finalTranscript) {
      console.log(`[AudioReceiver] No transcript produced for ${session.displayName}; skipping response generation.`);
      this.currentState = 'LISTENING';
      return;
    }

    const rawAudioMs = rawPcm.length / (48_000 * 2 * 2) * 1_000;
    if (rawAudioMs >= MIN_CONVERSATION_AUDIO_MS) {
      await this.processConversationTurn(guildId);
    } else {
      console.log(`[AudioReceiver] 🔇 Filtered click/noise (${(rawAudioMs / 1_000).toFixed(2)}s) from ${session.displayName}`);
    }
  }

  private async processConversationTurn(guildId: string) {
    if (!this.backgroundProcessingEnabledForGuild(guildId)) return;
    if (this.turnInProgress) {
      console.log('[AudioReceiver] A response turn is already active; the newer transcript remains in conversation context.');
      return;
    }
    this.turnInProgress = true;
    const turnStartedAt = Date.now();
    const turnSpeechRevision = this.speechRevision;
    this.currentState = 'PREDICTING';
    const state = new GroupConversationState(this.timeline);

    try {
      const persona = this.personaForGuild(guildId);
      const decision = await this.socialBrain.evaluate(state, persona, {
        oneOnOneVoiceConversation: this.isOneOnOneVoiceConversation(guildId),
      });
      if (!this.backgroundProcessingEnabledForGuild(guildId)) {
        this.currentState = 'LISTENING';
        return;
      }
      const decisionFinishedAt = Date.now();

      if (decision.action === 'IGNORE' || decision.action === 'LISTEN') {
        this.currentState = 'LISTENING';
        return;
      }

      this.currentState = 'GENERATING';
      const memoryContext = this.socialMemory.getContextForTurn(this.timeline.getRecentFinalTranscripts(12));
      const profile = this.presentationForGuild(guildId);
      const latest = state.getRecentTranscriptEvents(1).at(-1);
      const adapterResult = await this.discordJarvisAdapter.reasonAfterSocialDecision({
        requestId: `${this.sessionId}:${turnStartedAt}`,
        sessionId: this.sessionId,
        guildId,
        channelId: this.connection.joinConfig.channelId ?? undefined,
        speakerUserId: latest?.discordUserId,
        participants: state.getContext(6).participants,
        text: latest?.rawText ?? '',
        presentation: profile ?? (persona ? legacyVoiceCommandProfile(persona.userId) : defaultJarvisPresentation()),
        decision,
      });
      const presented = await this.presentationEngine.presentLegacyTurn({
        sessionId: guildId,
        decision,
        state,
        persona,
        memoryContext,
        profile,
        result: adapterResult.coreResult,
      });
      const response = presented?.text ?? null;
      if (!this.backgroundProcessingEnabledForGuild(guildId)) {
        this.currentState = 'LISTENING';
        return;
      }
      const responseFinishedAt = Date.now();

      if (!response) {
        this.currentState = 'LISTENING';
        return;
      }

      // If somebody continued with a real, sustained utterance while the reply
      // was being composed, do not play an obsolete answer over them. The newer
      // finalized turn will produce the relevant response.
      if (this.speechRevision !== turnSpeechRevision) {
        console.log('[AudioReceiver] Dropping stale response because newer confirmed speech arrived.');
        this.currentState = 'LISTENING';
        return;
      }
      if (!this.backgroundProcessingEnabledForGuild(guildId)) {
        this.currentState = 'LISTENING';
        return;
      }

      this.currentState = 'SPEAKING';
      this.timeline.addEvent({
        type: 'BOT_RESPONSE',
        sessionId: this.sessionId,
        discordUserId: 'bot',
        text: response,
        timestamp: Date.now()
      });

      // Play audio and handle turn completion
      const ownerId = process.env.OWNER_DISCORD_USER_ID?.trim();
      const defaultSpeakerId = process.env.DEFAULT_SPEAKER_ID?.trim();
      const selectedVoice = this.selectedVoiceForGuild(guildId);
      const consentedSpeaker = (userId: string | undefined) =>
        userId && this.consentManager.hasActiveConsent(guildId, userId) ? userId : undefined;
      const voiceSpeaker = consentedSpeaker(selectedVoice)
        || (profile
          ? undefined
          : consentedSpeaker(defaultSpeakerId) || consentedSpeaker(ownerId));
      const spoke = await this.voiceOutputManager.speakTurn(guildId, response, voiceSpeaker, {
        tone: decision.tone,
        action: decision.action,
        speechAct: decision.action === 'ANSWER'
          ? 'answer'
          : decision.action === 'ASK'
            ? 'question'
            : decision.action === 'JOKE'
              ? 'joke'
              : 'acknowledgement',
        emotion: decision.tone,
        intensity: decision.tone === 'excited' ? 0.82 : decision.tone === 'annoyed' ? 0.68 : 0.42,
        pace: decision.action === 'SHORT_REACTION' ? 1.06 : 1,
        energy: decision.tone === 'soft' ? 0.28 : decision.tone === 'excited' ? 0.8 : 0.48,
        variation: decision.action === 'SHORT_REACTION' ? 0.68 : 0.42,
        variationSeed: `${this.sessionId}:${Date.now()}:${Math.random()}`,
        context: this.timeline.getRecentFinalTranscripts(1).at(0)?.rawText,
      });
      console.log(
        `[Latency] Decision ${decisionFinishedAt - turnStartedAt}ms, response ${responseFinishedAt - decisionFinishedAt}ms, `
        + `TTS + playback ${Date.now() - responseFinishedAt}ms.`
      );
      if (!spoke) {
        this.currentState = 'LISTENING';
        return;
      }
      this.socialBrain.recordBotSpoke();
      this.currentState = 'COOLDOWN';
      setTimeout(() => {
        if (this.currentState === 'COOLDOWN') this.currentState = 'LISTENING';
      }, RESPONSE_COOLDOWN_MS);

    } catch (err) {
      console.error('[AudioReceiver] Pipeline turn error:', err);
      this.currentState = 'LISTENING';
    } finally {
      this.turnInProgress = false;
    }
  }

  private isOneOnOneVoiceConversation(guildId: string): boolean {
    const guild = this.client.guilds.cache.get(guildId);
    const channelId = this.connection.joinConfig.channelId;
    const channel = channelId ? guild?.channels.cache.get(channelId) : null;
    if (!(channel instanceof VoiceChannel)) return false;
    return channel.members.filter(member => !member.user.bot).size === 1;
  }

  private async saveVoiceSample(
    guildId: string,
    session: ActiveUserSession,
    pcmBuffer: Buffer,
    transcript: VoiceTranscriptData | null,
    speechEndedAt: number,
  ): Promise<void> {
    if (!pcmBuffer || pcmBuffer.length < 96000) return; // ignore <0.5 sec short noise or clicks
    try {
      const saved = this.datasetWriter.save({
        guildId,
        sessionId: this.sessionId,
        learningSessionId: this.learningSessionForGuild(guildId)?.id,
        eventId: session.eventId,
        userId: session.userId,
        username: session.username,
        displayName: session.displayName,
        speechStartedAt: session.speechStartedAt,
        speechEndedAt,
        pcmBuffer,
        transcript,
        suspectedOverlap: session.overlapDetected,
      });
      const fileName = saved.record.audioFile.split('/').at(-1) || `${saved.record.id}.wav`;
      await this.onLearningUtterance(guildId, saved.record);

      if (this.voiceServiceClient.isConfigured() && saved.record.analysis.quality.acceptedForVoiceTraining) {
        try {
          const status = await this.voiceServiceClient.uploadSample({
            guildId,
            userId: session.userId,
            displayName: session.displayName,
            filename: fileName,
            wavBuffer: saved.wavBuffer,
          });
          console.log(`[VoiceService] Uploaded ${fileName}; ${status.durationSeconds.toFixed(1)}s stored, modelReady=${status.modelReady}.`);
        } catch (error) {
          console.error('[VoiceService Upload Error]', error instanceof Error ? error.message : error);
        }
      }

      if (!saved.record.analysis.quality.acceptedForVoiceTraining) {
        console.log(
          `[VoiceRecorder] Excluded ${fileName} from voice training (quality ${saved.record.analysis.quality.score.toFixed(2)}): `
          + `${saved.record.analysis.quality.reasons.join(', ') || 'policy rejection'}.`,
        );
      }

      console.log(
        `[VoiceRecorder] Saved consented WAV/TXT/JSON for "${session.displayName}" `
        + `(${saved.record.durationSeconds.toFixed(1)}s, quality=${saved.record.analysis.quality.score.toFixed(2)}, `
        + `style=${saved.record.analysis.prosody.style}) -> ${fileName}`,
      );
    } catch (err) {
      console.error('[VoiceRecorder Error]', err);
    }
  }

}
