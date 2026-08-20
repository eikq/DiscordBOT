# Jarvis-First Task Queue

This queue takes priority over Discord integration tasks.

## JF-001 — Finish Jarvis Core contracts
Status: DONE

Goal:
Turn the current contract work into a client-agnostic core boundary.

Inspect:
- current JARVIS-001/002/003 implementation
- LocalLlmProvider
- presentation wrapper
- memory contracts
- research gateway

Acceptance:
- Jarvis request/result types are transport-neutral
- no Discord type leaks into core
- existing tests remain green

Evidence:
- `src/jarvis/core/types.ts`, `src/jarvis/core/request.ts`
- `createJarvisRequest` defaults to `source: 'desktop'`
- `tests/jarvis_first.test.ts` asserts core/standalone files do not import Discord transport
- `npx tsx --test tests/jarvis_first.test.ts tests/jarvis_platform.test.ts` PASS 28/28; `npm run lint` PASS
- Discrepancy: working tree already had JARVIS-004/005 Discord adapters; those were kept and not expanded. `guildId` remains an optional opaque string on `JarvisClientContext`, not a Discord.js type.

## JF-002 — Create a standalone text harness
Depends on JF-001
Status: DONE

Goal:
Provide a simple non-Discord way to call Jarvis Core.

Possible form:
- CLI
- local API endpoint
- small developer page

Acceptance:
- submit text
- receive structured result and rendered text
- show tool/memory refs where available
- no Discord token required

This becomes the main development smoke path.

Evidence:
- `src/jarvis/standalone/LocalLlmJarvisCore.ts`, `textHarness.ts`
- CLI: `npm run jarvis:ask -- <text> [--persona id] [--voice id]`
- unit-tested with mocked LLM; not live Ollama verified
- no Discord token required

## JF-003 — Memory canonical-store implementation
Depends on MEMORY-001 design
Status: DONE

Goal:
Begin MEMORY-002 safely using SQLite as canonical Jarvis memory.

Rules:
- preserve existing JSON/JSONL memory
- no destructive migration
- prefer dual-write/adapter approach
- add migration/versioning
- provenance required
- tests first

Acceptance:
- create/read/update/supersede/forget tested
- restart persistence tested
- existing SocialMemoryBrain still works

Evidence:
- `SqliteJarvisMemoryStore` + numbered migrations (`001`, `002`)
- Canonical path: `data/jarvis/jarvis.db` (gitignored; tests use temp DBs only)
- SocialMemoryBrain JSON/JSONL remain authoritative; optional dual-write via constructor `canonicalStore`
- Discord `BotService` does not open SQLite
- `npx tsx --test tests/jarvis_sqlite_memory.test.ts tests/jarvis_memory.test.ts tests/jarvis_first.test.ts` PASS

## JF-004 — Generic memory retrieval service
Depends on JF-003
Status: DONE

Goal:
Give Jarvis Core one retrieval API.

Combine initially:
- structured filters
- lexical/FTS search
- existing memory projection

Qdrant can follow as a separate index step.

Acceptance:
- canonical IDs returned
- provenance retained
- tests include contradiction and supersession cases

Evidence:
- `src/jarvis/memory/retrieval.ts` (`JarvisMemoryRetrieval`)
- Structured filters + lexical FTS/LIKE fallback
- Qdrant not added
- Contradiction test: Friday superseded by Saturday, both retrievable by id

## JF-004B — Core Memory Integration
Depends on JF-004
Status: DONE

Goal:
Make standalone Jarvis Core consume compact canonical memory before Persona/Voice runtime.

Flow:
`JarvisRequest` → memory intent → `JarvisMemoryService` / `JarvisMemoryRetrieval` → bounded prompt context → Qwen/Core → structured result with `memoryRefs` / provenance.

Acceptance:
- Core depends on `JarvisMemoryService`, not SQLite
- LLM cannot query SQLite
- Retrieval is bounded (default 8, max 12); forgotten/expired excluded by default
- Active facts preferred; superseded history only when requested
- Memory is optional; failures degrade without inventing memory
- Presentation receives `memoryRefs` and does not retrieve

Evidence:
- `src/jarvis/memory/service.ts`, `intent.ts`; `LocalLlmJarvisCore` optional `memory`
- Structured `memoryRefs`: `canonicalId`, `type`, `confidence`, `sourceRefs`, plus `domain`/`status`
- Tests: `tests/jarvis_core_memory.test.ts` (temp DBs only)
- Seeded `architecture.memory_backend = SQLite` reaches Core `memoryRefs`; no LLM wording asserted
- Not live Ollama verified

