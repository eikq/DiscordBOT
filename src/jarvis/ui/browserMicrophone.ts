import { floatMonoToStereoS16 } from '../audio/pcm';
import { microphoneStartError } from '../audio/ScriptedAudioInput';
import {
  STT_PCM_SAMPLE_RATE,
  type AudioInput,
  type AudioInputState,
  type PcmFrame,
} from '../audio/types';

/**
 * Browser microphone capture. Not used by Jarvis Core.
 * Converts float samples to 48 kHz stereo s16le for Qwen3-ASR.
 */
export class BrowserMicrophoneInput implements AudioInput {
  public readonly id = 'local-microphone';
  private state: AudioInputState = 'idle';
  private handlers = new Set<(frame: PcmFrame) => void>();
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silent: GainNode | null = null;

  public getState(): AudioInputState {
    return this.state;
  }

  public async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state = 'unavailable';
      throw microphoneStartError('unavailable', 'This browser cannot access a microphone.');
    }
    // Construct AudioContext in the click call stack, before getUserMedia awaits,
    // so resume() is not stuck behind a lost user gesture.
    const context = new AudioContext({ sampleRate: STT_PCM_SAMPLE_RATE });
    this.context = context;
    const resume = context.state === 'suspended' ? context.resume() : Promise.resolve();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      await resume;
      if (context.state === 'suspended') {
        await Promise.race([
          context.resume(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('AudioContext resume timed out.')), 2_500);
          }),
        ]);
      }
    } catch (error) {
      await this.stop();
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        this.state = 'permission-denied';
        throw microphoneStartError('permission-denied', 'Microphone permission was denied.');
      }
      this.state = 'unavailable';
      throw microphoneStartError('unavailable', error instanceof Error ? error.message : 'Microphone is unavailable.');
    }

    this.source = context.createMediaStreamSource(this.stream);
    this.processor = context.createScriptProcessor(4096, 1, 1);
    this.silent = context.createGain();
    this.silent.gain.value = 0;
    this.processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      const sourceRate = event.inputBuffer.sampleRate || context.sampleRate || STT_PCM_SAMPLE_RATE;
      const resampled = sourceRate === STT_PCM_SAMPLE_RATE ? input : resampleFloat(input, sourceRate, STT_PCM_SAMPLE_RATE);
      const pcm = floatMonoToStereoS16(resampled);
      const frame: PcmFrame = {
        pcm,
        sampleRate: STT_PCM_SAMPLE_RATE,
        channels: 2,
        timestampMs: performance.now(),
      };
      for (const handler of this.handlers) handler(frame);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silent);
    this.silent.connect(context.destination);
    this.state = 'capturing';
  }

  public async stop(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silent?.disconnect();
    this.processor = null;
    this.source = null;
    this.silent = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.state = 'idle';
  }

  public onFrame(handler: (frame: PcmFrame) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

function resampleFloat(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const destFrames = Math.max(1, Math.round(input.length * toRate / fromRate));
  const out = new Float32Array(destFrames);
  for (let frame = 0; frame < destFrames; frame++) {
    const position = frame * fromRate / toRate;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    out[frame] = (input[left] ?? 0) * (1 - mix) + (input[right] ?? 0) * mix;
  }
  return out;
}
