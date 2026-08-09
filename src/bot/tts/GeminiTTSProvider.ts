import { GoogleGenAI } from '@google/genai';
import { TTSProvider } from './TTSProvider';

export class GeminiTTSProvider implements TTSProvider {
    private ai: GoogleGenAI;
    private voiceName: string;

    constructor(voiceName: string = "Aoede") {
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        // Available voices in Gemini 2.0: Aoede, Charon, Fenrir, Kore, Puck
        this.voiceName = voiceName;
    }

    async synthesize(text: string): Promise<Buffer | null> {
        try {
            console.log(`[GeminiTTS] Requesting audio for: "${text}" (Voice: ${this.voiceName})`);
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: text,
                config: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: this.voiceName
                            }
                        }
                    }
                }
            });

            const parts = response.candidates?.[0]?.content?.parts;
            if (!parts || parts.length === 0) {
                console.error("[GeminiTTS] No audio parts returned.");
                return null;
            }

            const inlineData = parts[0].inlineData;
            if (inlineData && inlineData.data) {
                // inlineData.data is a base64 encoded string of the audio (typically MP3/WAV)
                const audioBuffer = Buffer.from(inlineData.data, 'base64');
                console.log(`[GeminiTTS] Successfully generated audio (${audioBuffer.length} bytes)`);
                return audioBuffer;
            }

            return null;
        } catch (error) {
            console.error("[GeminiTTS] Error synthesizing speech:", error);
            return null;
        }
    }
}
