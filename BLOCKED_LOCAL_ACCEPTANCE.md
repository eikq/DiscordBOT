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

## LA-002 Command Center browser / SSE visual QA

- Purpose: Owner visual acceptance of `/jarvis-lab` as the observability surface.
- Preconditions: local dashboard; browser; reduced-motion check; EventSource
  supported.
- Exact verification: load `/jarvis-lab`; confirm SSE reconnect + replay;
  run a real task; confirm DAG, permission wait, empty Fluctlight when no data,
  SIMULATION labels on demos; no hidden chain-of-thought.
- Expected: UI matches real records. Demos stay labeled SIMULATION.
- Failure evidence: screenshots, EventSource console, `/api/jarvis/events`
  after= cursor, `present()` JSON.

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
