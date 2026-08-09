import { VoiceConnectionManager } from '../VoiceConnectionManager';
import { LocalTTSProvider } from './LocalTTSProvider';

export class VoiceOutputManager {
  private voiceManager: VoiceConnectionManager;
  private ttsProvider: LocalTTSProvider;
  private currentTurnId: string | null = null;
  private activeCancellationTokens: Map<string, boolean> = new Map();

  constructor(voiceManager: VoiceConnectionManager, ttsProvider?: LocalTTSProvider) {
    this.voiceManager = voiceManager;
    this.ttsProvider = ttsProvider || new LocalTTSProvider();
  }

  public async speakTurn(guildId: string, text: string, speakerName?: string): Promise<string> {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.currentTurnId = turnId;
    this.activeCancellationTokens.set(turnId, false);

    console.log(`[VoiceOutputManager] Generating turn speech [${turnId}] (speaker: ${speakerName || 'default'}): "${text}"`);
    const audioBuffer = await this.ttsProvider.synthesize(text, speakerName);

    if (this.isCancelled(turnId)) {
      console.log(`[VoiceOutputManager] Turn [${turnId}] was cancelled before playback.`);
      return turnId;
    }

    if (audioBuffer) {
      this.voiceManager.playAudio(guildId, audioBuffer);
      console.log(`[VoiceOutputManager] Playing audio for turn [${turnId}]`);
    }

    return turnId;
  }

  public cancelCurrentTurn(guildId: string): void {
    if (this.currentTurnId) {
      console.log(`[VoiceOutputManager] BARGE-IN DETECTED! Cancelling turn [${this.currentTurnId}]`);
      this.activeCancellationTokens.set(this.currentTurnId, true);
      this.voiceManager.stopAudio(guildId);
      this.currentTurnId = null;
    }
  }

  public isCancelled(turnId: string): boolean {
    return this.activeCancellationTokens.get(turnId) === true;
  }
}
