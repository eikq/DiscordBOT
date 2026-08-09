export interface TTSProvider {
    /**
     * Synthesizes text into speech.
     * @param text The text to synthesize.
     * @param speakerName Optional target cloned speaker name to synthesize.
     * @returns A Buffer containing the audio data (e.g., MP3 or PCM), or null if failed.
     */
    synthesize(text: string, speakerName?: string): Promise<Buffer | null>;
}