## JF-004C — Canonical Memory Intelligence V2
Depends on JF-004 / JF-004B
Status: DONE (cloud-safe software). Not LIVE_VERIFIED.

Goal:
Improve memory quality, retrieval, contradiction handling, importance,
and safe learning without replacing SQLite.

Acceptance:
- SQLite remains canonical; vector index is derived-only; no Qdrant service started
- Record quality fields + ACTIVE/SUPERSEDED/FORGOTTEN/EXPIRED
- No silent overwrite; owner changes supersede
- Hybrid fusion drops orphan vector hits
- Query-aware class retrieval; bounded context; transparent scores
- Episode → candidate → validate; research is never owner-trusted
- Owner correction: จำอันนี้ / อันนี้ไม่ใช่ / เปลี่ยนเป็น / ลืมเรื่องนี้
- Optional Presenter provenance: "Jarvis remembered this because..."

Evidence:
- Schema `003_memory_intelligence_v2.sql`; `JARVIS_MEMORY_SCHEMA_VERSION = 3`
- `tests/jarvis_memory_v2.test.ts`
- `npx tsc --noEmit` PASS; `npm run test:cloud` **541/541**
- ADR-025

## JF-005 — Tool/Capability registry
Status: DONE

Goal:
Abstract Jarvis tools away from Discord and one MCP server.

Tool metadata should include:
- name
- input/output schema
- read/write side-effect class
- timeout
- required service
- untrusted-output flag

Adapt world-intel read-only tools behind this registry.

Acceptance:
- existing research tests stay green
- core can call a capability without importing MCP-specific implementation

Evidence:
- `src/jarvis/capabilities/types.ts`, `CapabilityRegistry.ts`, `worldIntel.ts`
- Core/standalone import `CapabilityHost` only; world-intel MCP stays behind `WorldIntelCapabilityPort`
- Read-only allowlist remains `DEFAULT_ALLOWED_TOOLS`; mutating tools such as `intel_aoi_delete` cannot be registered
- Untrusted wrapper and source URLs are preserved on capability results
- Targeted tests: `tests/jarvis_capabilities.test.ts`, `tests/research.test.ts`, `tests/jarvis_first.test.ts`
- Not live world-intel verified

## JF-006 — Standalone Jarvis UI shell
Depends on JF-001/JF-002
Status: DONE

Goal:
Build `/jarvis-lab` as a standalone Jarvis command center.

First version:
- text input
- rendered response
- core state
- model/service status
- tool activity
- memory evidence panel
- presentation profile selector

Do not require Discord connection.

3D core can remain mocked/optional initially.

Evidence:
- Isolated route: `src/main.tsx` renders `JarvisLabPage` only when pathname starts with `/jarvis-lab`
- Existing Digital Me dashboard (`src/App.tsx`) is unchanged
- Local APIs: `GET /api/jarvis/status`, `POST /api/jarvis/ask`, `POST /api/jarvis/presentation` (localhost-restricted)
- UI-R1–R8 command center: ribbon / memory rail / CSS/SVG core / tools rail / timeline / dock (`JARVIS_UI_REDESIGN_TASKS.md`)
- `createJarvisLabRuntime({ attachDefaultMemory: true })` on the server; tests pass `attachDefaultMemory: false` so they never open `data/jarvis/jarvis.db`
- Live lab UI verified 2026-08-19 on `:3010` with `JARVIS_STANDALONE=1`; not Discord; speech inactive

## JF-007 — Presentation profile runtime
Depends on current JARVIS-003 contracts
Status: DONE

Goal:
Use independent Persona and Voice in standalone Jarvis first.

Acceptance:
- Jarvis persona + Jarvis voice
- Jarvis persona + Gam voice
- Gam persona + Jarvis voice
- Gam persona + Gam voice
- persona cannot alter immutable facts
- no Discord command change required

Evidence:
- `StandalonePresentationSessions`, `/jarvis-lab` selectors, `POST /api/jarvis/presentation`
- Voice selection does not load persona memory; persona selection does not select an RVC model
- Speech is routed only when the lab asks with `speak: true` (JF-009)
- Tests: `tests/jarvis_presentation_runtime.test.ts`
- Discord slash/VC behavior unchanged

## JF-008 — Standalone microphone/STT input
Depends on JF-002
Status: DONE (unit-tested + live standalone mic verified 2026-08-19; not speech-output verified)

