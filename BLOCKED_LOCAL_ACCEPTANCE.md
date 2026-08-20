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

- Status: **LIVE_VERIFIED** 2026-08-20 ~19:02 ICT on `local/jarvis-acceptance-2026-08-20`
  after a schema fix so WorkAgent `researchDepth` is a legal `research.search` argument.
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
- Live evidence (standalone lab `http://127.0.0.1:3010`, `JARVIS_STANDALONE=1`,
  session `la001-acceptance`, model `digital-me-qwen38:27b-ad-q4km`, Ollama 0.32.14):
  1. `hello` → route `CONVERSATION` / SPEAK / `agentic:false`.
     `requestId=jarvis-1787226985067`. No `taskId`. Trace `tr_ba10607df519`.
     Reply: “Hello! How can I help you today?” ~9612ms, 10 tokens.
  2. `explain recursion` → route `INFORMATION`. `requestId=jarvis-1787227003970`.
     No `taskId`. Trace `tr_dd8a20d15f1f`. Real recursion explanation. ~4572ms, 137 tokens.
     Note: `intent.kind` stayed `CONVERSATION` while the ask router used `INFORMATION`.
  3. First research attempt failed: `INVALID_ARGUMENT` because ActionGate allowed
     `depth` on `research.current` but not `research.search` while WorkAgent injected
     owner `researchDepth=standard`. Task `task_f8ffa0146aa6` FAILED. After allowing
     `depth` on `research.search` and restarting the lab: `requestId=jarvis-1787227331469`,
     `taskId=task_b74988aeabe5`, WorkAgent → CapabilityHost `research.search` ok,
     6 real public URLs (github.com/QwenLM, arxiv.org, qwen.ai, qwen.readthedocs.io).
     Citations were not invented. Trace `tr_b84bed3e1b18` `verification=success`.
     work.db: COMPLETED, `simulated=0`, plan understand/research.search/verify/reflect.
  4. `สถานะระบบ` → route `CAPABILITY`, bound `system.status`, ActionGate completed.
     `requestId=jarvis-1787227114017`. No WorkAgent. Trace `tr_2c64ea49cbfa`.
     Host metrics included NVIDIA GeForce RTX 5090 Laptop GPU. ~226–268ms.
- Traces: 5 rows in `data/jarvis/runtime/ops.db`. No CoT / scratchpad / secrets /
  confirmation-token keys. Analyzer: `INSUFFICIENT_DATA` (need ≥3 samples per route).
  Research traces omit `requestId` (task traces do not copy it). Capability traces
  currently store an empty `capabilities` array.

## LA-002 Command Center browser / SSE visual QA

- Status: still **BLOCKED_LOCAL_ACCEPTANCE** for owner sign-off and live DAG
  visibility. Agent browser QA ran 2026-08-20; **not OWNER_VERIFIED**.
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
- Remaining before LIVE_VERIFIED:
  1. Live operations DAG is only rendered while `snapshot.task` is active.
     Completed WorkAgent tasks disappear immediately (“No multi-step work task”).
     80ms polling during a cached research ask never observed `task.steps`.
  2. Command Center `lastRequest` is only set on WorkAgent runs, so after a
     dock `hello` the ops panel can still say `Route RESEARCH · agentic`.
  3. Open operations panel intercepts the dock Ask button.
  4. Permission-wait UI was not exercised.
  5. Owner visual sign-off (LA-013) is separate.

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

---

## Cloud-prepared but not live

- ScreenCaptureProvider / VisionAnalyzer / VisualContext / SensitiveRegionPolicy
- ProactiveMonitor cooldown + quiet hours
- Device VIEW/CONTROL/CONFIGURE/ADMIN split
- PRIVATE_BROWSER fail-closed host policy
- Night cycle resource pause hooks
- ActionGate confirmation store (in-memory; restart requires re-confirm)
