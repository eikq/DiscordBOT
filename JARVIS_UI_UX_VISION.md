# JARVIS UI / UX Vision

Status: Design direction
Goal: Build a beautiful real-time operational UI inspired by futuristic AI interfaces and the fictional "Fluctlight" visual concept, while keeping the existing dashboard useful.

## Key decision

The primary Jarvis dashboard should be a **real-time state-driven 3D interface**, not a pre-rendered scroll movie.

The uploaded Website Creator Prompt Pack is useful as visual/cinematic inspiration, especially its deliberate art direction and "one impossible moment" approach. However, its core technique is a scroll-mapped JPEG image-sequence scrub. That technique is ideal for a landing page, boot cinematic, demo, or storytelling sequence, but not as the operational center of a live assistant.

Use real 3D/WebGL for the persistent Jarvis core.

## Core visual metaphor: Fluctlight-inspired Memory Core

Do not copy copyrighted UI assets directly.

Use the general concept:

- luminous spherical cognition core
- thousands of moving particles
- concentric data rings
- filaments connecting memories
- orbiting tool/status nodes
- holographic depth
- dark navy/black environment

The sphere represents current cognition, not a literal claim about AI consciousness.

## Visual mapping to system state

### Inner core
Represents:
- current working memory
- active task
- current response/reasoning state

Behavior:
- subtle pulse while idle
- expands while listening
- denser particle convergence while thinking
- outward wave while speaking

### Memory shells
Concentric regions:

- working
- episodic
- semantic
- social
- procedural

Do not render every real memory all the time.
Visualize a sampled/aggregated representation.

### Memory retrieval animation

When Jarvis retrieves memories:

```text
distant particles
 -> highlight
 -> paths illuminate
 -> selected memories travel toward core
 -> core stabilizes
```

The UI can show a small evidence panel with the actual retrieved records.

### Tool nodes

Orbiting nodes can represent:
- Discord
- Research
- Files
- CCTV
- Calendar
- Git/Coding
- Voice
- Android/IoT

Tool call:
node lights up -> connection beam -> status/result.

### CCTV alert

Do not turn the whole UI into permanent red.

Suggested:
- core remains stable
- one alert arc turns amber/red
- CCTV node pulses
- event card shows observable facts and confidence
- clicking opens clip/event timeline

## State palette

The final palette should be designed visually, but the state concept can be:

- Idle: cyan/ice blue
- Listening: bright blue
- Thinking: blue-violet / white energy
- Speaking: cyan-white outward waves
- Research: gold/teal accents
- Success: restrained green
- Warning: amber
- Critical alert: red
- Offline/degraded: gray/desaturated blue

State colors are UI status signals, not claims of actual emotions.

## Main layout

Desktop command center:

```text
+-----------------------------------------------------------+
| System / profile / GPU / voice / privacy status           |
|                                                           |
|         [memory/tool timeline]       [context panel]       |
|                     \               /                     |
|                      FLUCTLIGHT CORE                       |
|                     /               \                     |
|       [CCTV/events]                   [tools/agents]        |
|                                                           |
| Voice transcript / command bar / activity timeline        |
+-----------------------------------------------------------+
```

Avoid covering the 3D core with permanent cards.

Panels should appear contextually and collapse when not needed.

## Modes

### Command Center
Default operational view.

### Memory Explorer
Click/expand the core:
- recent episodes
- people
- projects
- semantic facts
- provenance graph
- search box
- importance/confidence controls

### CCTV Intelligence
- camera preview
- zone overlay
- current tracked objects
- event timeline
- anomaly comparison
- local retention controls

### Developer / Night Agent
- task queue
- active agent
- tool/terminal activity
- tests
- blockers
- escalation state
- model/VRAM/RAM usage

### Voice / Social
- participants
- transcript
- consent state
- selected persona/voice
- STT/TTS latency
- barge-in status

## Cinematic use of the uploaded prompt pack

Use the pack's film-scrub concept only for optional experiences such as:

### Boot / Introduction
Scroll or startup sequence:
darkness -> particles appear -> filaments connect -> Jarvis core forms -> dashboard unlocks.

### Memory Journey
A storytelling view where scrolling moves through:
working memory -> episodes -> semantic knowledge -> long-term archive.

### Public demo / portfolio
A privacy-safe hosted page showcasing Jarvis architecture.

Do not require hundreds of preloaded frames for the normal dashboard.

## Technical direction

The current dashboard is React-based.

Recommended visual stack:
- React
- Three.js via React Three Fiber for 3D scene integration
- CSS/HTML overlays for real controls
- real-time state from existing Express APIs
- reduced-motion mode
- automatic quality tiers

The 3D layer must be optional:
if unavailable or expensive, the dashboard remains fully usable in 2D.

## Performance rules

The UI must never steal enough GPU resources to destabilize local AI.

Important:
- cap pixel ratio
- pause/reduce animation when window is hidden
- reduce particle count in VOICE_INTERACTIVE profile
- allow "Minimal UI" for heavy inference/training
- measure GPU cost on the actual laptop
- avoid expensive permanent post-processing if it causes model eviction or latency

UI beauty is lower priority than STT/LLM/TTS stability.

## Reference principles from the provided videos

Use the referenced Jarvis projects primarily as product references:
- Jarvis should perform actions, not only chat.
- show actions and tool outcomes transparently
- external actions should have explicit permission state
- give the user a clear activity log
- support real-world integrations gradually

Do not copy another project's private code or branding.

## Sword Art Online / Fluctlight inspiration

Treat Fluctlight as a fictional design metaphor only.

Engineering mapping:

```text
Fictional cognition core -> Jarvis Self/Identity configuration
short conscious state    -> Working Memory
life experiences         -> Episodic Memory
knowledge                -> Semantic Memory
habits/skills            -> Procedural Memory
connections to people    -> Social Memory
sensory input            -> Perception/Event Bus
```

This gives the project a coherent visual and conceptual language without pretending the software is biologically conscious.

## First UI milestone

Do not redesign every dashboard panel at once.

Build a separate experimental route/component:

`/jarvis-lab`

Milestone:

- one performant 3D core
- reacts to mocked states: IDLE/LISTENING/THINKING/SPEAKING/ALERT
- basic tool-orbit nodes
- reduced-motion fallback
- GPU/performance monitor
- no changes to current working dashboard behavior

Only integrate into the main command center after the prototype is stable.
