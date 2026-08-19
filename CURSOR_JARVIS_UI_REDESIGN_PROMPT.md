# Cursor Prompt — Fix the Jarvis Lab UI

The current `/jarvis-lab` functionality is good. The current UI is not acceptable as the final Jarvis interface.

Do not work on Discord, JF-008 STT, or JF-009 TTS/RVC in this task.
Do not rewrite Jarvis Core, Memory, CapabilityHost, or presentation contracts unless a minimal frontend integration fix is required.

Read:
1. `AGENTS.md`
2. `SESSION_STATE.md`
3. `JARVIS_UI_REDESIGN_DIRECTIVE.md`
4. `JARVIS_UI_REDESIGN_TASKS.md`
5. `JARVIS_UI_UX_VISION.md`

Implement UI-R1 through UI-R8.

### Required result
Turn `/jarvis-lab` from a developer form into a standalone Jarvis command center with:
- top system ribbon
- left Memory/Context rail
- dominant central Jarvis Core
- right Tools/Activity rail
- bottom command dock
- polished Persona/Voice controls
- state-driven visual feedback
- responsive mobile/narrow layout

### Preserve real data
Continue showing real:
- Qwen/model state
- memory status/version
- memoryRefs + provenance
- tool/capability activity
- uncertainty/degraded state
- persona
- voice
- speech active/inactive
- latency when available

Do not invent telemetry for visual effect.

### Visual quality
This should not look like:
- a debug form
- a generic admin dashboard
- a collection of cyan pills
- a Discord/chat clone

Use the Fluctlight/cognition sphere as visual inspiration only.

### First implementation technology
Prefer CSS/SVG/Canvas animation.
Do not add heavy WebGL/Three.js yet.

### Performance
- reduced-motion support
- minimal-GPU mode/fallback
- avoid continuous expensive rendering
- pause/reduce animation while hidden
- do not interfere with local AI runtime

### Verification
After implementation:
1. lint
2. relevant UI tests
3. build
4. open `/jarvis-lab`
5. inspect desktop and narrow widths
6. Ask Jarvis still works
7. memory evidence appears
8. tool evidence appears
9. persona/voice session state still works
10. standalone process still does not require Discord

Update `SESSION_STATE.md`.

Report:
- files changed
- UI sections implemented
- behavior preserved
- tests/build
- remaining visual limitations
- whether a later UI-R9 WebGL upgrade is justified
