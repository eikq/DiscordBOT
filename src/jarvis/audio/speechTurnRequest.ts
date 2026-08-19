import { createJarvisRequest } from '../core/request';
import type { JarvisRequest } from '../core/types';
import { STANDALONE_MIC_SOURCE } from './types';

export function createSpeechJarvisRequest(input: {
  transcript: string;
  turnId: string;
  sessionId?: string;
}): JarvisRequest {
  return createJarvisRequest({
    text: input.transcript,
    requestId: input.turnId,
    source: STANDALONE_MIC_SOURCE,
    sessionId: input.sessionId || 'jarvis-lab',
  });
}
