import type { JarvisCore, JarvisCoreResult, JarvisRequest } from './types';

/** Honest stub: Core is attached but does not perform live reasoning. */
export class UnavailableJarvisCore implements JarvisCore {
  public async handle(request: JarvisRequest): Promise<JarvisCoreResult> {
    return {
      requestId: request.requestId,
      answerIntent: 'unavailable',
      verifiedFacts: [],
      unverifiedClaims: [],
      toolResults: [],
      memoryRefs: [],
      actionResults: [],
      uncertainty: ['Jarvis Core is unavailable; the caller should use its existing fallback.'],
      suggestedContent: '',
    };
  }
}

/** Test/helper core that returns a prebuilt result and ignores presentation. */
export class PassThroughJarvisCore implements JarvisCore {
  constructor(private readonly buildResult: (request: JarvisRequest) => JarvisCoreResult) {}

  public async handle(request: JarvisRequest): Promise<JarvisCoreResult> {
    const result = this.buildResult(request);
    return {
      ...result,
      requestId: request.requestId,
    };
  }
}
