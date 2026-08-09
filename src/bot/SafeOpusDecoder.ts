import { Transform, TransformCallback } from 'stream';
import OpusScript from 'opusscript';

const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

export class SafeOpusDecoder extends Transform {
  private decoder: any = null;
  private rate: number;
  private channels: number;

  constructor(options?: { rate?: number; channels?: number }) {
    super();
    this.rate = options?.rate || 48000;
    this.channels = options?.channels || 2;
    this.initDecoder();
  }

  private initDecoder() {
    if (this.decoder) {
      try {
        this.decoder.delete();
      } catch (e) {}
      this.decoder = null;
    }
    try {
      // Use JS asm.js mode ({ wasm: false }) to prevent WebAssembly C assertion aborts
      this.decoder = new OpusScript(this.rate as any, this.channels, OpusScript.Application.AUDIO, { wasm: false });
    } catch (err) {
      try {
        this.decoder = new OpusScript(this.rate as any, this.channels, OpusScript.Application.AUDIO);
      } catch (err2) {
        console.error('[SafeOpusDecoder] Failed to initialize OpusScript:', err2);
      }
    }
  }

  private decodeChunk(chunk: Buffer): Buffer | null {
    if (!chunk || chunk.length === 0) return null;

    if (!this.decoder) {
      this.initDecoder();
    }

    if (!this.decoder) return null;

    // Clean RTP Extension Header if present at start (0xBEDE or 0x1000..0x100F)
    let payload = chunk;
    if (chunk.length >= 4 && ((chunk[0] === 0xbe && chunk[1] === 0xde) || (chunk[0] === 0x10 && (chunk[1] & 0xf0) === 0x00))) {
      const extLen = chunk.readUInt16BE(2);
      const fullHeaderSize = 4 + 4 * extLen;
      if (chunk.length > fullHeaderSize) {
        payload = chunk.subarray(fullHeaderSize);
      }
    }

    // Attempt decode on cleaned payload
    try {
      const pcm = this.decoder.decode(payload);
      if (pcm && pcm.length > 0) return pcm;
    } catch (e) {
      // Fallback: try raw chunk if payload slicing failed
      if (payload !== chunk) {
        try {
          const pcm = this.decoder.decode(chunk);
          if (pcm && pcm.length > 0) return pcm;
        } catch (e2) {}
      }
    }

    // Packet loss concealment: decode silence frame to maintain continuous 48kHz PCM stream
    try {
      return this.decoder.decode(SILENCE_FRAME);
    } catch (e3) {
      return null;
    }
  }

  _transform(chunk: Buffer, encoding: string, callback: TransformCallback) {
    if (!chunk || chunk.length === 0) {
      callback();
      return;
    }

    const pcm = this.decodeChunk(chunk);
    if (pcm && pcm.length > 0) {
      this.push(pcm);
    }

    callback();
  }

  _flush(callback: TransformCallback) {
    if (this.decoder) {
      try {
        this.decoder.delete();
      } catch (e) {}
      this.decoder = null;
    }
    callback();
  }
}



