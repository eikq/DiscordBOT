# BLOCKED_LOCAL_ACCEPTANCE

Authoritative local-machine queue for work that Cursor Cloud cannot complete.
Cloud may prepare interfaces, diagnostics, UI states, and fail-closed mocks only.

Labels: **BLOCKED_LOCAL_ACCEPTANCE**. Do not mark these LIVE_VERIFIED until the owner
runs them on the physical Windows machine.

Recommended order: LA-001 → LA-002 → LA-008 → LA-003 → LA-004 → LA-005 →
LA-006 → LA-007 → LA-009 → LA-010 → LA-011 → LA-012 → LA-013 → LA-014 →
LA-015 → LA-017 → LA-018 → LA-019 → LA-020 → LA-021 → LA-022 → LA-016 →
LA-023 → LA-024 → LA-025.

---

## LA-001 Ollama / Qwen real task path

- Status: **PARTIAL** (owner 2026-08-20). Do **not** mark LIVE_VERIFIED.
  Agent-browser evidence below remains valid history under Simulation OFF, but
  remaining requirements are not closed. Not OWNER_VERIFIED.
- Purpose: Prove a normal `/api/jarvis/ask` turn uses local Qwen for conversation
  and informational routes, and that agentic routes still invoke CapabilityHost.
- Preconditions: Ollama reachable; `digital-me-qwen38:27b-ad-q4km` (or current
  `.env` model) pulled; dashboard on loopback; no Discord required.
- Exact verification:
  1. `hello` → conversation, no WorkAgent DAG.
  2. `explain recursion` → informational LLM reply, no work.db task.
  3. `research the latest Qwen documentation` → WorkAgent research path.
  4. A bound capability such as `สถานะระบบ` still uses ActionGate, not a greeting path.
- Expected: replies are model-generated; Command Center shows the real route;
  no fabricated citations.
- Failure evidence: Ollama probe, `/api/jarvis` status, requestId, route JSON,
  work.db task row if any.
- Simulation-off evidence (session `la001-simoff`, lab `http://127.0.0.1:3010`,
  `JARVIS_STANDALONE=1`, Ollama 0.32.14, model `digital-me-qwen38:27b-ad-q4km`,
  profile `local-env-llm`, engine `interactive`). Control before this pass:
  `simulationMode=true`. Owner POST `/api/jarvis/command-center/control`
  `{simulationMode:false}` → HTTP 200, afterward `simulationMode=false`.
  Browser ops panel showed no `SIMULATION — events are tagged` banner; Simulation
  mode checkbox was not `checked`.
  1. `hello` **PASS**. Route `CONVERSATION` / SPEAK / `agentic:false`.
     `requestId=jarvis-1787230170393`. `taskId=null`. No WorkAgent. Real Ollama:
     `timings.llmMs=1106`, 10 tokens, 29.6 tok/s. Trace `tr_b5230b91992c`
     `simulated` absent/false. Reply: “Hello! How can I help you today?”
  2. `explain recursion` **PASS**. Route `INFORMATION` / SPEAK / `agentic:false`.
     `requestId=jarvis-1787230171517`. `taskId=null`. Real Ollama: `totalMs=5567`,
     142 tokens, 27.6 tok/s. Trace `tr_20119f66b18c`. Recursion explanation, no DAG.
  3. Uncached research **PASS**. Query included unique marker
     `LA001-UNCACHED-2026-08-20-1787232948618`. Route `RESEARCH` / agentic.
     `requestId=jarvis-1787232959132`. WorkAgent `taskId=task_693bb3aeb0ae`
     COMPLETED, work.db `simulated=0`, `cached=false`. `research.search` invoked
     the live configured provider. Six real URLs (github.com/QwenLM, qwen.ai,
     openlm.ai, qwen15.readthedocs.io, releasebot.io). Marked untrusted.
     Trace `tr_4430cb02f901` keeps the same `requestId`, capability
     `{id:research.search,status:ok,risk:READ_ONLY}`, `verification=success`.
     Earlier same-day cached research (`task_94c449be1d57`, `cached=true`) is
     historical only and does not close this item.
  4. `สถานะระบบ` **PASS**. Route `CAPABILITY`. `requestId=jarvis-1787232970933`.
     `taskId=null`. Action `system.status` `status=ok` `risk=READ_ONLY`.
     Trace `tr_003c467ced03` records that capability. Telemetry on the earlier
     sim-off pass: CPU 23.6% / 24 cores, RAM 56.5%, Disk 1498 GB free, GPU
     NVIDIA GeForce RTX 5090 Laptop GPU 25%.