Goal:
Use Qwen3-ASR locally without Discord transport.

Acceptance:
- local microphone capture
- VAD/finalization
- STT text sent to Jarvis Core
- transcript visible in Jarvis UI
- no raw audio persisted by default

Evidence:
- `src/jarvis/audio/` (`SpeechTurnController`, `transcribeStandaloneUtterance`, `createSpeechJarvisRequest`) + `BrowserMicrophoneInput`
- Existing `LocalSTTProvider` / Qwen3-ASR `:8765`; `persistRejectedAudio: false`
- Overlap: reject while transcribing or Core is answering
- `/jarvis-lab` Mic enabled; typed Ask unchanged
- Tests: `tests/jarvis_standalone_stt.test.ts` (mocked audio/STT)
- Live: HyperX mic → ASR `Qwen/Qwen3-ASR-1.7B` (625ms) → Core Ollama `digital-me-qwen38:27b-ad-q4km` (120.7s) → Heard + response on `/jarvis-lab`
- Not JF-009 speech playback

## JF-008B — Standalone conversation latency & STT hardening
Depends on JF-008
Status: DONE (unit-tested + live typed-turn timings 2026-08-19; not a new mic LIVE_VERIFIED; not speech-output)

Goal:
Find where the ~120s JF-008 Core latency came from and reduce standalone conversational latency without changing models or adding TTS/RVC.

Acceptance:
- per-stage timings on one Jarvis turn (omit unmeasured stages)
- inspect Ollama load / VRAM / prompt / tok/s without blindly changing GPU layers
- `interactive` standalone profile (`JARVIS_STANDALONE=1`); preserve `start:local` voice cap
- compact relevant prompt context; keep safety/provenance/factuality
- stream drafts through Core if clean; Presentation Engine still owns the final text
- harden standalone VAD/incomplete-utterance handling; keep PTT; no fake partials; no raw conversational persistence
- live warm typed benchmarks (simple, memory, no-memory, lab.ping)

Evidence:
- Timings: `TurnTimings` + Ollama `prompt_eval`/`eval`/`load_duration`; `/jarvis-lab` ribbon + `POST /api/jarvis/ask-stream` NDJSON
- Profile: `applyJarvisInteractiveProfile()` in `server.ts` when `JARVIS_STANDALONE=1`; `scripts/start_local.ts` still `reserveGpuForLiveVoice`
- Prompt: short system + user + optional memory block + invoked tool summaries only; arithmetic/`lab.ping` skip memory retrieval
- Streaming: Ollama `stream: true` drafts are Core `suggestedContent`; final JSON is `engine.render`
- STT: `STANDALONE_VAD` + dangling-Thai incomplete filter; review-then-Ask; `persistRejectedAudio: false`
- Tests: `tests/jarvis_latency.test.ts` plus existing standalone STT/lab/core tests
- Live typed turns on `:3010` 2026-08-19 (see `SESSION_STATE.md`): warm 2+2 median ~0.38s; ctx-reload warmup 7.4s; 120.7s was not warm decode speed
- GPU layers unchanged (`LLM_GPU_LAYERS=999` in this lab; voice cap not applied)
- Not JF-009

## JF-009 — Standalone local speech output
Depends on JF-007
Status: DONE (unit-tested + live typed native Edge-TTS 2026-08-19; clone live speech not verified; browser speaker start not measured)

Goal:
Speak Jarvis responses locally without evicting warm Qwen.

Acceptance:
- default Jarvis voice path
- selectable consented clone voice
- voice/profile availability shown honestly
- no persona coupling
- cancellation supported where practical

Evidence:
- `src/jarvis/speech/` (`StandaloneVoiceRouter`, Edge-TTS native, optional resident JaiTTS/RVC for clones, `TurnGate`, `EnvCloneConsent`)
- Lab: Speak toggle (typed default off); mic answers auto-speak; `POST /api/jarvis/ask` `speak` + `/api/jarvis/speak/cancel`
- Resource policy: keep Qwen warm; do not start/stop ASR; do not auto-start JaiTTS/RVC; `unload: none`
- No silent fallback; clone needs `STANDALONE_CLONE_CONSENT` + speaker mapping + resident RVC
- Tests: `tests/jarvis_speech.test.ts`
- Live: typed Thai ask `speak=true` → Core 524 ms, Edge-TTS 1488 ms, client 2075 ms, Qwen stayed loaded (23012 → 22944 MiB). `gam` selected with Jarvis persona unchanged; clone speech unavailable (no standalone consent)
- Not HUMAN_QUALITY_VERIFIED; not browser `Audio()` start measured; Discord not started

