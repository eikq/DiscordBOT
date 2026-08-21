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

---

## ADR-003 — Live `/voice` stays coupled; internal presentation axes are independent

Date: 2026-08-18
Status: Accepted; implemented and unit-tested (not live Discord verified)

### Context

JARVIS-002/003 introduced independent Brain/Persona/Voice fields, but live Discord still used one map (`BotService.activeVoiceSpeakers`) for both `/voice` and `/persona`. Operators still expect those commands to select a cloned identity and its voice together.

### Decision

- Keep live `/voice` and `/persona` (and dashboard `voice` / `persona`) as compatibility mapping: they set **both** voice and persona in SOCIAL mode via `PresentationSessionStore.applyLegacyVoiceAndPersona`.
- Use `PresentationSessionStore.selectVoice` / `selectPersona` as the independent internal API (dashboard-only `voice-only` / `persona-only`; no new slash commands).
- Treat `activeVoiceSpeakers` as a playback-speaker cache synced from the store.
- `personaForGuild` / SocialBrain follow the persona axis; TTS follows the voice axis.
- Cloned voice playback and cloned-identity persona still require active per-server consent.
- Wire `DiscordJarvisAdapter` after SocialBrain SPEAK. Live Core remains `UnavailableJarvisCore` and falls back to `ResponseGenerator.generate()`.

### Alternatives considered

- Split live `/voice` from `/persona` immediately
- Invent a full LLM Jarvis Core for JARVIS-005

### Why

Independent selection is required for mixed voice/persona modes without breaking the consented clone workflow. An honest unavailable Core keeps the live generate path until a real Core exists.

### Consequences

Positive:
- Gam voice + Jarvis persona, Gam both, and Jarvis voice + Gam persona are representable internally.
- Voice-only does not load persona memory; persona-only does not select an RVC speaker.

Negative:
- Live slash commands still set both axes until an explicit command-behavior task.
- Jarvis voice (no cloned speaker) will not play RVC audio; LocalTTS still requires a consented speaker id.

### Verification

`npx tsx --test tests/jarvis_platform.test.ts` PASS 22/22; `npm run lint` PASS. Not live Discord verified.

### Related files

- `src/jarvis/clients/discord/PresentationSessionStore.ts`
- `src/jarvis/clients/discord/DiscordJarvisAdapter.ts`
- `src/bot/BotService.ts`
- `src/bot/AudioReceiver.ts`

---

## ADR-004 — Standalone Jarvis first; Discord integration deferred

Date: 2026-08-18
Status: Accepted after installing `Jarvis_First_Priority_Addendum.zip`

### Context

The owner addendum changes priority: finish standalone Jarvis Core v1 before more Discord/Digital Me features. The working tree already had JARVIS-004/005 Discord adapters from the previous session.

### Decision

- Treat `JARVIS_FIRST_TASKS.md` as the active queue.
- Keep existing JARVIS-004/005 code (coherent, unit-tested). Do not expand Discord slash-command or live-VC work.
- At the time of this ADR, JF-003 and JF-006 were still blocked by earlier hard-stops. Later owner approvals: ADR-006 (SQLite), ADR-007 (Core memory), ADR-008 (isolated `/jarvis-lab`).
- Primary smoke path is `npm run jarvis:ask` (CLI) plus isolated `/jarvis-lab`; Discord remains deferred.

### Discrepancies recorded

- Pack deferred JARVIS-004/005; code already existed — kept, not reverted.
- Pack JF-003 asked to begin MEMORY-002 while TASKS.md still forbade it; later approved as ADR-006.
- Pack JF-006 asked for `/jarvis-lab` while TASKS.md forbade a dashboard rewrite; later approved as an isolated route (ADR-008), not a Digital Me UI replacement.

### Verification

`tests/jarvis_first.test.ts` + `tests/jarvis_platform.test.ts` (this session). Not live Ollama or Discord verified.

---

## ADR-005 — Generic capability registry; world-intel is one adapter

Date: 2026-08-18
Status: Accepted; implemented and unit-tested (not live world-intel verified)

### Context

Research lived behind `McpResearchGateway` / `ResearchAssistant`. Jarvis Core needs to request tools without depending on MCP, Discord, or one server.

### Decision