- Close-pass hello after tokens-keep fix: `requestId=jarvis-1787233596801`,
  trace `tr_acc97921764e` `tokens=10`, no CoT / scratchpad / confirmToken /
  `.env` / credentials. Usage `tokens` is kept; confirmation tokens stay redacted.
- Ask JSON still does not include `llm.model` (model id is on `/api/jarvis/status`
  and `modelProfileId`).
- Earlier same-day turns (session `la001-acceptance`) remain historical evidence
  of the `research.search` `depth` schema fix; they are not this close pack.
- Remaining for LIVE_VERIFIED: owner-accepted remaining product checks, including
  `llm.model` on the ask payload if that is still required.

## LA-002 Command Center browser / SSE visual QA

- Status: **PARTIAL** (owner 2026-08-20). Do **not** mark LIVE_VERIFIED.
  Agent-browser SSE/DAG/permission evidence below remains valid history under
  Simulation OFF. Not OWNER_VERIFIED (owner visual sign-off remains LA-013).
- Purpose: Owner visual acceptance of `/jarvis-lab` as the observability surface.
- Preconditions: local dashboard; browser; reduced-motion check; EventSource
  supported.
- Exact verification: load `/jarvis-lab`; confirm SSE reconnect + replay;
  run a real task; confirm DAG, permission wait, empty Fluctlight when no data,
  SIMULATION labels on demos; no hidden chain-of-thought.
- Expected: UI matches real records. Demos stay labeled SIMULATION.
- Failure evidence: screenshots, EventSource console, `/api/jarvis/events`
  after= cursor, `present()` JSON.
- Agent browser evidence (`http://127.0.0.1:3010/jarvis-lab`, Cursor browser, not
  owner Chrome profile):
  - Ribbon: LOCAL host, QWEN `digital-me-qwen38:27b-ad-q4km`, MEMORY v2, TOOLS 54.
  - Dock `hello` reply “Hello! How can I help you today?” with
    `Route CONVERSATION · SPEAK`. No work-task DAG for that turn.
  - Research demo shows `SIMULATION — not live hardware` and device rows
    `SIMULATION · VIEW only`. Simulation mode was then set back to false.
  - Intelligence: traces count, `spec_baseline_v1`, analyzer
    `INSUFFICIENT_DATA`, RESTRICTED uncensored has no security authority,
    certification still fixture-only, auto-promote denied.
  - Memory rail after hello: “No canonical memory attached to this turn.”
    Graph 4 nodes / 1 edge. No hidden reasoning text.
  - SSE: browser EventSource `/api/jarvis/events?stream=1` connected then
    reconnected (performance entries 8ms then 6713ms). HTTP replay
    `?stream=1&after=0` returned seq 1–20. Client `seq <= lastSeq` drop path
    exists in `JarvisLabPage.tsx`.
- Simulation-off SSE evidence (same lab, after seq 51):
  - Live delivery: stream `?stream=1&after=51` received seq **52–61**,
    `simulated=true` count **0**.
  - Replay: `?stream=1&after=0` returned seq **1–51** before the asks.
  - Reconnect/replay after cursor: second `after=51` returned the same 52–61 set;
    concatenating the two copies dropped seqs `<= lastSeq` (**10 duplicates
    suppressed**). Browser EventSource connected to `/api/jarvis/events?stream=1`.
    A reconnect with `after=61` (current head) delivered **0** historical events
    (empty replay, no duplicates of 1–61).
  - After sim-off turns, Intelligence “Last route CAPABILITY · สถานะระบบ”.
    Device rows remain fixture `SIMULATION · VIEW only`.
