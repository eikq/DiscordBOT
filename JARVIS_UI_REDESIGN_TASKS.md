# Jarvis UI Redesign Tasks

## UI-R1 — Recompose `/jarvis-lab`
Status: DONE (unit-tested + live lab UI verified 2026-08-19)

Replace the current top-left form layout with:
- compact top system ribbon
- left memory rail
- dominant central core
- right tools rail
- bottom command dock

Acceptance:
- no giant unused blank region
- strong visual hierarchy
- responsive
- existing Ask flow still works

Evidence: `src/jarvis/ui/JarvisLabPage.tsx`, `jarvis-lab.css`. Desktop 1920×1080: core 448px centered, rails 320px. Narrow ~408px stacks ribbon → core → memory → tools → timeline → dock.

## UI-R2 — System ribbon
Status: DONE

Replace most pills with one compact ribbon:
`LOCAL ●  QWEN ●  MEMORY ●  TOOLS 14/14  VOICE ○`

Note: TOOLS shows registered count (live: 15), not invented live health `n/n`. Unknown status shows `…`, not offline.

## UI-R3 — State-driven Core v1
Status: DONE (CSS/SVG; not WebGL)

Build lightweight CSS/SVG/Canvas Core for:
idle, thinking, memory, tool, responding, degraded, error.

Must be driven by real UI state.

In-flight asks are `thinking` (single round-trip; no fake mid-pipeline telemetry). Completed turns map to memory/tool/responding from actual refs.

## UI-R4 — Memory evidence rail
Status: DONE

Show memory refs, confidence, status, provenance. No raw DB dumps.

Live: `fact:architecture.memory_backend · fact · active · global · 95% · provenance smoke:seed`

## UI-R5 — Tools rail
Status: DONE

Show capability id, provider, status, untrusted flag, sources and failure state.

Provider comes from status catalog metadata (no invoke). Live: `lab.ping ok · local`.

## UI-R6 — Presentation controls
Status: DONE

Replace raw selects with polished accessible persona/voice controls.
Keep Persona and Voice independent.

Live: Gam persona + Jarvis voice persisted; restored to Jarvis/Jarvis after the check.

## UI-R7 — Command dock
Status: DONE

Auto-growing Ask field, Enter submit, Shift+Enter newline, clear loading/disabled states.

Mic control is enabled (JF-008): click to listen, silence or click to finalize, then Ask Jarvis. No wake word. Optional speech (JF-009): typed Speak toggle defaults off; mic answers auto-speak.

## UI-R8 — Observable activity timeline
Status: DONE

Show only observable stages:
`REQUEST → MEMORY → TOOL → MODEL → RESPONSE`

Never display hidden chain-of-thought.

In-flight: only REQUEST is active. After a turn, MEMORY/TOOL are done/empty/failed from real refs.

## UI-R9 — WebGL/3D command center
Status: DONE (implemented + unit-tested + live browser QA 2026-08-19; owner visual acceptance pending)

Real Three.js/R3F Jarvis Core on `/jarvis-lab`:
- nucleus + GPU particle sphere (~4200 pts high) + internal filaments + orbital rings + tool orbit nodes + deep-space dust
- interactive memory knowledge graph from the real SQLite store (`/api/jarvis/memory/graph`), instanced nodes, curved edges, hover/click/Shift-click path, search/filters/inspector
- state-driven moods for idle/listening/transcribing/thinking/memory/tool/responding/speaking/degraded/error (+ night-agent violet tint)
- memory pulses and tool arcs fired only from real turn evidence (PulseBus)
- camera: OrbitControls drag/wheel/pinch + FIT/CORE/GRAPH/PRESENTER/RESET eased presets
- Presenter Mode (2026-08-20): briefing panel on the existing `/jarvis-lab` command center (not a separate app). Rich turns can open a structured briefing; greetings stay plain. Quality `minimal`/`2d` still cover the Minimal view. Live visual QA of Presenter is LA-026 (PARTIAL; not LIVE_VERIFIED).
- quality: auto/high/balanced/minimal + explicit 2D mode; FPS auto-step; DPR caps; `prefers-reduced-motion`; hidden-tab pause; WebGL-lost fallback to the CSS core (kept in `JarvisCoreVisual`)
- ops rails: real system health (`/api/jarvis/system`), model status, voice/STT, night agent (`/api/jarvis/night`)

Evidence: `src/jarvis/ui/three/*`, `src/jarvis/ui/graph/*`, `src/jarvis/memory/graphAdapter.ts`, `src/jarvis/standalone/labSystem.ts`, tests `jarvis_lab_graph/jarvis_lab_scene`, QA shots `.runtime/qa-lab-final.png`. 203/203 TS tests, tsc + build green. ~144 fps at high on the RTX 5090 laptop.

## Queue 09 — Command Center V2 modes (addendum, not a dashboard rewrite)

Status: IMPLEMENTED + UNIT_VERIFIED (cloud). Not LIVE_VERIFIED.

`/jarvis-lab` now switches one operational mode at a time:

ASSISTANT · PRESENTER · OPERATIONS · MEMORY · INTELLIGENCE · DEVICES

Camera Core/Graph remain visual stage controls. CommandCenterRuntime
is unchanged. See ADR-031 and `src/jarvis/ui/commandCenterV2.ts`.