- Core and standalone code depend on `CapabilityHost` / `CapabilityDescriptor` / `CapabilityResult`.
- Provider kind (MCP, HTTP, local) is metadata for policy, not a Core import.
- Current read-only world-intel tools are the first adapter (`world-intel.<toolName>`), using the existing allowlist, untrusted wrapper, source ledger, and explicit upstream failure.
- Mutating MCP tools are not registered. Allowlist rejection remains in `McpResearchGateway.execute`.
- `ResearchAssistant` is unchanged; live `/research` still uses the gateway directly.

### Alternatives considered

- Rewrite ResearchAssistant onto the registry immediately
- One omnibus `world-intel.research` capability instead of per-tool ids

### Why

Per-tool ids give future policy/routing enough metadata. Leaving ResearchAssistant in place preserves the current research console without a Discord/research rewrite.

### Consequences

Positive:
- Core can invoke a fake or real capability without MCP types.
- Security properties stay in the gateway; the adapter cannot widen them.

Negative:
- Two call paths exist until ResearchAssistant is optionally wrapped later.

### Related files

- `src/jarvis/capabilities/`
- `src/bot/research/McpResearchGateway.ts`
- `tests/jarvis_capabilities.test.ts`

---

## ADR-006 — SQLite is the canonical Jarvis memory store; JSON/JSONL stay live

Date: 2026-08-18
Status: Accepted after owner approval of MEMORY-002 / JF-003

### Context

MEMORY-001 designed the schema. SocialMemoryBrain JSON + observations.jsonl remain the live social writer. The owner approved a non-destructive SQLite implementation.

### Decision

- Canonical future store is SQLite at `data/jarvis/jarvis.db`, accessed only through `JarvisMemoryStore`.
- Schema changes go through numbered migrations (`schema_migrations`); never delete-and-recreate.
- Contradictions are superseded (`superseded_by`), not overwritten.
- SocialMemoryBrain stays authoritative for current live behavior. Dual-write is opt-in via constructor and is not enabled in Discord `BotService`.
- Obsidian remains a projection. Qdrant remains an unimplemented rebuildable index keyed by canonical ids.
- JF-004 retrieval (`JarvisMemoryRetrieval`) reads the store with structured filters plus lexical FTS/LIKE. No new architecture.

### Consequences

Positive:
- Fresh and existing SQLite files upgrade in place.
- User `data/brain/` files are not migrated or deleted.

Negative:
- Two stores coexist until a later cutover. Dual-write is test-only unless a caller injects a store.

### Verification

`tests/jarvis_sqlite_memory.test.ts` + existing SocialMemoryBrain tests. Not live-migrated against operator data.

### Related files

- `src/bot/memory/jarvis/SqliteJarvisMemoryStore.ts`
- `src/jarvis/memory/retrieval.ts`
- `src/bot/memory/jarvis/migrations/`

---

## ADR-007 — Standalone Core consumes JarvisMemoryService, not SQLite

Date: 2026-08-18
Status: Accepted; implemented and unit-tested (not live Ollama verified)

### Context

JF-003/JF-004 created a canonical SQLite store and `JarvisMemoryRetrieval`. Core still answered without memory. The owner asked for JF-004B before Persona/Voice.

### Decision

- `LocalLlmJarvisCore` depends on optional `JarvisMemoryService`.
- Retrieval returns a bounded compact candidate set (default 8, max 12). Forgotten and expired memories are hidden by default. Active facts are preferred; superseded history is included only when requested.
- Canonical ids and provenance are copied onto `JarvisCoreResult.memoryRefs`. The LLM never queries SQLite. Presentation and `/jarvis-lab` display refs; they do not retrieve.
- Retrieval failure is explicit uncertainty; Core still answers. Memory is optional so a fresh install with an empty DB works.

### Consequences

Positive:
- Core stays client-neutral and store-agnostic.
- Empty or unavailable memory does not invent facts.

Negative:
- Retrieval is lexical/structured only. Qdrant is still not an index.

### Verification

`tests/jarvis_core_memory.test.ts` on temporary DBs. Seeded `architecture.memory_backend = SQLite` reaches `memoryRefs`. No LLM wording asserted.

### Related files

- `src/jarvis/memory/service.ts`
- `src/jarvis/memory/retrieval.ts`
- `src/jarvis/standalone/LocalLlmJarvisCore.ts`

---

## ADR-008 — Isolated `/jarvis-lab` shell; Digital Me dashboard stays

Date: 2026-08-18
Status: Accepted after owner approval of JF-006 (not JF-007)