- Close-pass agent browser (same lab, Simulation OFF):
  - Newest request is a single `noteLatestRequest` writer. Sequence RESEARCH →
    CONVERSATION → INFORMATION → CAPABILITY updated Live Operations each time.
    After tokens-fix reload: `Route CONVERSATION · SPEAK · conversation ·
    jarvis-1787233596801` and Intelligence `Last route CONVERSATION · hello`.
  - Completed DAG stays inspectable as **Last task** (not live). After grant:
    `Last task · COMPLETED · task_f2fe0ec67647` with steps, taskId, verification.
    After uncached research the live DAG was visible while executing, then Last
    task `task_693bb3aeb0ae`. `recentTasks` is bounded to 5.
  - Permission wait on safe `desktop.openTrustedUrl`: UI showed taskId, stepId,
    capability, `CONFIRM_REQUIRED`, proposalId, URL, Grant once / Cancel.
    A+B+D on `task_4ebf6826844b`: no approval does not execute; wrong token
    HTTP 400 `INVALID_TOKEN`; cancel → CANCELLED. C on `task_f2fe0ec67647`:
    Grant once resumed the same step and executed once.
  - SSE UI: live update without refresh while the tab is visible; refresh
    restores lastRequest + Last task from the API/`work.db`; EventSource
    reconnects on `onerror` and after hidden-tab pause; `acceptSseSeq` drops
    `seq <= lastSeq`. No duplicate visible event rows observed. Console: no
    errors (THREE.Clock deprecation warn only). Hidden-tab pause of SSE + 5s
    poll is product behavior — a hidden Cursor tab will not live-update until
    shown or reloaded.
  - REAL vs SIMULATION remains honest: simulationMode=false; demos stay labeled
    SIMULATION; device fixtures stay `SIMULATION · VIEW only`.
- Remaining: owner visual sign-off (LA-013). Open operations panel still
  intercepts the dock Ask button; that is not an LA-002 closer.

## LA-003 Whonix Gateway health

- Purpose: Confirm Gateway VM is up and isolated.
- Preconditions: Official Whonix LXQt Gateway imported; VirtualBox 7.2.x;
  start Gateway alone first.
- Exact verification: `VBoxManage showvminfo`; health snapshot
  `virtualBox/gateway=up`, `isolationOk=true`.
- Expected: Gateway desktop reachable; clipboard/DnD/USB remain off.
- Failure evidence: VBox logs, NIC dump, health JSON.

## LA-004 Whonix Workstation / Tor routing

- Purpose: Confirm Workstation uses Whonix internal NIC only and Tor works.
- Preconditions: Gateway already healthy; start Workstation second.
- Exact verification: Workstation NIC is Internal `Whonix` only; live Tor check
  from the documented health path.
- Expected: `tor=up` only after a real Tor check. Never invent it.
- Failure evidence: NIC machinereadable dump, Tor check stdout, health JSON.

## LA-005 Private Playwright browser

- Purpose: PRIVATE_BROWSER live path through Whonix.
- Preconditions: LA-003/004 pass; Playwright worker only in Workstation.
- Exact verification: lab `/api/jarvis/private-research` stays fail-closed on
  host; guest worker fetch of a public page; no host Chrome/Edge.
- Expected: `available=true` only when Tor + worker are live.
- Failure evidence: `reasonCode`, route health, worker log. Host must stay
  fail-closed if Workstation is down.

## LA-006 Discord text / voice integration

- Purpose: Existing Digital Me Discord path still compiles and behaves.
- Preconditions: owner `.env` token; consent rules unchanged.
- Exact verification: text reply; voice join; IGNORE / REACT / SPEAK timing;
  no new Discord features required.
