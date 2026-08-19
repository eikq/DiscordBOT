# Cursor Prompt — Focus on Standalone Jarvis First

The project priority has changed.

Read:

1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `SESSION_STATE.md`
4. `JARVIS_FIRST_DIRECTIVE.md`
5. `JARVIS_V1_DEFINITION_OF_DONE.md`
6. `JARVIS_FIRST_TASKS.md`
7. `JARVIS_PLATFORM_ARCHITECTURE.md`
8. `PRESENTATION_ENGINE_SPEC.md`
9. `JARVIS_MEMORY_ARCHITECTURE.md`
10. `SECURITY_PRIVACY.md`

## New owner direction

Do not focus on Discord now.

Build the standalone Jarvis platform first. Discord/Digital Me will be integrated later.

The existing Discord code must remain working and compiling, but new Discord features and live Discord work are deferred.

## Current known state

The latest session reports:

- JARVIS-003 implemented and unit-tested
- presentation wrapper exists
- live Discord still uses the coupled legacy `/voice` path
- lint passes
- 65 TypeScript tests pass
- JARVIS-003 is not live-verified
- existing Discord secrets/config may exist locally, but they are not the current development priority

Do not start JARVIS-004 as a Discord runtime feature.

## Immediate work

Start with:

### JF-001 — Finish Jarvis Core contracts

Make sure the core is client/transport neutral.

Then:

### JF-002 — Standalone text harness

Create a safe non-Discord developer path to call Jarvis Core.

Preferred outcome:
- local API/CLI or `/jarvis-lab` text input
- structured Jarvis result
- presentation rendering
- tool/memory references
- no Discord requirement

Then choose the smallest safe next task among:
- JF-003 memory canonical store
- JF-007 standalone presentation profile runtime

Completed: JF-001, JF-002, JF-003/MEMORY-002, JF-004, JF-005.
- JF-006 standalone Jarvis UI shell
- JF-007 standalone presentation-profile runtime

Use dependencies and risk to decide.

## Hard constraints

- Do not delete or rewrite Discord.
- Do not spend time on live Discord voice tests now.
- Do not change slash-command behavior unless needed to preserve compatibility.
- Do not weaken voice consent.
- Jarvis Core must not depend on Discord transport types.
- Persona and Voice remain independent architectural concepts.
- Verified facts remain immutable across presentation rendering.
- Keep Qwen3.8/local tools reusable through interfaces.
- Preserve current memory data.
- No destructive memory migration.
- No commit/push unless explicitly requested by owner.
- Preserve pre-existing dirty/uncommitted work.

## Standalone Jarvis target

The main development loop should become:

```text
local text/mic
 -> Jarvis Core
 -> memory/tools/policy
 -> structured result
 -> persona
 -> voice
 -> local UI/audio
```

not:

```text
Discord
 -> Jarvis
```

## Reporting

Update `SESSION_STATE.md` after substantial work.

Report:
- task completed
- files changed
- tests actually run
- whether behavior is unit/offline/live verified
- what remains blocked
- recommended next Jarvis-first task

Continue autonomously through safe READY Jarvis-first tasks.
Stop before destructive migrations, irreversible product decisions, or actions requiring owner secrets/consent/hardware.