### Context

TASKS.md previously blocked a dashboard `/jarvis-lab` redesign. The owner approved an isolated Jarvis-first shell after JF-004B, and asked to stop before Persona/Voice runtime.

### Decision

- `/jarvis-lab` is a separate React page (`JarvisLabPage`) selected in `src/main.tsx` by pathname. `src/App.tsx` is not replaced.
- Lab CSS lives in `src/jarvis/ui/jarvis-lab.css`. Do not treat a Digital Me dashboard rewrite as in scope.
- Local APIs `GET /api/jarvis/status` and `POST /api/jarvis/ask` are localhost-restricted. The 3D core is a CSS mock. Persona/voice dropdowns are ID labels only.
- Server may attach default canonical memory (`attachDefaultMemory: true`). Tests must pass `attachDefaultMemory: false`.

### Consequences

Positive:
- Standalone smoke path exists without Discord.
- Existing operator dashboard remains.

Negative:
- Lab is not live-verified against Ollama. JF-007 still needs owner approval.

### Related files

- `src/jarvis/ui/JarvisLabPage.tsx`
- `src/jarvis/standalone/labRuntime.ts`
- `server.ts`

---

## ADR-009 — Standalone presentation sessions; Discord coupling unchanged

Date: 2026-08-18
Status: Accepted after live text smoke + JF-007 implementation

### Context

Owner asked for a live standalone smoke, then JF-007 Persona/Voice runtime on `/jarvis-lab` only.

### Decision

- Brain remains `jarvis`. Persona and Voice are independent session axes in `StandalonePresentationSessions`.
- `/jarvis-lab` selectors persist on the lab session unless the ask is marked one-turn.
- Selecting a voice does not load RVC/TTS. The UI reports selected vs speech-active honestly.
- Selecting a persona may load only that persona's scoped behavior examples. Immutable facts, tool results, memory ids, and uncertainty stay on the Core result.
- Discord `/voice` and `/persona` still couple both axes. `JARVIS_STANDALONE=1` skips starting the Discord client so a text lab can run beside an existing bot.

### Verification

Live text smoke against Ollama Qwen3.8 27B on `http://127.0.0.1:3010`. JF-007 unit tests in `tests/jarvis_presentation_runtime.test.ts`. Not live speech verified.

---

## ADR-010 — `/jarvis-lab` is a 2D command center, not WebGL yet

Date: 2026-08-19
Status: Accepted

### Context

`/jarvis-lab` was a working developer form with a tiny decorative core and pill overload. The UI redesign addendum required a standalone Jarvis command center without rewriting Digital Me or changing Core/Memory/Capability behavior.

### Decision

- Rebuild `/jarvis-lab` as ribbon + memory rail + dominant CSS/SVG core + tools rail + command dock (UI-R1–R8)
- Drive core/timeline visuals from observable UI/API state only
- Keep Persona and Voice independent
- Defer UI-R9 WebGL until this 2D version is stable and the owner asks; require a 2D/minimal-GPU fallback if it happens
- Do not probe live capability health on status; catalog metadata is enough for provider/untrusted display

### Why

WebGL would compete with local Qwen/STT/TTS/RVC. Lightweight CSS/SVG already gives a central focal core and real evidence rails.

### Consequences

Positive:
- Lab is usable as a command center without Discord
- Digital Me dashboard stays intact

Negative:
- In-flight asks cannot show distinct memory vs tool core states until the API streams stages
- TOOLS ribbon is registered count, not live `n/n` health

---

## ADR-011 — Standalone mic rejects overlapping turns; audio is not training data

Date: 2026-08-19
Status: Accepted

### Context

JF-008 needed a Discord-free microphone path into Jarvis Core. Discord `AudioReceiver` is Opus/VC-specific. Standalone capture is conversational input, not consented voice-training.

### Decision

- New abstractions: `AudioInput`, `BrowserMicrophoneInput` / `ScriptedAudioInput`, `SpeechTurnController`
- Reuse existing Qwen3-ASR via `SpeechToTextProvider` / `LocalSTTProvider`
- Jarvis Core stays unaware of microphone implementation
- While STT or Core is busy, new mic starts are **rejected** (not queued, not cancelled)
- Default: do not persist raw standalone mic audio; `persistRejectedAudio: false`; do not use `RECORD_RAW_AUDIO` or `VoiceDatasetWriter`