- Expected: SocialBrain decisions unchanged; no evolution record per message.
- Failure evidence: bot logs, decision traces, no raw audio unless consented.

## LA-007 microphone / STT / TTS / RVC

- Purpose: Standalone lab mic + JF-009 speech + consented clone.
- Preconditions: Qwen3-ASR, JaiTTS/Edge-TTS, RVC services; `RECORD_RAW_AUDIO=false`.
- Exact verification: lab mic transcript; typed Speak default off; clone only
  with standalone consent + mapping.
- Expected: Core stays TTS-free; clone not represented as the real person.
- Failure evidence: STT probe, speech router result, consent store (no WAVs
  committed).

## LA-008 resource priority under voice load

- Purpose: REALTIME_VOICE > OWNER_TASK > BACKGROUND_EVOLUTION.
- Preconditions: voice session active; night cycle eligible.
- Exact verification: start voice; trigger night; night pauses with
  `pausedFor=realtime_voice`; owner task still runs.
- Expected: no night/benchmark steal of GPU during live voice.
- Failure evidence: night report, resource policy snapshot, GPU notes.

## LA-009 real screen capture

- Purpose: JF-016 SEE ≠ CLICK ≠ TYPE ≠ SUBMIT on the owner PC.
- Preconditions: owner screen-capture permission; SensitiveRegionPolicy on.
- Exact verification: capture one window; analyze; attempt click without
  permission must fail.
- Expected: cloud fixtures remain SIMULATION; live capture labeled REAL.
- Failure evidence: permission state, provider health, redacted telemetry.

## LA-010 proactive Windows monitoring

- Purpose: JF-017 real signals with cooldown and quiet hours.
- Preconditions: owner enables proactive alerts; not during quiet hours unless
  critical.
- Exact verification: inject a real warning; confirm notify once; repeat within
  cooldown → ignore.
- Expected: no spam; simulated fixtures stay labeled SIMULATION.
- Failure evidence: monitor decisions, timestamps, preference snapshot.

## LA-011 CCTV provider

- Purpose: JF-018 VIEW must never imply CONTROL/CONFIGURE/ADMIN.
- Preconditions: owner camera credentials stay local; not committed.
- Exact verification: list devices; VIEW works; CONTROL/CONFIGURE denied
  without a separate grant.
- Expected: offline camera is UNAVAILABLE, not fabricated frames.
- Failure evidence: device capability matrix, health, error codes.

## LA-012 phone / device provider

- Purpose: PC / phone / sensor / smart-device contracts on real hardware.
- Preconditions: owner device pairing; VIEW/CONTROL split.
- Exact verification: status VIEW; a CONTROL action requires permission.
- Expected: missing hardware = UNAVAILABLE/BLOCKED, never silent success.
- Failure evidence: provider health, capability class, audit row.

## LA-013 owner visual / UI sign-off

- Purpose: Human acceptance of Command Center + Fluctlight honesty.
- Preconditions: LA-001 and LA-002 done; at least one real task and one empty
  profile.
- Exact verification: owner reviews conversation vs agentic routes, permission
  wait, evolution graph (no decorative edges), SIMULATION vs REAL labels.
- Expected: owner accepts or files specific UI defects. Not claimed by cloud.
- Failure evidence: owner notes, screenshots, rejected states.

## LA-014 local model discovery

- Purpose: Discover installed Ollama/Qwen models without claiming unverified abilities.
- Preconditions: local Ollama; no Discord required.
- Exact verification: list model ids, size, quantization; map to ModelProfileRegistry
  (`local-env-llm`, `qwen38-27b-aligned`, optional `qwen38-27b-uncensored`).
- Expected: unlisted models stay `unverified`. RESTRICTED uncensored never gains
  `securityAuthority`.
- Failure evidence: `ollama list`, profile JSON, trust tier.

## LA-015 aligned Qwen3.8 27B benchmark

