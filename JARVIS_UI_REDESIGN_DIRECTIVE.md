# Jarvis UI Redesign Directive

The current `/jarvis-lab` is functionally valid but visually only a developer shell.

## Problems to fix
- visual weight is trapped in the top-left
- large unused empty area
- tiny decorative core instead of a central Jarvis focal point
- too many diagnostic pills
- generic HTML selects
- weak hierarchy between Core, Memory, Tools, Persona, Voice and Ask
- little visible difference between idle/thinking/memory/tool/responding/degraded
- no spatial relationship between Core, Memory and Tools

## Target
Build a high-end standalone Jarvis command center. Do not redesign Digital Me/Discord.

Desktop composition:

```text
┌──────────────────────────────────────────────────────────────┐
│ JARVIS          LOCAL ●  QWEN ●  MEMORY ●  TOOLS ●         │
│                                                              │
│ MEMORY / CONTEXT       [ CENTRAL JARVIS CORE ]    TOOLS       │
│ evidence/provenance        ◌  ✦  ◌              activity     │
│                            JARVIS                sources      │
│                             CORE                 errors       │
│                                                              │
│         REQUEST → MEMORY → TOOL → QWEN → RESPONSE             │
│                                                              │
│ Persona: Jarvis   Voice: Gam   Session: Local                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Ask Jarvis...                                            │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Design rules
- dark navy/black base
- cyan/ice-blue cognition light
- memory may use cyan-violet
- tools/research may use teal/gold accent
- amber warning, red critical, gray-blue degraded
- use light as information; do not neon-outline every element
- reduce pills/cards dramatically
- persona/voice controls must look like intentional Jarvis controls, not raw selects
- command input should feel like a command dock, not a form

## Central Core
The core must represent real observable frontend state, not fake consciousness.

States:
- idle
- thinking
- memory
- tool
- responding
- degraded
- error

Visual behavior:
- idle: slow pulse
- thinking: particles/lines converge inward
- memory: memory ring lights and selected memories flow toward core
- tool: orbital tool node activates
- responding: outward wave
- degraded: reduced energy + amber/gray state

Do not expose hidden chain-of-thought. Only show observable stages and structured telemetry.

## Information architecture
Top ribbon:
- local/remote
- model
- memory health/version
- capability health
- speech state

Left rail:
- memoryRefs
- canonical id
- type
- confidence
- provenance/source refs
- active/superseded state

Center:
- Jarvis Core
- current state
- focused answer/result

Right rail:
- capability/tool activity
- provider
- status
- untrusted flag
- source URLs/citations
- failures/degraded state

Bottom:
- Ask Jarvis command dock
- persona
- voice
- one-turn override
- future mic button

## Performance
The UI must not steal meaningful resources from Qwen/STT/TTS/RVC.

First polished version should use lightweight CSS/SVG/Canvas.
Do not jump to expensive WebGL yet.

Require:
- reduced-motion
- pause/reduce animation when tab hidden
- responsive layout
- minimal-GPU fallback
- cap animation work

After this version is stable, an optional React Three Fiber/Three.js core can be evaluated separately.

## Preserve
Do not alter working Core/Memory/Capability behavior to fit the UI.
Continue using:
- `GET /api/jarvis/status`
- `POST /api/jarvis/ask`
- current persona/voice session state
- memory evidence
- tool activity
- uncertainty/degraded state
- standalone mode without Discord
