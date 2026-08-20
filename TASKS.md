# Cursor Task Queue

This backlog is intentionally conservative. Cursor should verify the repository before changing task status.

Statuses:
`READY`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED_NEEDS_LIVE_VERIFY`, `DONE`

Current priority: standalone Jarvis first (`JARVIS_FIRST_TASKS.md`). Discord feature work is deferred until Jarvis Core v1.

---

## P0 — Jarvis-first standalone core

- `JF-001` transport-neutral Core contracts — DONE (unit-tested)
- `JF-002` standalone text harness (`npm run jarvis:ask`) — DONE (unit-tested; not live Ollama verified)
- `JF-003` / MEMORY-002 canonical SQLite store — DONE (unit-tested; temp DBs only; not live user-data migrated)
- `JF-004` generic memory retrieval — DONE (unit-tested; no Qdrant)
- `JF-004B` Core consumes `JarvisMemoryService` — DONE (unit-tested; temp DBs only)
- `JF-004C` Canonical Memory Intelligence V2 — DONE (unit-tested + cloud 541/541; SQLite remains canonical; Qdrant not started; not live owner-memory verified)
- `JF-005` generic capability registry + world-intel adapter — DONE (unit-tested; not live world-intel verified)
- `JF-006` isolated `/jarvis-lab` shell — DONE (unit-tested; command-center UI UI-R1–R8 live-verified 2026-08-19)
- `JF-007` standalone presentation profile runtime — DONE (unit-tested; speech not active)
- `UI-R1`–`UI-R8` `/jarvis-lab` command center — DONE (CSS/SVG; live lab UI verified)
- `JF-008` standalone microphone/STT — DONE (unit-tested + live lab mic verified 2026-08-19; not speech-output)
- `JF-008B` standalone conversation latency + STT hardening — DONE (unit-tested + live typed-turn timings 2026-08-19)
- `JF-009` standalone local speech — DONE (unit-tested + live typed native Edge-TTS 2026-08-19; clone live speech not verified; browser speaker start not measured)
- `JF-010` permission/action policy — IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (safe lab A–F). Owner product sign-off still optional.
- `JF-011` runtime + system capability pack — IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (in-process A–J; stop/restart confirmed-only, ollama not stopped). Owner product sign-off still optional.
- `JF-012` reminders + scheduler — IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (in-process A–G + lab HTTP/UI; 45–70s real timers). Owner product sign-off still optional.
- `JF-013` safe web research — IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (lab HTTP + public sources + SSRF). Research Intelligence V2 (Queue 02): IMPLEMENTED + CLOUD_VERIFIED (unit). Live V2 quality / Whonix remain NEEDS_LOCAL_VERIFY / LOCAL_VERIFY_REQUIRED. Owner product sign-off still optional. Historical “proactive events” id is `JF-013-PROACTIVE`.
- `JF-013.5` natural intent resolution + conversational recovery — IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (in-process A–J). Owner product sign-off still optional.
- `JF-014` safe local workspace intelligence — IMPLEMENTED + UNIT_VERIFIED + LIVE_VERIFIED (in-process jarvis-project search/symbol/retrieve/compare; HTTP Command Center not separately live-QA'd this turn). Historical CCTV id is `JF-014-CCTV`. Owner product sign-off still optional.
- `JF-014.6` realtime operations telemetry — IMPLEMENTED + UNIT_VERIFIED (SSE replay + lab EventSource). Browser SSE live-QA **BLOCKED_LOCAL_ACCEPTANCE**.
- `JF-015` multi-step work agent — IMPLEMENTED + UNIT_VERIFIED (DAG + simulated demos). Live Ollama/tool runs **BLOCKED_LOCAL_ACCEPTANCE**.
- `EVO-001`–`EVO-010` evolution runtime — IMPLEMENTED + UNIT_VERIFIED fail-closed. Queue 04 Procedural Skills V2: reviewable candidates, trusted-only retrieval, no self-approval, no auto-promote. Live night cycle **BLOCKED_LOCAL_ACCEPTANCE**.
- `JF-016`/`JF-017`/`JF-018` vision / monitor / devices — IMPLEMENTED + UNIT_VERIFIED simulated architecture. Live capture/CCTV **BLOCKED_LOCAL_ACCEPTANCE**.
- Next READY after this layer: owner product sign-off, browser Command Center QA, or a later write-boundary / open-document task. No generic process/shell, no scheduled CapabilityHost execution, no unattended web monitoring, no Qdrant-as-canonical.
- Still blocked: live Qdrant / MEMORY-003 as a running index; Discord JARVIS-006+; rewriting the Digital Me dashboard; UI-R9 WebGL until asked

---

## P0 — Protect and understand the current project

### TASK-P0-001 — Audit current working tree
Status: DONE

Goal:
Capture the exact current repository state without changing it.

Actions:

- run `git status`
- list modified/untracked files
- inspect diffs relevant to Qwen3.8/research integration
- detect unrelated local files
- compare against `PROJECT_CONTEXT.md`

Acceptance:

- `SESSION_STATE.md` records the real current state
- no files are reverted/deleted
- contradictions are listed

---

### TASK-P0-002 — Establish non-live baseline
Status: DONE

Goal:
Determine what passes without Discord credentials or live hardware.

Suggested checks:

- lint
- TypeScript tests
- production build
- relevant Python syntax/tests
- research unit tests

Do not blindly run expensive model downloads or live startup if environment prerequisites are unknown.

Acceptance:

- commands run are recorded
- pass/fail is honest
- failures are categorized:
  - code regression
  - missing optional dependency
  - unavailable local model/service
  - requires secret/live environment

---

### TASK-P0-003 — Stabilize Qwen3.8 / research working-tree integration
Status: DONE

Goal:
Make the current uncommitted/current implementation internally consistent.

Verify:

- package scripts
- setup scripts
- current Ollama model name
- MCP executable lookup
- read-only allowlist behavior
- tool-output sanitization
- source ledger
- upstream failure handling
- dashboard `/research` API path
- Discord `/research` path
- tests

Acceptance:

- targeted tests pass
- no mutating research tool is reachable
- missing world-intel produces an explicit degraded state
- no fake citations
- no automatic voice research is added

---

## P1 — Runtime resource understanding

### TASK-P1-001 — Add explicit runtime-profile documentation
Status: READY

Goal:
Document resource intent for voice vs future night-development use.

Create/maintain configuration documentation for:

- `VOICE_INTERACTIVE`
- `RESEARCH`
- future `DEV_NIGHT`

Do not change production defaults aggressively until measured.

Acceptance:

- all relevant environment variables are documented
- unsafe combinations are called out
- current launcher behavior remains intact

---

### TASK-P1-002 — Improve optional-service status reporting
Status: READY after P0 baseline

Goal:
Make the dashboard/doctor distinguish:
`UP`, `OFFLINE`, `NOT_CONFIGURED`, `FAILED`.

Candidates:

- embeddings `:8767`
- world-intel MCP runtime
- Ollama
- JaiTTS
- RVC
- STT

Acceptance:

- UI/doctor does not imply an offline fallback is the real model
- no live test claim is fabricated

---

## P2 — Live Discord verification
Status: BLOCKED until owner provides/runs live environment

### TASK-P2-001 — Live Discord basic session
Acceptance:

- real login
- slash registration
- join/leave
- real STT transcript
- playback
- barge-in
- observed result recorded

This task requires owner participation. Do not fake it.

---

## P3 — Consented voice clone verification
Status: BLOCKED until owner explicitly performs consented live test

### TASK-P3-001 — Full consent → training → playback test
Acceptance:

- explicit consent
- capture target verified
- sufficient accepted audio
- frozen version
- model produced
- `/voice` / `/speak` works
- human listening result recorded

---

## P4 — Research live verification
Status: READY only if local world-intel runtime is available

### TASK-P4-001 — Current-feed smoke with citation validation
Goal:
Run real research query and inspect all returned source URLs.

Acceptance:

- tools return real current data or clear failure
- sources are real URLs
- answer does not invent unavailable data

---

## P5 — Jarvis design prep

### TASK-P5-001 — Create Jarvis module contract document
Status: READY after current baseline is stable

Goal:
Design interfaces without implementing broad rewrites.

Define:

- event envelope
- perception event
- tool request/result
- permission request/result
- memory retrieval result
- alert event

Acceptance:

- interfaces are implementation-neutral
- Discord remains usable without Jarvis extensions
- no circular dependency into core voice path

---

## P6 — CCTV MVP
Status: BLOCKED until camera/NVR connection information is available

### TASK-P6-001 — Single-camera ingest
Goal:
Read one authorized home CCTV stream locally.

Acceptance:

- configurable RTSP/ONVIF source
- credentials only in local env/config ignored by Git
- reconnect handling
- no cloud upload by default
- test with a non-secret sample stream when possible

### TASK-P6-002 — Detection + tracking + zone
Depends on: P6-001

Acceptance:

- person/vehicle detection
- stable track IDs across frames where possible
- configurable front-area polygon
- event emitted only from zone logic

### TASK-P6-003 — Event history + anomaly rules
Depends on: P6-002

Acceptance:

- store timestamp, counts, dwell, track/event metadata
- rule examples are configurable
- no criminal-intent inference
- event query API supports later Jarvis integration

---

## P7 — Overnight local developer
Status: NIGHT-BUILD-001–009 IMPLEMENTED (manual launch only). NIGHT-BUILD-010/011 FUTURE.

See `NIGHT_AGENT_DIRECTIVE.md`, `NIGHT_AGENT_IMPLEMENTATION_TASKS.md`, `SESSION_STATE.md`.
Do not install Windows Task Scheduler until the owner asks.

---

## P8 — Memory architecture + Jarvis UI addendum
Status: FUTURE until P0 baseline is recorded

Do not start these until `TASK-P0-001` and `TASK-P0-002` have honest results. Do not replace `SocialMemoryBrain` or the current dashboard.

Detailed queue: `MEMORY_UI_TASKS.md`  
Design: `JARVIS_MEMORY_ARCHITECTURE.md`, `JARVIS_UI_UX_VISION.md`  
Prompt: `CURSOR_MEMORY_UI_PROMPT.md`

Safe first pieces after baseline:

- `MEMORY-001` interfaces/schema — DONE
- `MEMORY-002` / `JF-003` SQLite adapter — DONE (optional dual-write; JSON/JSONL still live)
- `JF-004B` Core memory integration — DONE
- `JF-006` isolated `/jarvis-lab` shell — DONE (command-center UI; Digital Me dashboard unchanged)
- `UI-R1`–`UI-R8` CSS/SVG command center — DONE (live lab UI verified 2026-08-19)
- `UI-001` / `UI-R9` WebGL/3D core — not started; keep 2D fallback if ever started

Keep `MEMORY-003+` (live Qdrant service / Qdrant-as-canonical) blocked.
Canonical Memory Intelligence V2 (JF-004C) adds hybrid *fusion when
semantic hits are supplied*, query-aware classes, candidates, and owner
correction. SQLite stays canonical. Do not start Qdrant from Cloud.

---

## P9 — Jarvis Core / presentation platform

Status: JARVIS-001 through JARVIS-005 implemented and unit-tested; further Discord work DEFERRED by Jarvis-first addendum. Next Discord item JARVIS-006 is not started.

Detailed queue: `JARVIS_PLATFORM_TASKS.md`  
Design: `JARVIS_PLATFORM_ARCHITECTURE.md`, `PRESENTATION_ENGINE_SPEC.md`, `DISCORD_JARVIS_ADAPTER_SPEC.md`  
Prompt: `CURSOR_JARVIS_PLATFORM_PROMPT.md`

Safe completed pieces:

- `JARVIS-001` presentation-neutral request/result contracts — DONE
- `JARVIS-002` independent Brain/Persona/Voice profile + legacy `/voice` mapping — DONE
- `JARVIS-003` wrap `ResponseGenerator` behind PresentationEngine — DONE
- `JARVIS-004` independent `selectVoice` / `selectPersona`; live `/voice` and `/persona` still set both — DONE (unit-tested)
- `JARVIS-005` `DiscordJarvisAdapter` after SocialBrain, Unavailable Core falls back to `generate()` — DONE (unit-tested)
- Presentation briefing + desktop presence layer (2026-08-20) — implemented on `/jarvis-lab` Presenter Mode. Live: LA-026 PARTIAL, LA-027 PARTIAL — NATIVE_SHELL_REQUIRED. Cloud pass: structured facts, TTS narration, repeat/back, intersection matching, native-helper mocks. Helper not installed. Handoff: `CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.

Do not start without review:

- `JARVIS-006` InvocationResolver (Discord; deferred)
- Digital Me dashboard rewrite (isolated `/jarvis-lab` command center exists; not a dashboard replacement)
- `UI-R9` WebGL core until the owner asks
- Discord speech / JARVIS-006 until Jarvis Core v1 review

---

## Agent behavior when all READY tasks are exhausted

If remaining tasks are `BLOCKED` or require the owner:

1. do not invent inputs
2. improve tests/documentation only when clearly useful
3. write `SESSION_STATE.md`
4. create a concise list of owner-required actions
5. stop making speculative product changes
