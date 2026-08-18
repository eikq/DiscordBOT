# Presentation Engine Specification

Status: Proposed design
Purpose: Separate factual reasoning from persona and voice rendering.

## 1. Pipeline

```text
User/Input
   |
Client Adapter
   |
JarvisRequest
   |
Jarvis Core
   |
ReasoningResult
   |
ResponseIntent
   |
Presentation Engine
   |             |
Persona          Voice
Renderer         Renderer/TTS
   |             |
Text             Audio
   +-------> Client Output
```

## 2. PresentationProfile

Proposed TypeScript shape:

```ts
export interface PresentationProfile {
  brainProfileId: string;          // normally "jarvis"
  personaProfileId: string;        // "jarvis" | "neutral" | user/persona id
  voiceProfileId: string;          // RVC/TTS voice id
  personaMode: "NONE" | "STYLE" | "SOCIAL";
  language?: "th" | "en" | "auto";
  verbosity?: "short" | "normal" | "detailed";
  humor?: "off" | "light" | "natural";
}
```

Do not hard-code only Gam/Elemisu; profiles must be data-driven.

## 3. ReasoningResult

Jarvis should produce structured facts before persona rendering.

Suggested:

```ts
export interface ReasoningResult {
  requestId: string;
  answerIntent: string;
  verifiedFacts: VerifiedFact[];
  unverifiedClaims: Claim[];
  toolResults: ToolResultRef[];
  memoryRefs: MemoryRef[];
  actionResults: ActionResult[];
  uncertainty?: string[];
  suggestedContent: string;
}
```

## 4. VerifiedFact

```ts
export interface VerifiedFact {
  key: string;
  value: unknown;
  sourceType: "tool" | "memory" | "system" | "user";
  sourceRef?: string;
  confidence?: number;
  immutableForPresentation: boolean;
}
```

`immutableForPresentation=true` means persona rendering cannot contradict it.

## 5. PersonaRenderer

Inputs:

- `ReasoningResult`
- selected `PersonaProfile`
- relevant persona-scoped behavior examples
- relevant social memory when mode = SOCIAL
- current client/session context

Output:

```ts
export interface PersonaRenderedText {
  text: string;
  personaProfileId: string;
  transformations: string[];
}
```

The renderer should preserve all immutable facts.

## 6. VoiceRenderer

Voice selection must be independent.

Inputs:
- rendered text
- selected `VoiceProfile`
- optional prosody/delivery settings
- cancellation/turnId

Output:
- local audio artifact/stream reference

Existing consent and selected-voice rules remain hard requirements.

## 7. Persona data

Persona may contain:

- identity label
- aliases
- example responses
- common slang
- typical response length
- humor style
- formality
- social relationship style
- language-mixing behavior

Do not put factual world knowledge into the persona profile.

## 8. Voice data

Voice profile may contain:

- user/persona id
- RVC model reference
- selected checkpoint (best/latest)
- source TTS preset
- pronunciation overrides
- delivery preset
- consent/availability status

Voice profile must not automatically inject persona behavior.

## 9. Example scenarios

### A. "bot gam วันนี้อากาศเป็นไง"

```text
brain   = jarvis
persona = gam
voice   = gam
mode    = SOCIAL or STYLE
```

### B. "Jarvis ใช้เสียง Gam"

```text
brain   = jarvis
persona = jarvis
voice   = gam
mode    = NONE
```

### C. "ใช้เสียง Gam แต่ไม่เอาบุคลิก Gam"

Same as B.

### D. "ใช้เสียง Gam แล้วพูดแบบ Gam ด้วย"

```text
persona = gam
voice   = gam
mode    = STYLE/SOCIAL
```

### E. "กลับเป็นเสียง Jarvis แต่ตอบแบบ Gam ต่อ"

```text
persona = gam
voice   = jarvis
```

## 10. Session state

Presentation selection should be session-scoped by default.

Possible scopes:

- current Discord guild/voice session
- desktop session
- Android session
- explicit global default

Do not change every client globally because one Discord session changed voice.

## 11. Persistence

Suggested distinction:

- user-defined default profile: persistent
- temporary voice/persona command: session state
- one-shot override: one turn only

## 12. Safety

Never allow persona style to:

- bypass consent
- claim to be the real cloned person
- fabricate tool results
- change permission decisions
- silently perform actions
