/** RMS of interleaved s16 PCM. Returns 0 when capture is silent or absent. */
export function pcmAmplitude(pcm: Uint8Array | null | undefined): number {
  if (!pcm || pcm.length < 4) return 0;
  const samples = Math.min(Math.floor(pcm.length / 2), 2048);
  let sum = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = pcm[index * 2]! | (pcm[index * 2 + 1]! << 8);
    const signed = value > 32767 ? value - 65536 : value;
    sum += signed * signed;
  }
  return Math.min(1, Math.sqrt(sum / samples) / 9000);
}
