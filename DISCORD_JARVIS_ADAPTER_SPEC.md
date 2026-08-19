# Discord ↔ Jarvis Adapter Specification

Status: Proposed design
Purpose: Keep Discord/Digital Me as a client that participates in Jarvis, without making Jarvis Discord-specific.

## 1. Current system

Digital Me already owns valuable Discord behavior:

- Discord voice receive/playback
- final transcript handling
- SocialBrain
- SocialMemoryBrain
- persona-scoped behavior examples
- local LLM response generation
- TTS/RVC
- consent/training
- barge-in
- dashboard controls

These must be preserved.

## 2. Target responsibility split

### Discord side

Owns:
- voice channel connection
- Opus/PCM handling
- STT transport
- participant/guild context
- barge-in
- Discord commands
- audio playback
- voice consent workflow
- client-local session presentation state

### Jarvis side

Owns:
- reasoning
- live factual tool decisions
- memory retrieval
- response intent
- structured factual answer
- permission policy
- cross-client intelligence

### Presentation Engine

Owns:
- persona rendering
- voice rendering selection

## 3. Request contract

Proposed:

```ts
export interface JarvisRequest {
  requestId: string;
  source: "discord" | "desktop" | "android" | "cctv" | "system";
  input: {
    text: string;
    language?: string;
  };
  clientContext: {
    sessionId: string;
    guildId?: string;
    channelId?: string;
    speakerUserId?: string;
    participants?: string[];
  };
  presentation: PresentationProfile;
  capabilities: string[];
}
```

Do not include raw private audio unless a specific subsystem needs it.

## 4. Response contract

```ts
export interface JarvisResponse {
  requestId: string;
  reasoning: ReasoningResult;
  presentation: {
    text: string;
    personaProfileId: string;
    voiceProfileId: string;
  };
  actions?: ActionResult[];
}
```

## 5. Invocation resolver

Discord input may contain an invocation/presentation hint.

Examples:

- "bot gam ..."
- "Jarvis ใช้เสียง Gam"
- "ตอบแบบ Gam"
- "ใช้เสียง Elemisu แต่ตอบปกติ"

Do not implement this as a pile of brittle string replacements if avoidable.

Create an `InvocationResolver` that produces:

```ts
{
  contentText: "วันนี้อากาศเป็นไง",
  oneTurnOverride?: PresentationOverride,
  sessionUpdate?: PresentationOverride,
  explicitTarget?: string
}
```

## 6. Legacy compatibility

Current `/voice user:@name` behavior can continue mapping both persona and voice.

Add future explicit surfaces:

- `/voice-profile`
- `/persona`
- `/presentation`
- natural-language resolver

Exact command names can be decided later.

## 7. SocialBrain relationship

SocialBrain remains useful for:

- should the bot respond?
- react vs answer vs stay quiet?
- group social timing
- direct-address detection
- one-on-one behavior

Jarvis Core should not replace SocialBrain's turn-taking policy automatically.

Target:

```text
Discord final transcript
 -> SocialBrain decides whether to respond
 -> if response needed:
      Jarvis Core reasons
      Presentation Engine renders
      VoiceOutputManager speaks
```

## 8. Research/tool behavior

If a Discord question needs fresh factual data:

```text
"วันนี้อากาศเป็นไง"
 -> Jarvis recognizes fresh-data need
 -> tool
 -> factual result
 -> persona render
 -> voice
```

This does **not** mean world-intel research should automatically run for every conversation.

Use capability-specific routing.

## 9. Memory

Discord events may become shared Jarvis episodes/facts according to consent/privacy policy.

Persona behavior examples remain persona-scoped.

Suggested context merge:

```text
Jarvis global memory
+ relevant Discord/session memory
+ selected persona memory (only if enabled)
```

## 10. Failure modes

If Jarvis Core is unavailable:

- Digital Me may use existing safe deterministic fallback
- UI/status must say Jarvis degraded/offline
- do not pretend cloud/live tools ran

If selected voice is unavailable:

- fallback according to policy
- do not silently claim the selected clone is active

If selected persona is unavailable:

- fall back to neutral/Jarvis persona
- keep factual result intact
