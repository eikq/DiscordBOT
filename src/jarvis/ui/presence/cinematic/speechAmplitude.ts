/** RMS from a live AnalyserNode. Returns 0 when no audio is playing. */

export function analyserAmplitude(analyser: AnalyserNode | null | undefined): number {
  if (!analyser) return 0;
  const bytes = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(bytes);
  let sum = 0;
  for (const sample of bytes) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / bytes.length) * 2.4);
}

export function attachPlaybackAnalyser(
  audio: HTMLAudioElement,
  onAmplitude: (value: number) => void,
): () => void {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return () => onAmplitude(0);
  const context = new AudioContextCtor();
  const source = context.createMediaElementSource(audio);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(context.destination);
  let frame = 0;
  const tick = () => {
    onAmplitude(analyserAmplitude(analyser));
    frame = window.requestAnimationFrame(tick);
  };
  void context.resume().catch(() => undefined);
  frame = window.requestAnimationFrame(tick);
  return () => {
    window.cancelAnimationFrame(frame);
    onAmplitude(0);
    void context.close().catch(() => undefined);
  };
}