- Purpose: Live chat/tool quality for the aligned local Qwen3.8 27B profile.
- Preconditions: LA-014; `digital-me-qwen38:27b-ad-q4km` (or current `.env` model).
- Exact verification: run CapabilityCertificationBank categories against the real
  model (not cloud fixtures).
- Expected: `lastLocallyVerified` set only after owner review. Cloud remains
  FIXTURE_ONLY.
- Failure evidence: cert run JSON, Ollama logs, tokens/sec.

## LA-016 optional RESTRICTED uncensored Qwen benchmark

- Purpose: Optional specialist benchmark for an abliterated/uncensored Qwen.
- Preconditions: Owner opts in; model pulled locally.
- Exact verification: profile stays RESTRICTED; cannot authorize, grant leases,
  or change trust policy. Router must not auto-select it.
- Expected: specialist-only. No security authority.
- Failure evidence: route decision JSON, permission audit.

## LA-017 model capability certification (live)

- Purpose: Certify chat, Thai, structured output, tool calling, multi-step tools,
  coding, research, context retention, vision, recovery on real hardware.
- Preconditions: LA-015. Vision/hardware categories may stay unavailable.
- Exact verification: each category records pass/fail with fixtures + live calls.
  Unavailable hardware → skip, not invented pass.
- Expected: CERTIFIED only for measured categories.
- Failure evidence: certification run, skipped reasons.

## LA-018 context retention benchmark

- Purpose: Measure whether the local model keeps prior-turn facts inside the
  configured context window.
- Preconditions: LA-015; known contextTokens.
- Exact verification: two-turn fixture with a unique Thai+English token.
- Expected: retained or explicit miss. Do not claim retention from cloud fixtures.
- Failure evidence: prompts (redacted), window size, reply.

## LA-019 Thai / Windows IME benchmark

- Purpose: Real Windows IME + combining marks through dashboard, lab, and CLI.
- Preconditions: Windows host; Thai keyboard.
- Exact verification: type `น้ํา` / tone marks into `/jarvis-lab`, `/api/jarvis/ask`,
  `npm run jarvis:ask`. Compare code points to the cloud fixture
  `THAI_COMBINING_FIXTURE`.
- Expected: no NFC folding that hides combining-mark bugs unless the owner
  accepts NFC. Cloud tests are not a substitute.
- Failure evidence: code-point dumps, screenshots.

## LA-020 tokens/sec and latency p50/p95

- Purpose: Record measured generation speed and latency percentiles.
- Preconditions: LA-015; several real turns (n≥5 for p50/p95).
- Exact verification: TraceAnalyzer + efficiency snapshot from live traces.
  INSUFFICIENT_DATA if n is too small.
- Expected: no fabricated tok/s. Hardware RAM/VRAM only if probed.
- Failure evidence: ops.db traces, efficiency JSON.

## LA-021 RAM / VRAM / CPU / GPU probes

- Purpose: Attach measured resource fields to efficiency traces.
- Preconditions: local GPU tooling the owner already uses.
- Exact verification: probe before/after a Qwen turn; write only measured numbers.
- Expected: omitted fields stay omitted. Cloud must not invent them.
- Failure evidence: probe output, ops.db.

## LA-022 hardware-aware model routing

- Purpose: Casual vs deep vs coding vs voice vs idle night routing using
  certified evidence.
- Preconditions: LA-014–017; optional second local model.
- Exact verification: voice load does not select the stronger night model;
  idle=true required for night_background stronger routing; RESTRICTED never
  auto-selected.
- Expected: deterministic policy, no speculative scores.
- Failure evidence: route decisions, hardware.idle, cert status.

## LA-023 optional MoneyPrinterTurbo provider review

- Purpose: Evaluate MoneyPrinterTurbo as a **local optional** media provider.
- Preconditions: Owner installs nothing until this review. Do not vendor it.
- Exact verification: contract fit vs SimulatedMediaProvider stages; license;
  network; no auto-publish.
