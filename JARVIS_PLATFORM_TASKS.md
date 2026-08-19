# Jarvis Platform Task Queue

These tasks supersede the previous assumption that Jarvis should become a Discord-resident assistant.

**Priority update (2026-08-18):** `JARVIS_FIRST_TASKS.md` now outranks further Discord work. JARVIS-004/005 code in this tree is kept; JARVIS-006+ Discord items are deferred until Jarvis Core v1.

Do not mark them DONE without evidence.

## JARVIS-001 — Core contracts
Priority: P1
Status: DONE

Goal:
Introduce presentation-neutral Jarvis request/result interfaces.

Work:
- inspect current `ResponseGenerator`, `LocalLlmProvider`, `BotService`, `SocialBrain`
- add TypeScript types/interfaces
- no behavior change required

Acceptance:
- build/tests pass
- current Discord behavior unchanged
- core result can represent facts/tool refs/memory refs without persona or voice coupling

Evidence:
- `src/jarvis/core/types.ts`, `src/jarvis/core/JarvisCore.ts`
- `tests/jarvis_platform.test.ts`
- `npm run lint` PASS; targeted TS suite 61 passed (2026-08-18)
- live `BotService` / `ResponseGenerator` path not wired

## JARVIS-002 — PresentationProfile model
Depends on JARVIS-001
Status: DONE

Goal:
Represent Brain, Persona and Voice as independent selections.

Acceptance:
- `brainProfileId`, `personaProfileId`, `voiceProfileId` separated
- session/one-turn scope represented
- no voice model is loaded merely to select a persona
- compatibility mapping exists for current behavior

Evidence:
- `src/jarvis/presentation/types.ts`, `compatibility.ts`, `facts.ts`
- `FactPreservingPresentationEngine` is a contract/test renderer only; it does not wrap `ResponseGenerator`
- `legacyVoiceCommandProfile` / `legacyPersonaCommandProfile` map current `/voice` + `/persona` coupling


## JARVIS-003 — Backward-compatible PresentationEngine
Depends on JARVIS-002
Status: DONE

Goal:
Wrap existing persona/behavior generation behind a presentation boundary.

Acceptance:
- current persona-scoped behavior remains isolated
- factual structured fields are preserved
- no change to consent model
- legacy output tests pass

Evidence:
- `src/jarvis/clients/discord/ResponseGeneratorPresentationEngine.ts`
- originally live `AudioReceiver` called `presentLegacyTurn` without an independent profile; JARVIS-004 now passes the guild profile
- `/voice` / `/persona` still both set voice+persona via compatibility mapping
- `tests/jarvis_platform.test.ts` covers legacy parity, voice-only isolation, and fact preservation

## JARVIS-004 — Decouple voice selection from persona selection
Depends on JARVIS-003
Status: DONE

Goal:
Allow:
- Gam voice + Jarvis persona
- Gam voice + Gam persona
- Jarvis voice + Gam persona

Acceptance:
- existing `/voice` behavior still works by compatibility mapping
- new internal API can select independently
- persona change does not force RVC selection
- voice change does not load persona memory
- tests cover isolation

Evidence:
- `src/jarvis/clients/discord/PresentationSessionStore.ts`
- `BotService` keeps `/voice` and `/persona` on `applyLegacyVoiceAndPersona` (both axes, SOCIAL)
- dashboard-only `voice-only` / `persona-only` commands select one axis
- `AudioReceiver.presentLegacyTurn` now receives the guild `PresentationProfile`
- `npx tsx --test tests/jarvis_platform.test.ts` PASS 22/22 (2026-08-18)
- `npm run lint` PASS
- not live Discord verified

## JARVIS-005 — DiscordJarvisAdapter
Depends on JARVIS-001/003
Status: DONE

Goal:
Create an adapter boundary between Discord/Digital Me and Jarvis Core.

Acceptance:
- SocialBrain still decides whether to answer
- Jarvis handles reasoning only after response decision
- Discord transport remains outside Jarvis Core
- fallback behavior remains honest if Jarvis is unavailable

Evidence:
- `src/jarvis/clients/discord/DiscordJarvisAdapter.ts`
- live `AudioReceiver` calls the adapter after SocialBrain SPEAK
- live Core is `UnavailableJarvisCore`; `presentLegacyTurn` then uses `ResponseGenerator.generate()`
- `PassThroughJarvisCore` covered in unit tests only
- `npx tsx --test tests/jarvis_platform.test.ts` PASS 22/22 (2026-08-18)
- not live Discord verified

## JARVIS-006 — InvocationResolver
Depends on JARVIS-002
Status: READY

Goal:
Parse commands such as:
- "Jarvis ใช้เสียง Gam"
- "ตอบแบบ Gam"
- "ใช้เสียง Gam แต่ตอบปกติ"

Acceptance:
- returns content + presentation override
- low-confidence input does not silently mutate persistent state
- unit tests in Thai and mixed Thai/English

## JARVIS-007 — Shared memory context adapter
Depends on MEMORY-001 and core contracts
Status: READY as adapter design

Goal:
Define retrieval of:
- global Jarvis memory
- Discord/session memory
- selected persona memory

Acceptance:
- persona memory only loaded when enabled
- voice selection alone does not change memory scope
- canonical memory refs retained
- no SQLite migration required yet

## JARVIS-008 — Fresh-data tool routing
Depends on core contracts
Status: FUTURE/READY after tool interface review

Goal:
Allow Jarvis to recognize questions needing live factual tools.

Example:
weather question -> weather capability -> structured facts -> persona render.

Acceptance:
- presentation layer never calls live tools itself
- factual result survives persona transformation
- tool failure is explicit

## JARVIS-009 — `/jarvis-lab` reflects real architecture
Depends on UI-001 prototype
Status: FUTURE

Goal:
Visualize separate nodes/links for:
- Jarvis Core
- Persona
- Voice
- Discord client
- Memory
- Tools

Acceptance:
- "use Gam voice" activates voice node only
- "use Gam persona" activates persona node
- UI is state-driven and optional
- GPU usage measured