### Why

Reject is the smallest safe overlap policy. Training-capture rules stay isolated to the Discord consent path.

### Consequences

Positive:
- Typed and spoken Ask share the same Core
- No accidental overlapping Jarvis turns from the lab mic

Negative:
- Speech during an in-flight answer is dropped until the turn finishes
- No wake word; user must click Mic

---

## ADR-012 — Interactive lab profile vs voice launcher; stream drafts, present finals

Date: 2026-08-19
Status: Accepted after JF-008B measurement

### Context

The JF-008 live mic turn spent 120.7s in Core while STT was 625ms. Direct Ollama showed a cold 27B load around 6.3s and warm short decode around 28–59 tok/s. Standalone lab was still inheriting voice-stack keep-alive/context defaults.

### Decision

- `JARVIS_STANDALONE=1` applies profile `interactive`: keep-alive 30m, default `num_ctx` 4096, no JaiTTS/RVC reservation. It does not raise or cap `LLM_GPU_LAYERS`.
- `start:local` stays `voice` with `LLM_VOICE_GPU_LAYERS` (default 48) and 10m keep-alive.
- Instrument one turn; omit stages that cannot be measured.
- Compact standalone prompts (no capability catalog dump, skip memory for arithmetic/`lab.ping`, keep safety/provenance).
- Stream Ollama tokens as Core drafts over NDJSON; run the Presentation Engine on the complete `suggestedContent` for the final payload. Drafts must not bypass presentation for the recorded result.
- Harden standalone VAD and ignore incomplete dangling-Thai transcripts without wake word; keep push-to-talk; do not persist conversational mic audio.

### Why

The 120s class delay was load/VRAM/long output, not a missing GPU-layer bump. Changing layers blindly would fight `start:local` coexistence. Streaming TTFT without restyling partial tokens avoids breaking immutable-fact presentation.

### Consequences

Positive:
- Warm short lab answers are sub-second to a few seconds on this 27B stack
- `/jarvis-lab` can show incremental Core text
- Voice launcher behavior is preserved

Negative:
- Changing `num_ctx` reloads a resident model (measured ~7s)
- Drafts are unpresented Core text until the final event
- 27B long answers still cost ~33 tok/s; research/tool calls may exceed the interactive target
- Qwen3-ASR + 27B together nearly fill 24 GB VRAM

---

## ADR-013 — Keep Qwen warm; speak after Presentation; no silent voice fallback

Date: 2026-08-19
Status: Accepted after JF-009 measurement

### Context

Adding standalone speech must not reintroduce the 6–7s Qwen cold/context reload. On this machine Qwen (~16.7 GB VRAM) + ASR already leave ~1.7 GB free. JaiTTS/RVC may already be resident from `start:local`; the lab must not start additional heavy models.

### Decision

- Core and the Presentation Engine stay TTS/RVC/GPU-allocator free.
- `VoiceOutputRouter.speak(text, profile, turn)` runs only when the lab sets `speak: true`.
- Jarvis native route is Edge-TTS with **no RVC**.
- Gam/Elemisu clone routes require standalone consent (`STANDALONE_CLONE_CONSENT`) plus speaker mapping plus already-resident RVC. Discord consents are not inherited.
- No silent fallback to another voice. `fallback` is true only when explicitly marked; the lab never auto-marks it.
- Resource policy: keep Qwen warm; keep ASR; JaiTTS only if already ready and the clone text is long enough; unload none. Do not start/stop ASR around speech.
- Typed Speak defaults off; mic answers auto-speak. Playback is browser `Audio()` on the default device (no `<select>`).

### Why

Measured warm native turn: Core 524 ms + Edge-TTS 1488 ms = client 2075 ms, GPU 23012 → 22944 MiB, Qwen still loaded. Evicting Qwen to free TTS VRAM would cost more than Edge-TTS itself.

### Consequences

Positive:
- Short spoken lab answers stay in the 2s class when Qwen is warm
- Clone unavailability is honest (persona unchanged when voice changes)

Negative:
- Clone live speech needs owner-set standalone consent and mapping
- Browser speaker-start latency was not measured in the API verify
- Free VRAM remains tight if JaiTTS/RVC are also resident

---

## ADR-014 — Night Agent is a separate development subsystem

Date: 2026-08-19
Status: Accepted for v1 (manual launch)

### Context