- Expected: keep `installed: false` until an explicit local install task.
- Failure evidence: review notes. Cloud simulator stays the default.

## LA-024 real artifact video pipeline

- Purpose: Produce a real video artifact and validate it.
- Preconditions: local provider (native or reviewed MoneyPrinterTurbo).
- Exact verification: TOPIC→…→DELIVER; artifact path exists; mime/size;
  ARTIFACT READY ↛ publish without owner + ActionGate.
- Expected: simulated cloud artifacts stay labeled SIMULATION.
- Failure evidence: output manifest, validation, ActionGate audit.

## LA-025 Thai IME + Command Center live traces

- Purpose: Confirm Command Center Intelligence panel shows real traces, spec,
  certs, efficiency, and artifact tasks without hidden reasoning.
- Preconditions: LA-002 + at least one live ask.
- Exact verification: empty analyzer shows INSUFFICIENT_DATA; live traces show
  requestId/route only; no chain-of-thought.
- Expected: owner visual check. Cloud unit tests are not live QA.
- Failure evidence: screenshots, present() JSON.

## LA-026 Presenter Mode briefing on `/jarvis-lab`

- Status: **PARTIAL** 2026-08-20 local live pass. Not LIVE_VERIFIED.
  Cloud 2026-08-20 pass implemented structured diagnostic cards, sequential
  narration, TTS-driven `spokenAtMs`, and Repeat/Back as presenter-local
  seeks (CLOUD_VERIFIED unit). Live speech↔segment motion remains
  NEEDS_LOCAL_VERIFY. First live pack was contaminated by leftover research
  until the isolation fix at `8aba6b0` (preserved).
- Purpose: Prove rich results render as a Presenter briefing with spoken
  summary, focus cues, follow-ups, and reduced-motion behavior. Do not start
  LA-003+ (Whonix / private browser) for this item.
- Preconditions: local dashboard on loopback; optional Speak toggle; a
  research or system-status turn that the planner marks rich/briefing.
- Exact verification:
  1. Presenter Mode basic rendering: after a research/comparison/report turn,
     click **Presenter** or **Open briefing**. Executive summary, cards,
     evidence, limits, and follow-up chips appear. Greetings stay lightweight.
  2. Spoken summary: with Speak on, TTS uses `spokenSummary`, not the raw
     full answer. Typed Speak stays default off.
  3. Focus/highlight motion: section/card focus cues advance with segment
     timing. No fake data animations or invented citations.
  4. Reduced-motion: `prefers-reduced-motion: reduce` skips pulse/zoom and
     uses instant/no animation. Core hidden-tab pause still applies.
- Expected: no chain-of-thought / scratchpad / confirm tokens in the panel
  or traces. Presentation never invokes tools.
- Failure evidence: `/api/jarvis/ask` JSON `briefing`, screenshots, Speak
  payload text.
- 2026-08-20 live notes (Simulation OFF, lab `http://127.0.0.1:3010`):
  - After research isolation: `สถานะระบบ` is `rich`/`report` titled
    **System status** from real `system.status` telemetry (RTX 5090 Laptop).
    Browser Presenter `requestId=jarvis-1787236162758`. `hello` stays plain.
  - Research briefing (first pack, still valid as research):
    `requestId=jarvis-1787235774621`, untrusted public URLs, comparison mode
    because ≥2 sources. Comparison-without-the-word-`research` stays
    CONVERSATION.
  - Real TTS: Edge-TTS (`sourceEngine=edge`). Speak uses `spokenSummary`
    only. Earlier timed speak: `sourceTtsMs=3006`, `totalMs=3009`. Section
    segments are not spoken sequentially. `scaleNarrationToSpeech` is unused.
  - Follow-ups: Explain / Expand / Shorten mutate the React model and do
    not start WorkAgent. Repeat / Go back are no-ops.
  - Reduced motion: `prefers-reduced-motion: reduce` →
    `jcc-presenter is-reduced`; executive summary still readable with static
    focus.

