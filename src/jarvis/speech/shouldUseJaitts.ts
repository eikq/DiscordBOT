/**
 * Port of colab/voice_output_audio.py should_use_jaitts.
 * Short reactions stay on Edge-TTS; JaiTTS is for longer source speech.
 * Does not change the JaiTTS checkpoint license characterization.
 */
export function shouldUseJaitts(text: string, minimumCharacters = 9): boolean {
  const spoken = String(text || '').replace(/[\s.,!?…:;'"()`[\]{}\-_\\/]+/gu, '');
  return spoken.length >= minimumCharacters;
}