## JF-010 — Permission/action policy
Status: IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (safe lab A–F). Not HUMAN_QUALITY_VERIFIED.

Goal:
Let standalone Jarvis run a small useful desktop action set without giving
the conversational LLM a shell.

Shipped:
- Risk classes: `READ_ONLY`, `LOW_RISK_ACTION`, `CONFIRM_REQUIRED`, `BLOCKED`
- `ActionGate` + `PermissionPolicy` + one-use confirmation tokens
- Capabilities: `desktop.openApplication`, `desktop.openProject`, `desktop.openTrustedUrl`, `system.status`
- Windows adapter: `spawn(executable, argv, { shell: false })`
- Allowlists: `config/jarvis/applications.json`, `projects.json`, `trusted-urls.json`
- Audit: `data/jarvis/audit/actions.jsonl`
- Command Center: Deny / Allow once + tool-activity action rows
- Docs: `docs/JF010_SAFE_ACTIONS.md`

Acceptance:
- core cannot bypass required approval
- action request/result logged
- tests cover denied/approved paths — `tests/jarvis_actions.test.ts` 28/28
- live lab A–F after Thai-intent fix: status, Notepad, Spotify unavailable, PowerShell denied, `javascript:` denied, HTTPS confirm + Allow once + reuse denied

See ADR-015.

## JF-011 — Runtime + system capability pack
Depends on JF-010
Status: IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (in-process A–J). Not HUMAN_QUALITY_VERIFIED.

Goal:
Make standalone Jarvis inspect this machine and manage only registered
Jarvis-owned services. No generic process control.

Shipped:
- Loopback mutation guard (Host / Origin / JSON / 16 KB / no token in query)
- Registry: `ollama`, `qwen-asr`, `jarvis-tts`, `rvc`, `embedding` (health), `jarvis-lab` (health)
- Read-only: `system.status`, `system.batteryStatus`, `system.networkStatus`, `applications.status`, `jarvis.runtimeStatus`, `jarvis.healthCheck`
- Actions: `jarvis.startService` (LOW_RISK), `jarvis.stopService` / `jarvis.restartService` (CONFIRM_REQUIRED)
- `desktop.openSettings` via `settingsId` allowlist
- Command Center uses real service snapshot + START/RESTART through the same ActionGate
- Docs: `docs/JF011_RUNTIME_SYSTEM_CAPABILITIES.md`, ADR-016

Acceptance:
- Tests: `tests/jarvis_runtime.test.ts` 22 + retained `tests/jarvis_actions.test.ts` 28/28
- Live: runtime/Qwen/ASR/battery/Chrome/settings/start-ollama/confirm-stop/denied chrome.exe+cmd.exe
- Skills cannot add services; `scriptsAllowed` still false

The older “JF-011 UI state-driven 3D core” item below was absorbed by UI-R9 and is not this pack.

## JF-011-UI — Jarvis UI state-driven 3D core (historical id)
Depends on JF-006
Status: SUPERSEDED by UI-R9 (command-center WebGL). Not this runtime pack.

Goal:
Connect the Fluctlight-inspired core to real Jarvis state.

States:
- IDLE
- LISTENING
- THINKING
- TOOL
- MEMORY
- SPEAKING
- ALERT
- DEGRADED

Acceptance:
- optional
- reduced-motion fallback
- minimal-GPU mode
- performance measured with local AI running

## JF-012 — Reminders + scheduler / automation kernel
Depends on JF-010 / JF-011
Status: IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (2026-08-19). Owner product sign-off still optional. Not the historical Qdrant item.

Goal:
Allow Jarvis to create, list, modify, cancel, recover, and deliver persistent
time-based reminders in Thai and English. Notification delivery only.

This is not a general unattended action engine and is not the historical
Qdrant item below.

Acceptance:
- one-time + simple daily/weekly recurrence
- Thai and English parsing, no silent guess on ambiguous hours
- explicit timezone; survive restart
- exactly-once fire; cancelled stays cancelled
- recurring downtime does not replay the backlog
- Command Center list + due card; TTS failure still delivers
- reminder text is data, not instruction or scheduled capability
- no automatic canonical memory facts
- JF-010/011 route/permission invariants remain

