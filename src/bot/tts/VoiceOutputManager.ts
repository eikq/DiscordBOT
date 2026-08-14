import { VoiceConnectionManager } from '../VoiceConnectionManager';
import { LocalTTSProvider } from './LocalTTSProvider';
import { TTSProsody, TTSProvider } from './TTSProvider';

export class VoiceOutputManager {
  private voiceManager: VoiceConnectionManager;
  private ttsProvider: TTSProvider;
  private currentTurnId: string | null = null;
  private currentGuildId: string | null = null;
  private currentPhase: 'idle' | 'synthesizing' | 'playing' = 'idle';
  private activeCancellationTokens: Map<string, boolean> = new Map();

  constructor(voiceManager: VoiceConnectionManager, ttsProvider?: TTSProvider) {
    this.voiceManager = voiceManager;
    this.ttsProvider = ttsProvider || new LocalTTSProvider();
  }

  public async speakTurn(guildId: string, text: string, speakerName?: string, prosody?: TTSProsody): Promise<boolean> {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.currentTurnId = turnId;
    this.currentGuildId = guildId;
    this.currentPhase = 'synthesizing';
    this.activeCancellationTokens.set(turnId, false);

    console.log(`[VoiceOutputManager] Generating turn speech [${turnId}] (speaker: ${speakerName || 'default'}): "${text}"`);
    const synthesisStartedAt = Date.now();
    const audioBuffer = await this.ttsProvider.synthesize(text, speakerName, { ...prosody, turnId });
    console.log(`[Latency] TTS synthesis: ${Date.now() - synthesisStartedAt}ms for turn [${turnId}].`);

    if (this.isCancelled(turnId)) {
      console.log(`[VoiceOutputManager] Turn [${turnId}] was cancelled before playback.`);
      this.activeCancellationTokens.delete(turnId);
      this.clearCurrentTurn(turnId);
      return false;
    }

    if (!audioBuffer) {
      this.activeCancellationTokens.delete(turnId);
      this.clearCurrentTurn(turnId);
      return false;
    }

    console.log(`[VoiceOutputManager] Playing audio for turn [${turnId}]`);
    if (this.currentTurnId === turnId) this.currentPhase = 'playing';
    const played = await this.voiceManager.playAudio(guildId, audioBuffer);
    const cancelled = this.isCancelled(turnId);
    this.activeCancellationTokens.delete(turnId);
    this.clearCurrentTurn(turnId);
    return played && !cancelled;
  }

  public cancelCurrentTurn(guildId: string): boolean {
    if (this.currentTurnId && this.currentGuildId === guildId) {
      const turnId = this.currentTurnId;
      console.log(`[VoiceOutputManager] Confirmed barge-in during ${this.currentPhase}; cancelling turn [${turnId}]`);
      this.activeCancellationTokens.set(turnId, true);
      try {
        const cancellation = this.ttsProvider.cancel?.(turnId);
        if (cancellation) void Promise.resolve(cancellation).catch(error => {
          console.warn(`[VoiceOutputManager] Provider cancellation failed for [${turnId}]: ${error}`);
        });
      } catch (error) {
        console.warn(`[VoiceOutputManager] Provider cancellation failed for [${turnId}]: ${error}`);
      }
      if (this.currentPhase === 'playing') this.voiceManager.stopAudio(guildId);
      this.currentPhase = 'idle';
      this.currentGuildId = null;
      this.currentTurnId = null;
      return true;
    }
    return false;
  }

  public isCancelled(turnId: string): boolean {
    return this.activeCancellationTokens.get(turnId) === true;
  }

  public isTurnActive(guildId?: string): boolean {
    return this.currentTurnId !== null && (!guildId || this.currentGuildId === guildId);
  }

  public getCurrentPhase(): 'idle' | 'synthesizing' | 'playing' {
    return this.currentPhase;
  }

  private clearCurrentTurn(turnId: string): void {
    if (this.currentTurnId !== turnId) return;
    this.currentTurnId = null;
    this.currentGuildId = null;
    this.currentPhase = 'idle';
  }
}