Unattended overnight coding must not give Jarvis conversation Core unrestricted filesystem/shell permissions, and the LLM must not own the outer loop.

### Decision

- Put the night worker in `src/agent/`, not `src/jarvis/`.
- A deterministic orchestrator owns queue, policy, attempts, acceptance tests, PASS/BLOCKED, escalation, and reports.
- Local Qwen is the v1 coding worker and may only execute tools through `NightToolHost`.
- Cloud/Cursor CLI is optional. v1 does not spawn `agent` unattended. Unavailable cloud does not stop independent tasks.
- Dirty primary worktrees refuse unattended coding. Worktrees are not auto-created. Auto-commit requires two flags and is off by default. Push is always denied.
- Windows Task Scheduler is out of v1.

### Verification

`tests/night_agent.test.ts` 13/13. DEV_NIGHT context benchmark and a temp-workspace Qwen dry run are recorded in `SESSION_STATE.md`.

---

## ADR-018 — JF-013 public web research is read-only evidence, never authority

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

Jarvis needs current public information with citations. An existing world-intel
MCP path is read-only but feed-specific. A second MCP client or a browser
agent would expand the attack surface (SSRF, POST, login, scheduled scraping).

### Decision

- Extend CapabilityHost with `research.*` on the same ActionGate. Keep
  `world-intel.*` and Discord `ResearchAssistant` as they are.
- Deterministic TypeScript enforces URL scheme, public destinations, redirects,
  size, timeout, and content type. The LLM may propose a query; it cannot pass
  method, headers, body, or cookies.
- Webpage text is untrusted data. Citations are immutable presentation facts.
- Research sessions live in `data/jarvis/research/research.db`, not `jarvis.db`.
- Research is user-invoked. Scheduled/recurring web fetch is rejected.
- Skills remain instruction/reference only.

### Alternatives considered

- Browser automation / Playwright — rejected; not public read-only research.
- Arbitrary URL + model-controlled headers — rejected; SSRF and credential risk.
- Auto-promote web claims into canonical memory — rejected; freshness and provenance.

### Consequences

- `WEB CONTENT IS DATA, NOT AUTHORITY`
- `PUBLIC WEB RESEARCH != BROWSER AUTOMATION`
- `CURRENT CLAIMS REQUIRE CURRENT EVIDENCE`

See `docs/JF013_SAFE_WEB_RESEARCH.md`.

---

## ADR-019 — JF-013.5 understanding intent is not granting permission

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

Natural Thai/English that missed narrow fast-path phrases fell through to
ordinary Qwen. The model then said it had no access, even when a registered
capability could have helped. The owner should not memorize command syntax.

### Decision

- Keep existing deterministic fast paths.
- If none match, run a bounded CapabilityResolver (heuristic, then optional
  compact catalog JSON) before ordinary conversation.
- The resolver may choose only registered, currently exposed capability ids.
- Schema validation, PermissionPolicy, and ActionGate remain the authority.
- Ambiguous, unsupported, unavailable, and forbidden are distinct.
- Short-lived interaction context supports follow-ups. It is not personal memory.
- Talking about a blocked tool is conversation. Requesting it stays blocked.

### Alternatives considered

- Weaken the system prompt to “always obey” — rejected; false success and
  policy bypass risk.
- Remove fast paths and always call 27B — rejected; exact commands must stay fast.
- Let the model set `allow` / confirmation — rejected; host policy only.

### Consequences

- `USER LANGUAGE != COMMAND SYNTAX`
- `UNDERSTANDING INTENT != GRANTING PERMISSION`
- `AMBIGUOUS != FORBIDDEN`
- `UNAVAILABLE != FORBIDDEN`
- `TALKING ABOUT AN ACTION != REQUESTING THE ACTION`

See `docs/JF013_5_INTENT_RESOLUTION.md`.

---

## ADR-020 — JF-014 local workspace intelligence is read-only evidence

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

The owner needs Jarvis to find and summarize approved project files in
natural Thai/English. Giving the model absolute paths, a shell, or write
access would break JF-010. Mixing the document index into canonical memory
would break the memory contract.

Historical `JF-014` in the first-tasks file still means CCTV. That item is
now `JF-014-CCTV`. This ADR is workspace intelligence.

### Decision