Evidence:
- `src/jarvis/automation/*`, `docs/JF012_REMINDERS_SCHEDULER.md`, ADR-017
- `tests/jarvis_reminders.test.ts`

The older “JF-012 Qdrant semantic memory index” item below is not this pack.

## JF-012-QDRANT — Qdrant semantic memory index (historical id)
Depends on JF-003/JF-004
Status: FUTURE

Goal:
Add semantic retrieval without changing canonical truth.

Acceptance:
- canonical SQLite IDs
- rebuildable index
- deletion/forgetting propagates to index
- retrieval quality evaluated

## JF-013 — Safe web research + source intelligence
Depends on JF-005 / JF-010
Status: IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (2026-08-19 public GET). Research Intelligence V2 (Queue 02): IMPLEMENTED + CLOUD_VERIFIED (unit). Live V2 quality and Whonix/Tor remain NEEDS_LOCAL_VERIFY / LOCAL_VERIFY_REQUIRED. Not a LIVE_VERIFIED upgrade of V2.

Goal:
Allow Jarvis to research current PUBLIC web information, inspect multiple
sources, keep provenance, and answer with citations.

This is read-only public web research. Not browser automation, login, POST,
or unattended monitoring.

Acceptance:
- multiple public sources + structured SourceRecord / EvidenceRecord
- official/primary preference; published vs fetched distinction
- conflicting sources remain visible
- citations survive presentation
- webpage text cannot become instruction or trigger actions/reminders/memory
- SSRF/private/redirect/credential URLs blocked
- no scheduled research; JF-012 stays notification-only
- JF-010/011/012 and JF-SKILLS-001 remain intact

Evidence:
- `src/jarvis/research/*`, `docs/JF013_SAFE_WEB_RESEARCH.md`, ADR-018
- `tests/jarvis_research.test.ts`

The older “JF-013 Proactive events / automation” item below is not this pack.

## JF-013.5 — Natural intent resolution + conversational recovery
Depends on JF-010 / JF-011 / JF-012 / JF-013
Status: IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (2026-08-19).

Goal:
Map natural Thai/English onto registered capabilities without weakening
CapabilityHost, ActionGate, PermissionPolicy, or allowlists.

Acceptance:
- owner does not need exact command phrases for common supported tasks
- ambiguous requests clarify; unsupported offers a safe existing alternative
- talking about a blocked tool is conversation; requesting it stays blocked
- no invented capability can execute; model allow/confirm is ignored
- JF-014 workspace/files not started at the time of JF-013.5 acceptance

Evidence:
- `src/jarvis/intent/*`, `docs/JF013_5_INTENT_RESOLUTION.md`, ADR-019
- `tests/jarvis_intent.test.ts`

## JF-014 — Safe local workspace intelligence
Depends on JF-010 / JF-011 / JF-012 / JF-013 / JF-013.5
Status: IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (in-process jarvis-project A–F, H, I; 2026-08-19).

Goal:
Read-only search/inspect/retrieve/compare/summarize of owner-approved local
files with document provenance. Natural phrasing via JF-013.5.

Acceptance:
- model never receives arbitrary filesystem paths
- sensitive / traversal / UNC / ADS / symlink escape fail closed
- document content cannot become authority or write memory
- no owner-document write/delete/rename
- document index ≠ personal memory
- local vs web refs stay distinct

Evidence:
- `src/jarvis/workspace/*`, `config/jarvis/workspaces.json`
- `docs/JF014_SAFE_LOCAL_WORKSPACE.md`, ADR-020
- `tests/jarvis_workspace.test.ts`

The older “JF-014 CCTV event integration” item below is not this pack.

## JF-014.5 — Capability security + privilege leases
Depends on JF-010 / JF-013 / JF-014
Status: IMPLEMENTED + UNIT_VERIFIED (2026-08-19). LIVE_TESTED not claimed for Whonix.

Goal:
Keep the model from equaling execution. Typed capabilities only. Short-lived
owner-issued privilege leases. No generic shell.

Evidence:
- `src/jarvis/security/*`, `docs/JARVIS_PRIVILEGE_MODEL.md`, ADR-021
- `tests/jarvis_security.test.ts`

## JF-014.55A — VirtualBox + Whonix provisioning
Depends on JF-014.5 / host security
Status: IMPLEMENTED import + isolation (2026-08-19). VBox `7.2.16r174877`. Official OVA SHA512 + OpenPGP good signature. First-boot guest legal/security acknowledgement is OWNER_ACTION_REQUIRED. LIVE_TESTED Tor not claimed.

