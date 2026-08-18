# Cursor Task Queue

This backlog is intentionally conservative. Cursor should verify the repository before changing task status.

Statuses:
`READY`, `IN_PROGRESS`, `BLOCKED`, `IMPLEMENTED_NEEDS_LIVE_VERIFY`, `DONE`

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

## P7 — Future overnight local developer
Status: FUTURE

Do not implement before stable tests and task state exist.

See `NIGHT_AGENT_FUTURE.md`.

---

## P8 — Memory architecture + Jarvis UI addendum
Status: FUTURE until P0 baseline is recorded

Do not start these until `TASK-P0-001` and `TASK-P0-002` have honest results. Do not replace `SocialMemoryBrain` or the current dashboard.

Detailed queue: `MEMORY_UI_TASKS.md`  
Design: `JARVIS_MEMORY_ARCHITECTURE.md`, `JARVIS_UI_UX_VISION.md`  
Prompt: `CURSOR_MEMORY_UI_PROMPT.md`

Safe first pieces after baseline:

- `MEMORY-001` interfaces/schema — DONE
- `UI-001` isolated `/jarvis-lab` prototype with mocked states — not started; do not begin until asked

Keep `MEMORY-002+` and dashboard integration blocked until those are reviewed.

---

## P9 — Jarvis Core / presentation platform

Status: JARVIS-001 and JARVIS-002 DONE; later tasks READY

Detailed queue: `JARVIS_PLATFORM_TASKS.md`  
Design: `JARVIS_PLATFORM_ARCHITECTURE.md`, `PRESENTATION_ENGINE_SPEC.md`, `DISCORD_JARVIS_ADAPTER_SPEC.md`  
Prompt: `CURSOR_JARVIS_PLATFORM_PROMPT.md`

Safe completed pieces:

- `JARVIS-001` presentation-neutral request/result contracts — DONE
- `JARVIS-002` independent Brain/Persona/Voice profile + legacy `/voice` mapping — DONE

Do not start without review:

- `JARVIS-003` wrapping production `ResponseGenerator`
- `JARVIS-004` changing live `/voice` / `/persona` command behavior
- `MEMORY-002` SQLite dual-write
- dashboard redesign / `/jarvis-lab`

---

## Agent behavior when all READY tasks are exhausted

If remaining tasks are `BLOCKED` or require the owner:

1. do not invent inputs
2. improve tests/documentation only when clearly useful
3. write `SESSION_STATE.md`
4. create a concise list of owner-required actions
5. stop making speculative product changes