- Host-owned `WorkspaceRegistry` (`config/jarvis/workspaces.json`).
- Model authority is `workspaceId` / `documentId` / logical query.
- `PathPolicy` fail-closed: no `..`, UNC, ADS, drive switch, symlink escape.
- Dedicated `data/jarvis/workspace/workspace.db` with incremental FTS/symbol index.
- All `workspace.*` capabilities are READ_ONLY.
- Local file text is untrusted data. It cannot invoke tools or write memory.
- JF-013.5 maps natural phrasing; ambiguous file requests clarify.
- Local `documentRefs` stay distinct from web `sourceRefs`.

### Alternatives considered

- `workspace.readPath` with model-supplied absolute paths — rejected.
- Qdrant as the first search index — rejected; lexical/FTS first.
- Automatic memory promotion from documents — rejected; not JF-014.
- `workspace.openDocument` — skipped; `desktop.openProject` already exists.

### Consequences

- `LOCAL FILE CONTENT IS DATA, NOT AUTHORITY`
- `WORKSPACE ID != ARBITRARY FILESYSTEM PATH`
- `DOCUMENT INDEX != PERSONAL MEMORY`
- `READ ACCESS != WRITE ACCESS`

See `docs/JF014_SAFE_LOCAL_WORKSPACE.md`.

---

## ADR-017 — JF-012 reminders deliver notifications, never scheduled actions

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

Jarvis needs persistent Thai/English time-based reminders that survive restart.
A reminder scheduler can look like a general automation engine. That would
silently schedule shell, app launch, or CapabilityHost mutations.

### Decision

- Persist reminders in a dedicated operational SQLite file (`data/jarvis/automation.db`), not canonical memory (`jarvis.db`) and not Night Agent.
- The LLM may propose reminder intent. Deterministic TypeScript parses, validates timezone/recurrence/bounds, and mutates the store.
- Every schedule stores an explicit IANA timezone. Instants are UTC ISO. DST uses `Intl`.
- Bare hours without AM/PM/เช้า/เย็น are `AMBIGUOUS_TIME`. Past one-time times are `PAST_TIME`, never immediate fire.
- Capabilities (`reminders.*`) go through the existing ActionGate. Risk is `READ_ONLY` or `LOW_RISK_ACTION`. Forbidden keys include command, path, pid, shell, sql, cron, action, capability.
- The scheduler is one nearest-due timer in the Node runtime. Occurrence uniqueness is `reminderId + scheduledAt` claimed in `BEGIN IMMEDIATE`.
- Missed one-time within 15 minutes delivers once as `missed`. Older one-time expires. Recurring downtime skips the backlog and computes the next future run.
- Delivery is Command Center notification plus optional speech. TTS failure does not fail delivery. No Discord/email/cloud push.
- Stored reminder text is user data, never a new model instruction or executable action.
- Skills remain instruction/reference only. `TimeTrigger` exists as a type only.

### Alternatives considered

- Windows Task Scheduler / cron exposed to the model — rejected; opaque executable jobs.
- Store reminders as memory facts — rejected; operational instruction is not a personal fact.
- Browser `setTimeout` — rejected; closing the UI would cancel work.
- Fire every missed recurring occurrence after downtime — rejected; replay storms.

### Consequences

- `REMINDER TEXT IS DATA, NOT INSTRUCTION`
- `SCHEDULED REMINDER != SCHEDULED CAPABILITY EXECUTION`
- Future safe automation can attach ActionProposal + PermissionPolicy later. JF-012 does not.

See `docs/JF012_REMINDERS_SCHEDULER.md`.

---

## ADR-016 — JF-011 registered Jarvis services are not generic process control

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

Jarvis needs honest runtime/system status and a way to start or restart its
own local services (Ollama, ASR, TTS, RVC) without giving the LLM a process
API.

### Decision

- A code-owned `JarvisServiceRegistry` exposes only known service ids.
- The model may pass `serviceId` only. Command, path, PID, port, and argv are rejected.
- Stop/restart require JF-010 confirmation. Start is `LOW_RISK_ACTION`.
- Jarvis stops only children it spawned. Reused external processes return `NOT_OWNED`.
- Mutating localhost routes validate loopback Host, same-origin Origin/Referer, JSON, and a 16 KB body.
- Battery/network/app status degrade to `unavailable` rather than inventing values.
- Skills remain instruction/reference only and cannot add services.

### Consequences