## JF-014.55B — Private browser worker
Depends on JF-014.55A
Status: IMPLEMENTED policy + worker package; PRIVATE_BROWSER fail-closed until live Tor. Guest Node/Playwright not installed. LIVE_TESTED not claimed.

## JF-014.55C — Safe deep research engine
Depends on JF-013 / JF-014.55B
Status: IMPLEMENTED depth planner + injection/SSRF tests. Live DEEP private browse not available.

## JF-014.6 — Realtime operations telemetry
Depends on JF-014.5
Status: IMPLEMENTED + UNIT_VERIFIED (`JarvisEventBus` seq/id, bounded buffer, SSE `id:` + `after=`/`Last-Event-ID` replay, heartbeat comments, visual states). `/jarvis-lab` EventSource wired. Browser SSE live-QA **BLOCKED_LOCAL_ACCEPTANCE**.

## JF-015 — Multi-step work agent
Depends on JF-014.5 / JF-014.55*
Status: INTEGRATED + UNIT_VERIFIED. `/api/jarvis/ask` now routes CONVERSATION/INFORMATION vs RESEARCH/WORK/CAPABILITY. Agentic routes use WorkAgent → CapabilityHost. ActionGate grants resume the same step with a scoped lease (no self-approve, no token reuse). Live Ollama/hardware execution **BLOCKED_LOCAL_ACCEPTANCE**.

## EVO-001–010 — Evolution runtime (fail-closed)
Depends on JF-015
Status: INTEGRATED + UNIT_VERIFIED + Queue 04 Procedural Skills V2 (CLOUD_VERIFIED unit pending suite). One experience per task (`exp_task_<id>`). Canonical SQLite episodes are written with provenance; research text stays untrusted. Night cycle includes BENCHMARK, persists reflections, and proposes success-only DRAFT skill candidates. Isolated benchmarks may move a candidate to REVIEW_REQUIRED. Only owner-trusted skills are auto-selected. No autonomous production writes. Failure cannot mint trusted skills. Candidates never auto-promote. Jarvis cannot self-approve. LoRA is registry-only (`trained: false`). Affect cannot authorize. Night cycle pauses on `realtime_voice`. Live night/Ollama **BLOCKED_LOCAL_ACCEPTANCE**.

## JF-016 / JF-017 / JF-018 — Vision, monitor, devices
Depends on JF-015
Status: IMPLEMENTED + UNIT_VERIFIED architecture (simulated vision fixtures, proactive monitor, VIEW-only devices, owner autonomy 0–5). Live screen capture / CCTV / host sensors **BLOCKED_LOCAL_ACCEPTANCE**.

## JF-013-PROACTIVE — Proactive events / automation (historical id)
Depends on permissions/tools/memory
Status: FUTURE

Goal:
Allow Jarvis to react to scheduled/system events safely.

Do not begin with external destructive actions.

## JF-014-CCTV — CCTV event integration (historical id JF-014)
Depends on Jarvis event/action framework
Status: FUTURE

Goal:
Feed structured CCTV events into Jarvis.

Not a prerequisite for Jarvis Core v1 unless owner chooses.

## JF-019 — Presentation Mode + desktop presence
Depends on JF-009 / JF-010 / UI-R9
Status: IMPLEMENTED + CLOUD_VERIFIED (unit). Live: LA-026 PARTIAL; LA-027 PARTIAL — NATIVE_SHELL_REQUIRED. ADR-023 Phase 1 contracts scaffolded; helper not installed. Queue 01 complete on `cursor/jarvis-cloud-evolution-2026-08-20`. Cloud: `CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.

Goal:
Present rich results in the existing `/jarvis-lab` command center and report honest desktop/window presence. Jarvis may only move its own window.

Evidence:
- `src/jarvis/presentation/briefing/` pipeline (plain | rich | briefing)
- `src/jarvis/desktop/` capabilities through ActionGate
- Presenter camera + briefing panel on `/jarvis-lab`
- Tests: `tests/jarvis_presentation_briefing.test.ts`, `tests/jarvis_desktop_presence.test.ts`, `tests/jarvis_presenter_desktop_cloud.test.ts`

## DEFERRED — Discord integration

Do not actively develop until Jarvis v1 gate is met:

- JARVIS-004 Discord runtime decoupling
- JARVIS-005 DiscordJarvisAdapter migration
- Discord natural-language presentation switching
- Discord shared-memory integration
- Discord live tool/research routing