## LA-027 Desktop presence and Jarvis-window move

- Status: **PARTIAL — NATIVE_SHELL_REQUIRED** 2026-08-20. Display
  enumeration is real after raising capability timeouts. Cloud 2026-08-20
  pass implemented intersection matching (gap → `UNKNOWN_DISPLAY`) and
  native-helper contracts/mocks (CLOUD_VERIFIED unit). Browser host cannot
  own/move the Chrome/Edge HWND. Helper is not installed. Window movement
  is **not** LIVE_VERIFIED. Classification: `BROWSER_HOST_LIMITATION`.
- Purpose: Honest multi-monitor awareness and Jarvis-window-only movement.
- Preconditions: Windows host; `/jarvis-lab` open; optional
  `config/jarvis/displays.json` copied from `displays.example.json` for
  owner-named notebook/external labels. Native helper or Electron adapter
  required to actually move the window. The Express + React dashboard cannot
  move Chrome/Edge.
- Exact verification:
  1. Display enumeration: `desktop.listDisplays` or “มีกี่จอ” lists attached
     screens or returns `UNSUPPORTED_HOST` / empty honestly.
  2. Identify current display: `desktop.getJarvisWindow` after the lab POST
     `/api/jarvis/presence` reports which display the tab bounds sit on.
  3. Move Jarvis window to another display: confirm
     `desktop.moveJarvisWindow`. Browser host must report
     `UNSUPPORTED_HOST` (not a fake success). Native helper may report
     `moved`.
  4. Restore to original display: `desktop.setJarvisLayout` `restore` after a
     successful native move, or honest `WINDOW_UNAVAILABLE`.
  5. Presenter mode on the second monitor: layout `presenter` + external
     selector. Browser host fail-closed; native helper may place the Jarvis
     window on that display.
- Expected: other apps are never targeted. `hwnd` / `processName` /
  `windowTitle` rejected. Confirm tokens never persist to work.db/ops.db.
- Failure evidence: capability JSON `reasonCode`, presence status
  `canMoveWindow`, confirmation prompt.
- 2026-08-20 live notes:
  - `config/jarvis/displays.json` does **not** exist. Do not invent
    “notebook”. Example file IDs (`DISPLAY1`/`DISPLAY2`) do **not** match
    this machine (`DISPLAY1` + primary `DISPLAY5`).
  - Standalone `Screen.AllScreens`: `\\.\DISPLAY1` 1920×1200 at x=-3840
    (not primary); `\\.\DISPLAY5` 1920×1080 at 0,0 (primary). Scale factor
    not exposed by this API.
  - After raising list/get timeouts to 18s / write to 20s:
    `มีกี่จอ` presented **“2 displays visible.”** (~5.9s);
    `ตอนนี้นายอยู่จอไหน` presented **“Jarvis lab is on DISPLAY5
    (client-report).”** Presence bounds were `x=-1920,y=-3,1920×1152`.
    The window left edge sits on a gap; `displayContaining` falls back to
    **primary**, so DISPLAY5 can be a false match.
  - Presence: `hostKind=browser`, `canMoveWindow=false`. UI:
    “browser host cannot move this tab.”
  - Move/focus are ActionGate `CONFIRM_REQUIRED` and Jarvis-window-only.
    Grant-after-move `task_8e8dee98a123` FAILED (fail-closed; earlier empty
    enum). Focus wait `task_3fab64116c52` cancelled. No other-app HWND hunt.

---

## Cloud-prepared but not live

- ScreenCaptureProvider / VisionAnalyzer / VisualContext / SensitiveRegionPolicy
- ProactiveMonitor cooldown + quiet hours
- Device VIEW/CONTROL/CONFIGURE/ADMIN split
- PRIVATE_BROWSER fail-closed host policy
- Night cycle resource pause hooks
- ActionGate confirmation store (in-memory; restart requires re-confirm)
