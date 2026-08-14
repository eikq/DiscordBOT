export interface TTSProsody {
    /** Stable ID for cancelling a stale voice-chat turn across HTTP services. */
    turnId?: string;
    modelSelection?: 'best' | 'latest';
    tone?: string;
    action?: string;
    speechAct?: string;
    emotion?: string;
    intensity?: number;
    pace?: number;
    energy?: number;
    variation?: number;
    variationSeed?: string | number;
    context?: string;
}

export interface TTSProvider {
    /**
     * Synthesizes text into speech.
     * @param text The text to synthesize.
     * @param speakerName Optional speaker/profile label understood by the provider.
     * @returns A Buffer containing the audio data (e.g., MP3 or PCM), or null if failed.
     */
    synthesize(text: string, speakerName?: string, prosody?: TTSProsody): Promise<Buffer | null>;
    /** Best-effort cancellation. Providers that cannot cancel may omit it. */
    cancel?(turnId: string): Promise<void> | void;
}
