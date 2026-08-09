import { VoiceConnection, EndBehaviorType } from '@discordjs/voice';
import fs from 'fs';
import path from 'path';
import { SafeOpusDecoder } from './SafeOpusDecoder';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import { SpeechToTextProvider, SpeechStream } from './stt/SpeechToTextProvider';
import { SocialBrain } from './brain/SocialBrain';
import { GroupConversationState } from './brain/GroupConversationState';
import { ResponseGenerator } from './personality/ResponseGenerator';
import { Client } from 'discord.js';
import { VoiceConnectionManager } from './VoiceConnectionManager';
import { VoiceOutputManager } from './tts/VoiceOutputManager';
import { FriendMemoryManager } from './memory/FriendMemoryManager';

export type BotState = 'LISTENING' | 'PREDICTING' | 'GENERATING' | 'SPEAKING' | 'INTERRUPTED' | 'COOLDOWN';

interface ActiveUserSession {
  userId: string;
  username: string;
  displayName: string;
  eventId: string;
  speechStartedAt: number;
  sttStream: SpeechStream;
  audioChunks: Buffer[];
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
  private voiceManager: VoiceConnectionManager;
  private voiceOutputManager: VoiceOutputManager;
  private memoryManager: FriendMemoryManager;
  private currentState: BotState = 'LISTENING';
  private activeSessions: Map<string, ActiveUserSession> = new Map();

  constructor(
    connection: VoiceConnection, 
    timeline: ConversationTimeline, 
    sttProvider: SpeechToTextProvider,
    sessionId: string,
    client: Client,
    socialBrain: SocialBrain,
    voiceManager: VoiceConnectionManager
  ) {
    this.connection = connection;
    this.timeline = timeline;
    this.sttProvider = sttProvider;
    this.sessionId = sessionId;
    this.client = client;
    this.socialBrain = socialBrain;
    this.voiceManager = voiceManager;
    this.responseGenerator = new ResponseGenerator();
    this.voiceOutputManager = new VoiceOutputManager(voiceManager);
    this.memoryManager = new FriendMemoryManager();
  }

  public getState(): BotState {
    return this.currentState;
  }

