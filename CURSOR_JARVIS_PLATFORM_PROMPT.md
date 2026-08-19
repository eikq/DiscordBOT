# Cursor Prompt — Jarvis Core / Discord Client / Persona-Voice Decoupling

Read:

1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `SESSION_STATE.md`
4. `JARVIS_PLATFORM_ARCHITECTURE.md`
5. `PRESENTATION_ENGINE_SPEC.md`
6. `DISCORD_JARVIS_ADAPTER_SPEC.md`
7. `MEMORY_SHARING_POLICY.md`
8. `JARVIS_API_CONTRACTS.md`
9. `JARVIS_PLATFORM_TASKS.md`

Current baseline from the latest session:
- non-live P0 is stable
- lint passes
- TypeScript tests: 61 passed (`core` + `research` + `jarvis_memory` + `jarvis_platform`)
- MEMORY-001 is design-only
- JARVIS-001/002 contracts exist in `src/jarvis/` and are not live-wired
- SQLite dual-write has not started
- `/jarvis-lab` has not started
- no live Discord/research/voice verification was run

## Product direction

Jarvis is NOT a Discord bot.

Jarvis Core is the shared intelligence platform.

Digital Me / Discord is one client/subsystem that sends requests to Jarvis and can use:
- Jarvis reasoning
- Jarvis memory
- Jarvis tools
- shared factual knowledge

Persona and Voice must be independent.

Examples the architecture must eventually support:

1. "bot gam วันนี้อากาศเป็นไง"
   - Jarvis retrieves live weather facts
   - Persona = Gam
   - Voice = Gam

2. "Jarvis ใช้เสียง Gam"
   - Persona remains Jarvis
   - Voice becomes Gam

3. "ใช้เสียง Gam แต่ไม่เอาบุคลิก Gam"
   - Voice = Gam
   - Persona = Jarvis/neutral

4. "ตอบแบบ Gam แต่ใช้เสียง Jarvis"
   - Persona = Gam
   - Voice = Jarvis

## Work now

Do NOT start MEMORY-002 SQLite dual-write yet.

Do NOT redesign the dashboard yet.

Start with the smallest architecture-safe steps:

### First: JARVIS-001
- inspect current `ResponseGenerator`, `LocalLlmProvider`, `BotService`, `SocialBrain`
- define presentation-neutral Jarvis request/result interfaces
- keep behavior unchanged
- add tests

### Then: JARVIS-002
- add `PresentationProfile` with independent brain/persona/voice
- add compatibility mapping for legacy current behavior
- add tests

If those are stable, continue to JARVIS-003.

Do not proceed to broad behavior migration if it would create a large rewrite.

## Hard constraints

- SocialBrain remains the Discord turn-taking policy for now.
- Jarvis Core should not manage Discord transport.
- Voice selection must not imply persona selection in the new API.
- Persona selection must not imply voice selection in the new API.
- Preserve current legacy behavior through an adapter until migration is tested.
- Persona may transform style, not verified facts.
- Presentation layer does not call tools.
- Tool calls and factual reasoning belong to Jarvis Core.
- Preserve persona-scoped behavior isolation.
- Preserve all voice consent/training safety invariants.
- Do not commit/push.
- Preserve pre-existing dirty work.
- Update `SESSION_STATE.md` with actual evidence.

## Reporting

After each completed task, record:

- files changed
- tests run
- current compatibility behavior
- what is still design-only
- architectural decisions requiring owner approval
- recommended next task

Continue autonomously through JARVIS-001 and JARVIS-002 if tests stay green.
Stop before any destructive migration or major user-facing command behavior change that is not covered by compatibility.