- `REGISTERED JARVIS SERVICE != ARBITRARY PROCESS`
- `SERVICE ACTION != SHELL COMMAND`
- Optional voice-stack group actions were deferred; `ระบบเสียง` maps to `qwen-asr`.

See `docs/JF011_RUNTIME_SYSTEM_CAPABILITIES.md`.

---

## ADR-015 — JF-010 actions go through PermissionPolicy, never a conversational shell

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

Jarvis should open allowlisted local apps and report system status, but the
conversational LLM must not receive PowerShell, cmd, or arbitrary filesystem
access.

### Decision

- The model may propose intent or a registered capability id plus schema-valid arguments.
- `ActionGate` validates arguments, builds an `ActionProposal`, and asks `PermissionPolicy`.
- Execution uses a Windows adapter with `spawn(executable, argv, { shell: false })` and owner allowlists.
- `CONFIRM_REQUIRED` uses a one-use, expiring, proposal-bound token. No `confirmed: true` boolean.
- Skills remain instruction/reference only and cannot change risk or execute.
- Persona may rephrase summaries; it cannot change `ActionResult` status, capability, or permission.
- Action history is audit JSONL, not automatic personal memory.

### Alternatives considered

- Give Core a generic shell tool — rejected; fail-closed adapters only.
- Persistent always-allow grants — deferred; v1 is Deny / Allow once.

### Consequences

Positive:
- Useful local actions without a conversational OS.
- Confirmation and audit are deterministic.

Negative:
- App paths must be listed in `config/jarvis/applications.json`.
- No file edit, install, or browser automation in this task.

---

## ADR-021 — Security-first privilege leases and fail-closed private browser

Date: 2026-08-19
Status: Accepted for standalone v1

### Context

The owner directed a security-first continuation: host baseline, privilege
leases, official VirtualBox/Whonix, Playwright only inside Whonix, and no
BitLocker enablement. A later evolution/agent prompt must not skip these
dependencies.

### Decision

- Do not enable or modify BitLocker / Device Encryption.
- Do not weaken Defender, Firewall, Tamper Protection, HVCI, Secure Boot, or UAC.
- Privilege leases are owner-issued, short-lived, scoped, and cannot be
  self-approved, renewed, or expanded by Jarvis.
- `research.privateBrowse` requires a lease + confirmation and fails closed
  without a healthy Whonix route. No owner browser or host Playwright fallback.
- RETRIEVAL remains JF-013 GET research.
- Telemetry is real operations only, with secret redaction.
- Evolution primitives may record/reflect/version, but must not auto-promote
  or write production.

### Alternatives considered

- Enable BitLocker as a setup gate — rejected by owner.
- Disable Memory Integrity for faster VirtualBox — rejected.
- Host Playwright as PRIVATE_BROWSER fallback — rejected.

### Consequences

- Private browse is unavailable until VirtualBox/Whonix are installed and
  first-boot is owner-acknowledged.
- VirtualBox may be slower while VBS/HVCI stay on.

---

## ADR-022 — Fail-closed work agent and evolution stay simulated until owner live-QA

Date: 2026-08-20
Status: Accepted for standalone v1 cloud-safe layer

### Context

The Jarvis-first roadmap asked for JF-014.6 telemetry, JF-015 multi-step
work, EVO-001–010, and Command Center UX. Cloud agents cannot run Discord,
Ollama GPU, Whonix, mic, or CCTV.

### Decision

- Work-agent plans are acyclic DAGs with bounded retries, cancel, pause,
  and owner permission waits. Terminal state wins races.
- Evolution may record, reflect, and propose candidates. It must not
  auto-promote, write production, or treat failure as a trusted skill.
- LoRA remains a registry (`trained: false`) until an explicit training
  task.
- Affect can change style, never authorization.
- Owner autonomy 0–5: Jarvis cannot raise max or current autonomy.
- Vision `see` is not click/type/submit. Device VIEW is not CONTROL.
- Simulated Command Center demos must be tagged `simulated: true` and
  shown with a SIMULATION banner.
- SSE is real operations only, with seq replay and secret redaction.

### Alternatives considered

- Auto-promote passing candidates overnight — rejected.
- Live hardware tests in cloud — rejected; mark BLOCKED_LOCAL_ACCEPTANCE.
- Rewrite Discord or the Digital Me dashboard — rejected (Jarvis-first).

### Consequences

