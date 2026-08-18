import type { JarvisCore, JarvisCoreResult, JarvisRequest } from './types';

/** Honest stub: Core is not wired into the live Discord path yet. */
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
      uncertainty: ['Jarvis Core is not wired into the live Discord path yet.'],
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