  public startListening() {
    const receiver = this.connection.receiver;
    const guildId = this.connection.joinConfig.guildId;

    receiver.speaking.on('start', async (userId) => {
      // BARGE-IN INTERRUPTION HANDLER
      if (this.currentState === 'SPEAKING' || this.currentState === 'GENERATING') {
        console.log(`[AudioReceiver] Human speaking while bot active -> BARGE-IN TRIGGERED`);
        this.currentState = 'INTERRUPTED';
        this.voiceOutputManager.cancelCurrentTurn(guildId);
        this.timeline.addEvent({
          type: 'BOT_SPEECH_CANCELLED',
          sessionId: this.sessionId,
          timestamp: Date.now()
        });
      }

      this.currentState = 'LISTENING';
      const user = await this.client.users.fetch(userId).catch(() => null);
      if (!user || user.bot) return;

      const displayName = user.displayName ?? user.username;
      let session = this.activeSessions.get(userId);

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

        sttStream.on('final', (text, confidence, latencyMs) => {
          if (!text || text.trim().length === 0) return;

          this.timeline.addEvent({
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
            sttLatencyMs: latencyMs
          });

          // Evaluate friend memory in background
          this.memoryManager.evaluateAndWriteMemory(userId, displayName, text);

          // Automatically train behavior & speech patterns live from voice chat
          this.autoTrainBehaviorPattern(displayName, text);
        });
      }

      session.isReceivingStream = true;
      const currentSession = session;

      const audioStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1200,
        },
      });

      const opusDecoder = new SafeOpusDecoder({ rate: 48000, channels: 2 });
      const pcmStream = audioStream.pipe(opusDecoder);

      pcmStream.on('data', (chunk: Buffer) => {
        currentSession.audioChunks.push(chunk);
        currentSession.sttStream.write(chunk);
      });

      pcmStream.on('end', () => {
        currentSession.isReceivingStream = false;

        // Grace period of 1500ms before finalizing user sentence (merges breath/pause gaps)
        if (currentSession.silenceTimer) clearTimeout(currentSession.silenceTimer);
        currentSession.silenceTimer = setTimeout(() => {
          this.finalizeUserUtterance(userId, guildId);
        }, 1500);
      });

      opusDecoder.on('error', (err) => {
        console.warn('[SafeOpusDecoder Warning]', err?.message || err);
      });
    });
  }

  private finalizeUserUtterance(userId: string, guildId: string) {
    const session = this.activeSessions.get(userId);
    if (!session) return;

    this.activeSessions.delete(userId);

    this.timeline.addEvent({
      type: 'SPEECH_ENDED',
      eventId: session.eventId,
      sessionId: this.sessionId,
      discordUserId: userId,
      username: session.username,
      displayName: session.displayName,
      timestamp: Date.now()
    });

    session.sttStream.endStream();

    const rawPcm = Buffer.concat(session.audioChunks);
    // Only record voice sample & trigger pipeline if audio >= 0.6 seconds (115,200 bytes)
    if (rawPcm.length >= 115200) {
      this.saveVoiceSample(session.displayName, userId, rawPcm);
      this.processConversationTurn(guildId);
    } else {
      console.log(`[AudioReceiver] 🔇 Filtered short syllable/click noise (${(rawPcm.length / (48000 * 4)).toFixed(2)}s) from ${session.displayName}`);
    }
  }

  private async processConversationTurn(guildId: string) {
    this.currentState = 'PREDICTING';
    const state = new GroupConversationState(this.timeline);

    try {
      const decision = await this.socialBrain.evaluate(state);

      if (decision.action === 'IGNORE') {
        this.currentState = 'LISTENING';
        return;
      }

      this.currentState = 'GENERATING';
      const response = await this.responseGenerator.generate(decision, state);

      if (!response) {
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
      await this.voiceOutputManager.speakTurn(guildId, response);
      this.socialBrain.recordBotSpoke();
      this.currentState = 'COOLDOWN';
      setTimeout(() => {
        if (this.currentState === 'COOLDOWN') this.currentState = 'LISTENING';
      }, 1500);

    } catch (err) {
      console.error('[AudioReceiver] Pipeline turn error:', err);
      this.currentState = 'LISTENING';
    }
  }

  private autoTrainBehaviorPattern(speakerName: string, text: string) {
    if (!text || text.trim().length < 3) return;
    try {
      const dataPath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');
      const dirPath = path.dirname(dataPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const record = {
        conversationId: `auto_vc_${Date.now()}`,
        context: [{ speaker: speakerName, text: text.trim() }],
        ownerAction: "ANSWER",
        ownerResponse: "เออ",
        responseDelayMs: 600,
        relationship: "close_friend",
        directlyAddressed: text.includes("มึง") || text.includes(speakerName),
        topic: "live_discord_vc"
      };

      let existing = [];
      if (fs.existsSync(dataPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        } catch { existing = []; }
      }
      existing.unshift(record);
      // Keep last 200 records
      if (existing.length > 200) existing = existing.slice(0, 200);
      fs.writeFileSync(dataPath, JSON.stringify(existing, null, 2));

      console.log(`[AutoTrain] 🎙️ Auto-trained pattern from live Discord VC: "${speakerName}: ${text}"`);
    } catch (err) {
      console.error('[AutoTrain Error]', err);
    }
  }

  private saveVoiceSample(speakerName: string, userId: string, pcmBuffer: Buffer) {
    if (!pcmBuffer || pcmBuffer.length < 96000) return; // ignore <0.5 sec short noise or clicks
    try {
      const cleanName = speakerName.replace(/[^a-zA-Z0-9_\u0E00-\u0E7F]/g, '_');
      const dirPath = path.join(process.cwd(), 'data', 'voice_samples', cleanName);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const timestamp = Date.now();
      const fileName = `sample_${timestamp}.wav`;
      const filePath = path.join(dirPath, fileName);

      // Create 44-byte WAV header (48000Hz, 2 channels, 16bit PCM)
      const wavHeader = Buffer.alloc(44);
      const dataSize = pcmBuffer.length;
      wavHeader.write('RIFF', 0);
      wavHeader.writeUInt32LE(36 + dataSize, 4);
      wavHeader.write('WAVE', 8);
      wavHeader.write('fmt ', 12);
      wavHeader.writeUInt32LE(16, 16);
      wavHeader.writeUInt16LE(1, 20);
      wavHeader.writeUInt16LE(2, 22);
      wavHeader.writeUInt32LE(48000, 24);
      wavHeader.writeUInt32LE(48000 * 4, 28);
      wavHeader.writeUInt16LE(4, 32);
      wavHeader.writeUInt16LE(16, 34);
      wavHeader.write('data', 36);
      wavHeader.writeUInt32LE(dataSize, 40);

      const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
      fs.writeFileSync(filePath, wavBuffer);

      // Sync to Colab / Google Drive in background
      this.syncSampleToColab(speakerName, fileName, wavBuffer);

      // Update catalog
      const catalogPath = path.join(process.cwd(), 'data', 'voice_samples', 'catalog.json');
      let catalog = [];
      if (fs.existsSync(catalogPath)) {
        try { catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')); } catch { catalog = []; }
      }
      catalog.unshift({
        speaker: speakerName,
        userId,
        file: `/data/voice_samples/${cleanName}/${fileName}`,
        sizeBytes: wavBuffer.length,
        durationSec: (pcmBuffer.length / (48000 * 4)).toFixed(1),
        timestamp
      });
      if (catalog.length > 300) catalog = catalog.slice(0, 300);
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

      console.log(`[VoiceRecorder] 🎧 Auto-recorded voice sample for friend "${speakerName}" (${(pcmBuffer.length / (48000 * 4)).toFixed(1)}s) -> saved to ${fileName}`);
    } catch (err) {
      console.error('[VoiceRecorder Error]', err);
    }
  }

  private async syncSampleToColab(speakerName: string, fileName: string, wavBuffer: Buffer) {
    const colabUrl = process.env.COLAB_TTS_URL;
    if (!colabUrl) return;

    try {
      const cleanSpeaker = speakerName.replace(/[^a-zA-Z0-9_\u0E00-\u0E7F]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'friend';
      const response = await fetch(`${colabUrl.replace(/\/$/, '')}/upload-sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speaker: cleanSpeaker,
          filename: fileName,
          audio_base64: wavBuffer.toString('base64')
        })
      });
      if (response.ok) {
        console.log(`[ColabSync] ☁️ Successfully uploaded voice sample of "${cleanSpeaker}" to Google Drive via Colab!`);
      }
    } catch (err: any) {
      console.error('[ColabSync Error]', err?.message || err);
    }
  }
}