- Cloud verification is unit/offline only.
- Host live-QA remains required for SSE-in-browser, Ollama multi-step,
  Whonix, mic, screen capture, and CCTV.

---

## ADR-023 — Typed action effects, owner-only stop latch, and evidence-based model routing

Date: 2026-08-21
Status: Accepted for Core hardening; owner-machine acceptance pending

### Context

Trusted Operator components existed as UI contracts, while capability metadata
could describe only read/write and WorkAgent treated completed steps as verified.
Emergency Stop had no runtime endpoint. Current inference default was Qwen, but
Core needed a clean boundary before later Community Edition model selection.

### Decision

- Capability-authored typed effects drive deterministic destructive and
  mass-change preflight below the model. Unknown mutation requires review;
  destructive unknown scope is blocked.
- Emergency Stop is a restart-persistent execution latch. Owner/system may
  engage; only owner may resume. It blocks new autonomous work, invalidates
  pending confirmation, revokes/suspends temporary leases, and reports honest
  cancellation capability.
- Handler completion alone is partial/unverified. VERIFIED requires a registered
  postcondition. Rollback AVAILABLE requires recorded recovery state.
- Unexpected destructive failure or reported target-scope mismatch contains
  further related mutation; recovery is another privileged owner-reviewed action.
- Keep one model-profile registry separate from the existing adaptation-candidate
  registry. Model routing uses evidence-backed certification, not family name or
  model-card claims. Unknown metadata remains unknown.
- Do not build the Community installer, Hugging Face browser/downloader, hardware
  profiler, runtime installer, or GGUF picker in this phase.

### Consequences

- Trusted Operator UI can render real structured state without example values.
- Current Qwen/Ollama and Qwen ASR names remain because they describe the owner
  configuration and actual services, not because policy depends on Qwen.
- Typed handlers without AbortSignal remain honestly NOT_CANCELLABLE once
  running; new actions are still blocked immediately.
- Windows/browser/provider behavior remains BLOCKED_LOCAL_ACCEPTANCE.

See `docs/JARVIS_CORE_HARDENING_PRE_COMMUNITY.md`.

---

## ADR-024 — Cooperative cancellation and checkpoint-backed recovery stay below the model

Date: 2026-08-21
Status: Accepted for Core cloud hardening; owner-machine acceptance pending

### Context

WorkAgent owned an AbortController, but CapabilityHost dropped its signal and
timeouts abandoned only the caller. Rollback metadata could name a checkpoint,
but Core had no generic integrity-checked recovery store or complete acceptance
mutation. Emergency Stop therefore could not refine a running handler beyond a
request or unsupported state.

### Decision

- Propagate one runtime-owned AbortSignal from WorkAgent through ActionGate and
  CapabilityRegistry into the optional typed handler invocation context. Do not
  create a parallel cancellation authority.
- Distinguish OWNER_CANCEL, EMERGENCY_STOP, and TIMEOUT. A signal alone is not
  proof of cancellation; only a cooperative handler acknowledgement records
  `CANCELLED`.
- Keep non-cancellable handlers supported and honest. Record completion before
  cancel or failure to cancel, and never claim arbitrary OS process termination.
- Use a generic Jarvis-owned checkpoint inventory with SHA-256 integrity,
  bounded scope, expiry/state, and separate prior-state blobs. Reject secret-like
  checkpoint state and never store reusable approval credentials.
- Establish one deliberately disposable sandbox mutation as the complete
  acceptance slice. Deterministic verifiers re-read actual state; no LLM can
  mint `VERIFIED`.
- Treat rollback as a fresh typed, policy-checked, owner-authorized mutation.
  Mark it verified only after independently comparing restored state with the
  recorded prior digest. Consumed checkpoints make duplicate rollback safe.
- Persist minimal redacted containment for mutating timeout or unknown partial
  effect. Corrupt containment persistence fails closed.

### Consequences

- Cancellation, checkpoint, verification, rollback, and containment records can
  be shown by existing Trusted Operator UI without examples or fake success.
- Restart between checkpoint, commit, and verification can be reconciled through
  the persistent operation ledger and actual target digests.
- The new execution/recovery boundary imports no model family, provider, or
  tokenizer behavior. Model output remains unable to bypass policy or recovery.
- Windows/browser/process behavior remains `BLOCKED_LOCAL_ACCEPTANCE`.

See `docs/JARVIS_EXECUTION_RECOVERY_HARDENING.md`.

