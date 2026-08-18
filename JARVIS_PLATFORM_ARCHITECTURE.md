# Jarvis Platform Architecture

Status: Proposed direction
Purpose: Define Jarvis as the central platform while keeping Digital Me / Discord as a client and social-voice subsystem.

## 1. Core principle

Jarvis must not "live inside Discord".

Jarvis is a platform-level intelligence layer that can serve multiple clients:

- Discord / Digital Me
- desktop command center
- Android edge client
- CCTV/event pipeline
- future IoT/home clients
- coding/developer agents

Discord is one client and one source of social/perceptual events.

```text
                         JARVIS PLATFORM
                               |
                         JARVIS CORE
                               |
              +----------------+----------------+
              |                |                |
            Brain            Memory           Tools
              |                |                |
              +--------+-------+--------+-------+
                       |                |
               Presentation Engine   Event/Action Layer
                       |                |
            +----------+----------+     |
            |                     |     |
         Persona                Voice   |
            |                     |     |
            +----------+----------+     |
                       |                |
                 Client Adapter         |
                       |                |
      +----------------+----------------+----------------+
      |                |                |               |
   Discord          Desktop          Android          CCTV
  Digital Me         UI/Voice         Edge            Events
```

## 2. Jarvis Core responsibilities

Jarvis Core owns:

- intent interpretation
- reasoning and planning
- tool selection
- memory retrieval
- factual answer construction
- permission requests
- action planning
- response intent
- final structured response facts

Jarvis Core does **not** own:

- one specific voice
- one specific persona
- Discord-specific message formatting
- one specific UI
- raw CCTV frame loops
- direct destructive system actions without policy

## 3. Client responsibilities

A client is responsible for transport and local interaction.

Discord client:
- receives Discord voice/audio events
- turns final transcript into a Jarvis request
- provides Discord session/social context
- receives a structured Jarvis response
- renders it with selected persona + voice
- plays audio back to Discord

Desktop client:
- microphone/UI input
- status visualization
- permissions
- local action confirmation
- presentation selection

Android client:
- wake word/VAD
- local microphone/speaker
- lightweight offline commands
- relay to Jarvis Core

CCTV subsystem:
- emits structured perception/events
- does not continuously feed raw video to the LLM

## 4. Brain vs Persona vs Voice

These are three independent axes.

### Brain

Usually:
`jarvis`

Potential future:
- `jarvis-fast`
- `jarvis-deep`
- specialist planner

Brain determines:
- facts
- tool use
- reasoning
- answer intent

### Persona

Examples:
- `jarvis`
- `neutral`
- `gam`
- `elemisu`

Persona determines:
- tone
- slang
- sentence style
- humor
- terseness/verbosity
- social phrasing
- relationship-aware style

Persona must not rewrite verified facts.

### Voice

Examples:
- `jarvis`
- `gam`
- `elemisu`

Voice determines:
- TTS/RVC output voice
- voice model/preset
- optional delivery/prosody preset

Voice does not automatically imply Persona.

## 5. Presentation modes

Recommended explicit modes:

### VOICE_ONLY

Use another person's voice but keep Jarvis/neutral personality.

```text
brain = jarvis
persona = jarvis
voice = gam
```

### STYLE

Use a persona's language style and that voice.

```text
brain = jarvis
persona = gam
voice = gam
```

### SOCIAL

Use persona style plus scoped social memory/behavior examples.

```text
brain = jarvis
persona = gam
voice = gam
social_context = enabled
```

### MIXED

Allow explicit independent selection.

```text
brain = jarvis
persona = elemisu
voice = gam
```

This is unusual but architecturally valid.

## 6. Factuality boundary

The presentation layer may change:

- wording
- slang
- humor
- politeness
- sentence length
- cadence

It must not change:

- verified tool results
- dates/times
- weather values
- permissions
- safety constraints
- memory provenance
- action success/failure
- confidence/error state

## 7. Important compatibility rule

The current Digital Me behavior may select a voice and persona together.

Do not break existing commands in one step.

Introduce a compatibility adapter:

```text
legacy /voice user:@name
    -> voiceProfile = selected user
    -> personaProfile = selected user
```

Then add explicit commands/API for independent selection.

Old behavior remains the default until migration is verified.

## 8. Shared intelligence

Discord and Jarvis should share:

- global project knowledge
- approved owner preferences
- shared factual memories
- selected episodic memories
- tool access according to policy

But persona-specific behavior remains scoped.

Do not leak persona A's behavior examples into persona B.

## 9. Naming

Recommended conceptual names:

- `JarvisCore`
- `JarvisRequest`
- `JarvisResponse`
- `PresentationProfile`
- `PersonaProfile`
- `VoiceProfile`
- `PresentationRenderer`
- `ClientContext`
- `DiscordJarvisAdapter`

## 10. Migration principle

Do not replace `ResponseGenerator` and `BotService` in a large rewrite.

Preferred sequence:

1. introduce new interfaces
2. adapt existing code behind them
3. maintain current behavior
4. add independent persona/voice API
5. test compatibility
6. gradually move response reasoning into Jarvis Core boundaries
