# Jarvis API / Interface Contracts

Status: JARVIS-001/002 implemented in `src/jarvis/`; Discord adapter files not created yet
Purpose: Give Cursor concrete interfaces to implement before broad rewrites.

## 1. Core interfaces

Recommended files (exact paths may be adjusted after repo inspection):

```text
src/jarvis/core/types.ts
src/jarvis/core/JarvisCore.ts
src/jarvis/presentation/types.ts
src/jarvis/presentation/PresentationEngine.ts
src/jarvis/clients/discord/DiscordJarvisAdapter.ts
src/jarvis/clients/discord/InvocationResolver.ts
```

Do not create all files blindly if a better existing location already exists.

## 2. JarvisCore

```ts
export interface JarvisCore {
  handle(request: JarvisRequest): Promise<JarvisCoreResult>;
}
```

Core result should be structured and presentation-neutral.

## 3. PresentationEngine

```ts
export interface PresentationEngine {
  render(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    context: PresentationContext
  ): Promise<PresentedResponse>;
}
```

## 4. PersonaProvider

```ts
export interface PersonaProvider {
  get(profileId: string): Promise<PersonaProfile | null>;
  getBehaviorExamples(
    profileId: string,
    query: string,
    limit?: number
  ): Promise<BehaviorExample[]>;
}
```

## 5. VoiceProvider

Do not replace current `TextToSpeechProvider` unless necessary.

Prefer an adapter:

```ts
export interface VoiceProfileResolver {
  resolve(profileId: string): Promise<VoiceProfileAvailability>;
}
```

Current TTS/RVC stack stays behind existing abstractions.

## 6. Presentation session state

```ts
export interface PresentationSessionState {
  sessionId: string;
  defaultProfile: PresentationProfile;
  activeProfile: PresentationProfile;
  expiresAt?: string;
}
```

Session state should not be stored in model context.

## 7. Invocation resolver

```ts
export interface InvocationResolution {
  contentText: string;
  oneTurnOverride?: Partial<PresentationProfile>;
  sessionUpdate?: Partial<PresentationProfile>;
  confidence: number;
}
```

If confidence is low, do not silently change persistent state.

## 8. Tool/fact boundary

Core tool results should be represented structurally.

Presentation code must not need to call tools.

This keeps persona generation from independently re-fetching or inventing facts.

## 9. Backward compatibility adapter

Existing `ResponseGenerator` can initially be wrapped:

```text
JarvisCoreAdapter
 -> current LocalLlmProvider / existing reasoning path
 -> structured output
```

and existing persona behavior can be wrapped by `PresentationEngine`.

Do not require a full rewrite before tests exist.
