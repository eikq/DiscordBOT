# Architecture Decision Log — New Decisions After Cursor Handoff

Do not rewrite historical facts here. Add new decisions only when an actual project decision is made.

---

## ADR-001 — Hybrid Jarvis memory with SQLite as canonical store

Date: 2026-08-18
Status: Accepted for design; not migrated

### Context

The working social memory lives in `SocialMemoryBrain` JSON + `observations.jsonl` + an Obsidian vault export. A second older JSON store exists in `FriendMemoryManager`. The addendum proposed SQLite + Qdrant + Obsidian roles.

### Decision

- Keep `SocialMemoryBrain` as the live writer.
- Treat SQLite as the future canonical structured store.
- Treat Qdrant as an index whose payload `canonical_id` points at SQLite/JSON ids.
- Treat Obsidian as a projection, not a runtime database.
- Do not migrate or delete existing `data/brain/` files until a later dual-write task.

### Alternatives considered

- Make Obsidian the runtime store
- Make Qdrant the source of truth
- Replace SocialMemoryBrain in one rewrite

### Why

Existing social memory already has provenance, supersession, and vault export. Incremental adapters preserve that behavior.

### Consequences

Positive:
- Inspectable memory types and schema exist in code.
- Live Discord/social paths stay unchanged.

Negative:
- Two memory models coexist until MEMORY-002.

### Verification

`tests/jarvis_memory.test.ts` checks ids, schema SQL, supersession semantics, Qdrant payload identity, and non-destructive projection.

### Related files

- `src/bot/memory/jarvis/`
- `JARVIS_MEMORY_ARCHITECTURE.md`
- `src/bot/memory/SocialMemoryBrain.ts`

---

## ADR-002 — Jarvis Core is platform-level; Discord is a client

Date: 2026-08-18
Status: Accepted for design; live Discord path not migrated

### Context

Digital Me began as a Discord-first voice companion. Broader product direction is a Jarvis-style local assistant shared across Discord, desktop, Android, CCTV, tools, and automation. Live `/voice` and `/persona` both write `BotService.activeVoiceSpeakers`, so voice selection currently implies persona.

### Decision

- Treat Jarvis Core as the platform-level intelligence layer.
- Treat Digital Me / Discord as one client/subsystem.
- Keep Brain, Persona, and Voice as independent presentation fields.
- Keep SocialBrain as Discord turn-taking policy.
- Preserve current `/voice` coupling through `legacyVoiceCommandProfile()` until JARVIS-004.

### Alternatives considered

- Make Jarvis a Discord-resident assistant
- Split voice and persona in live commands immediately
- Rewrite `ResponseGenerator` before contracts exist

### Why

Independent presentation is required for voice-only and persona-only modes. Contracts plus a compatibility mapper let that happen without changing live Discord behavior yet.

### Consequences

Positive:
- Core results can carry facts/tool/memory refs without persona or voice fields.
- New selectors (`withVoice` / `withPersona`) do not mutate the other axis.

Negative:
- Live Discord still uses the coupled map until an explicit command-behavior task.

### Verification

`tests/jarvis_platform.test.ts` covers presentation-neutral results, the scenario matrix, memory-scope isolation, one-turn vs session scope, fact survival, and legacy `/voice` mapping.

### Related files

- `src/jarvis/`
- `ADR_002_JARVIS_PLATFORM_DIRECTION.md`
- `JARVIS_PLATFORM_ARCHITECTURE.md`

---

## ADR-002 — Jarvis Core is platform-level; Discord is a client

Date: 2026-08-18
Status: Accepted as design; live Discord path unchanged

### Context

Digital Me began as a Discord-first voice companion. The broader product goal is a Jarvis-style local assistant shared across Discord, desktop, Android, CCTV, tools, and automation. A Discord-centric architecture would couple the central intelligence to one transport and keep persona/voice coupled.

Current live coupling: `BotService.activeVoiceSpeakers` is written by both `/voice` and `/persona`; `personaForGuild()` reads that same map.

### Decision

- Treat Jarvis Core as the platform-level intelligence layer.
- Treat Digital Me / Discord as one client/subsystem.
- Keep Brain, Persona, and Voice as independent presentation fields.
- Keep SocialBrain as Discord turn-taking until an explicit migration.
- Preserve current `/voice` + `/persona` coupling through compatibility mappers until JARVIS-004.

### Alternatives considered

- Make Jarvis a Discord-resident assistant
- Immediately split live `/voice` from persona without a compatibility layer

### Why

Independent presentation is required for voice-only and persona-only modes. Changing live commands before adapters exist would break the current consented clone workflow.

### Consequences

Positive:
- Contracts exist without changing Discord behavior.
- Voice-only selection does not load persona memory in the new API.
- Persona-only selection does not change the voice profile in the new API.

Negative:
- Two presentation models coexist until JARVIS-003/004.
- Live `/voice` still implies persona.

### Verification

`tests/jarvis_platform.test.ts` checks presentation-neutral core results, independent fields, legacy mapping, memory-scope isolation, one-turn vs session scope, and immutable-fact survival.

### Related files

- `src/jarvis/`
- `ADR_002_JARVIS_PLATFORM_DIRECTION.md`
- `JARVIS_PLATFORM_ARCHITECTURE.md`
- `JARVIS_PLATFORM_TASKS.md`

