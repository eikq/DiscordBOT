# Cursor Session State

Updated: 2026-08-20
Agent/model: Cursor Grok 4.6

## This turn — Queue 12 Final Cloud Audit and Physical-Machine Handoff

Labels: IMPLEMENTED (handoff docs). Not LIVE_VERIFIED.
No new architecture. Cloud feature queues stop here.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `dbe1c6b0e4be54384d0dae9d2cf9d55ea495d104`
Evidence: `npx tsc --noEmit` PASS; `npm run test:cloud` **633/633**.
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
Handoff: `CURSOR_LOCAL_ACCEPTANCE_NEXT.md`.
ADR: ADR-034.

Cloud can no longer verify Windows displays, native HWND, Ollama/GPU,
mic/STT/TTS/RVC, Discord, Whonix/Tor, cameras, or phones. Remaining
work is classified; exact host tests are in the handoff document.
Native helper is not installed. Build/install only after owner approval.

Do not merge. Do not mark LIVE_VERIFIED. Do not start Queue 13+.
STOP after this queue.

## Previous — Queue 11 Full-System Cloud Integration Pass

Labels: IMPLEMENTED + CLOUD_VERIFIED (unit). Not LIVE_VERIFIED.
Do not claim live Tor, native helper, camera, mic, STT, TTS, or GPU.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `47a1f6ca15e734c53c2f1d395e59868c97b64e1d`
Implementation: `3768a1d25f0dd4b75e618bdeedc805ba99dcba50`
TurnId test fix: `0d2bdd835182ed8346bdb52e8fb2626169d999f7`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-033.
Evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_cloud_integration.test.ts` +
`tests/jarvis_local_acceptance.test.ts` + `tests/jarvis_ops.test.ts`
**30/30**; `npm run test:cloud` **633/633**.

Fourteen offline/simulated fixtures cover conversation, research,
diagnostics, WorkAgent permission, Presenter, memory, skills, mock
voice interruption, simulated perception, Night review, missing native
helper, and restricted-model non-selection. Default `turnId` is not a
copy of `requestId`. Distinct failure codes are not collapsed.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 10 Security Hardening Pass

Labels: IMPLEMENTED + UNIT_VERIFIED. Not LIVE_VERIFIED.
Do not claim live Tor, native helper, or host-browser verification.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `935b01bfe3d36eb6ba1819140c8d203470e13f51`
Implementation: `a3487504f652aab4ffb30b3a3456c323781b4690`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-032.
Evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_security_hardening.test.ts` plus existing security /
skills / memory / perception / presenter tests **127/127**;
`npm run test:cloud` **614/614**.

LLM output is not execution. Untrusted research/web/model/vision cannot
approve privilege, plant owner-trusted memory, or mint TRUSTED skills.
SSRF policy now catches IPv4-mapped IPv6 after Node canonicalization.
Native helper IPC fails closed on forged/replayed/impersonated requests.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 09 Command Center V2 unified operational interface

Labels: IMPLEMENTED + UNIT_VERIFIED. Not LIVE_VERIFIED.
No live `/jarvis-lab` visual sign-off. Native helper is not installed.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `85a87694a0478a13f90b3a686ddbd7b850898c22`
Implementation: `3c6f5ce19e92cbfa129404ca45d6b6b5a691670e`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-031.
Evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_command_center_v2.test.ts` plus lab-ui / briefing /
command-center / lab-scene tests green. Full `npm run test:cloud`
deferred while later Cloud follow-ups are queued.

Presentation-only mode shell (Assistant, Presenter, Operations, Memory,
Intelligence, Devices). No CommandCenterRuntime rewrite. Global
REAL/SIMULATION/DEGRADED/OFFLINE. Simulation is never live hardware.
Owner corrections go through Ask. Intelligence uses INSUFFICIENT_DATA
when evidence is absent.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 08 Proactive Runtime + Scheduler + Night Agent V2

Labels: IMPLEMENTED + UNIT_VERIFIED. Not LIVE_VERIFIED.
No live GPU / timer / unattended Night coding claims.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `4b123835e3ad078c25be743da861ec3a66d032ed`
Implementation: `c6c22ef0de4c51368d2759e73eea59d5a8268d32`
Feat: `95a60584071a735fba016702ce3e4c5f2be384c1`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-030.
Evidence: `npx tsc --noEmit` PASS;
`tests/jarvis_proactive_runtime.test.ts` **9/9**. Full
`npm run test:cloud` deferred while later Cloud follow-ups are queued.

Three existing schedulers only (reminders, NightCycle, ProactiveMonitor).
ProactiveRuntime is a coordinator, not a fourth scheduler. Background
Night yields to higher resource priority. Notices cannot auto-act.
`autoPromoted: false`. Mutating apply is not blindly retried.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 07 Perception, Screen, CCTV and Device Architecture

Labels: IMPLEMENTED + UNIT_VERIFIED. Not LIVE_VERIFIED.
No live camera or device claims.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `4593b351d6a1a778ed915eeca05b994ed8312a2e`
Implementation: `8d3753cdb20c1f101084bce4fb6ec7671c6d0404`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-029.
Evidence: `npx tsc --noEmit` PASS;
`tests/jarvis_perception.test.ts` **8/8**. Full `npm run test:cloud`
deferred while later Cloud follow-ups are queued.

SEE != CLICK. VIEW != CONTROL. CONTROL != ADMIN. Vision output is
untrusted. Anomaly pipeline never auto-acts physically.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 06 Realtime Voice Interaction Architecture

Labels: IMPLEMENTED + UNIT_VERIFIED. Not LIVE_VERIFIED.
Do not claim microphone / STT / TTS / RVC live verification.
SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `f63b51898778c7732ead37279babfb81d7675de3`
Implementation: `7d3a69008bff41947105c516b16ba7d74d5987c4`
Feat: `b8e4f4a9ae00feecfac913e1fa8612cd15e7c549`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-028.
Evidence: `npx tsc --noEmit` PASS;
`tests/jarvis_realtime_voice.test.ts` **13/13**. Full
`npm run test:cloud` deferred while later Cloud follow-ups are queued.

NightCycle on Command Center now pauses for `realtime_voice`. Mutating
WorkAgent apply is not cancelled by barge-in. Persona remains
independent from voice.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 05 Model Registry, Certification, Routing and Efficiency

Labels: IMPLEMENTED + CLOUD_VERIFIED (unit). Not LIVE_VERIFIED.
RESTRICTED models are never auto-selected and never security authorities.
Cloud certification is FIXTURE_ONLY. No model downloads. No live hardware
benchmarks. SQLite remains canonical. Qdrant is not started.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `d0f333660a40c6f828778bf21cb5a9927d399aad`
Implementation: `e38f27281841dc8938eeaf07890a8617d396b6c0`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-027.
Evidence: `npx tsc --noEmit` PASS; `tests/jarvis_models_v2.test.ts` +
`tests/jarvis_research_addendum.test.ts` 20/20; `npm run test:cloud`
**562/562**.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 04 Safe Evolution + Procedural Skills V2

Labels: IMPLEMENTED + CLOUD_VERIFIED (unit). Not LIVE_VERIFIED.
SQLite remains canonical. Qdrant is not started.
`autoPromote=false`. Jarvis cannot self-approve skill trust.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `9175ef5c4c65ec8aab7e0f0d5a40c0280e55c26b`
Implementation: `866e843e935dcd99fb02ecf60952e78002e832da`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
ADR: ADR-026.
Evidence: `npx tsc --noEmit` PASS; `tests/jarvis_skills_v2.test.ts`
green with related evolution tests; `npm run test:cloud` **553/553**.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 03 Canonical Memory Intelligence V2

Labels: IMPLEMENTED + CLOUD_VERIFIED (unit). Not LIVE_VERIFIED.
SQLite remains canonical. Qdrant is not started and is not a source of
truth. Research/web claims are not owner-trusted memory.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `7b8b19dd08f3fc8db350c116a7c598fdd443bf47`
Implementation: `b7b9e49dc6c637fef4ea847d39254bd8693b55f2`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
Evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_memory_v2.test.ts` + sqlite/core memory tests green;
`npm run test:cloud` **541/541**.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.


Labels: IMPLEMENTED + CLOUD_VERIFIED (unit). Not LIVE_VERIFIED.
SQLite remains canonical. Qdrant is not started and is not a source of
truth. Research/web claims are not owner-trusted memory.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `7b8b19dd08f3fc8db350c116a7c598fdd443bf47`
Implementation: `b7b9e49dc6c637fef4ea847d39254bd8693b55f2`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
Evidence: `npx tsc --noEmit` PASS; targeted
`tests/jarvis_memory_v2.test.ts` + sqlite/core memory tests green;
`npm run test:cloud` **541/541**.

Do not merge. Do not mark LIVE_VERIFIED. STOP after this queue.

## Previous — Queue 02 Research Intelligence V2

Labels: IMPLEMENTED + CLOUD_VERIFIED (unit). Not LIVE_VERIFIED.
PRIVATE_BROWSER remains fail-closed. Whonix/Tor **LOCAL_VERIFY_REQUIRED**.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
HEAD: `d02f40155aa1521cefbf24fc05aac605310462de`
Implementation: `66b4772`
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.
Evidence: `npx tsc --noEmit` PASS; `tests/jarvis_research_v2.test.ts` +
`tests/jarvis_research.test.ts` 36/36; `npm run test:cloud` **532/532**.

## Previous — Queue 01 Presenter + Desktop (evolution branch)

Labels: LA-026 **PARTIAL**. LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**.
LA-001 and LA-002 remain **PARTIAL** (owner). No LIVE_VERIFIED upgrade.
No merge. Native helper **not installed**.

Canonical branch: `cursor/jarvis-cloud-evolution-2026-08-20`
Base: `8aba6b019c436b1e636f32274607015a4dc23e38`
(`origin/local/jarvis-acceptance-2026-08-20`)
Queue status: `CURSOR_CLOUD_QUEUE_STATUS.md`.

Cloud-safe work: structured presentation facts, TTS-driven narration
timeline, repeat/back, intersection display matching, native-helper
contracts/mocks, comparison routing, Ollama `llm.model`.

Verification (Cloud, re-run on evolution branch): targeted **48/48**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **517/517**. Handoff:
`CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`. HEAD: `5d6e5bc`.

## Previous — Presenter + desktop live acceptance

Labels: LA-026 **PARTIAL**. LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**.
LA-001 and LA-002 remain **PARTIAL** (owner). No LIVE_VERIFIED upgrade.
No merge. Not pushed. No Tauri/Electron/Rust install.

Branch: `local/jarvis-acceptance-2026-08-20` from presenter commit `b2db545`.
Simulation OFF. Lab `JARVIS_STANDALONE=1` `http://127.0.0.1:3010`.
Real Edge-TTS. Real 2-display enum after timeout fix. Browser host cannot
move Chrome/Edge. Native-helper architecture is **Proposed** (ADR-023).

Cloud handoff: `CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.

Fixes this pass (minimal): research briefing isolation; WorkAgent desktop
intent wiring; list/get timeout 18s / write 20s; spawn enum timeout 15s.

Verification: targeted **21/21**; `npx tsc --noEmit` PASS;
`npm run test:cloud` **498/498**. No Discord / Whonix / CCTV.

## Previous — Presentation Mode + desktop presence (implement)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. Live QA was this turn.

## Previous — LA-001 / LA-002 close pass

Owner later directed **PARTIAL** for both. Agent-browser evidence remains
historical. LA-002 is **not OWNER_VERIFIED** (LA-013). No merge. Not pushed.
Discord / Whonix / STT / RVC / uncensored / MoneyPrinterTurbo were not started.

Branch: `local/jarvis-acceptance-2026-08-20` from `4724cbf`.
Simulation OFF. Lab `JARVIS_STANDALONE=1` `http://127.0.0.1:3010`.
Ollama `0.32.14` / `digital-me-qwen38:27b-ad-q4km`.
`npx tsc --noEmit` PASS. `npm run test:cloud` **477/477**.

Close-pass defects fixed: requestId correlation through WorkAgent, capability
trace collection, single latest-request writer, bounded Last task DAG,
permission-wait grant/deny/cancel, usage `tokens` kept while confirm tokens
stay redacted.

Uncached research: marker `LA001-UNCACHED-2026-08-20-1787232948618`,
`requestId=jarvis-1787232959132`, `task_693bb3aeb0ae`, `cached=false`,
trace `tr_4430cb02f901` same requestId + `research.search` ok.
Capability: `สถานะระบบ` `jarvis-1787232970933` / `tr_003c467ced03`.
Hello after tokens-keep: `jarvis-1787233596801` / `tr_acc97921764e` tokens=10.
Permission: wait/cancel `task_4ebf6826844b`; Grant once `task_f2fe0ec67647`.

LA-002 visual: newest request follows CONVERSATION after research; Last task
DAG inspectable; permission wait shown; SSE live/refresh/dedup with no
console errors. Hidden-tab pause is product behavior. Do not start LA-003+.

## Previous — Jarvis research addendum (cloud delta before local acceptance)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware/Ollama/IME/video remain **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed. OpenClaude/MoneyPrinterTurbo/Qwen weights were not installed.

Starting branch: `cursor/jarvis-cloud-finalization-4838` @ `f2f53dc`.
Continuation branch: `cursor/jarvis-research-addendum-4838`.

Prior WorkAgent / CapabilityHost / evolution / Command Center / typed ask router work was preserved, not rebuilt.

- Trace: isolated `ops.db` `TraceStore` records observable facts only (request/session/turn/task/route/model/engine/refs/latency/tokens/retries/errors). Forbidden CoT keys stripped. `TraceAnalyzer` returns `INSUFFICIENT_DATA` rather than inventing p50/p95.
- RuntimeSpec: versioned INTELLIGENCE/ENGINE/AGENT/TOOLS_MEMORY/LEARNING description of the existing runtime. Security/permissions/owner/trust/secrets/promotion are frozen.
- Model profiles: STANDARD / EXPERIMENTAL / RESTRICTED. Uncensored Qwen exists as RESTRICTED with `securityAuthority: false`. No model is the permission system.
- Certification: 10 fixture categories, `liveOllama: false`, status `FIXTURE_ONLY`. Real Ollama/Qwen = BLOCKED_LOCAL_ACCEPTANCE.
- Efficiency: success/latency/tokens when measured. RAM/VRAM/CPU/GPU/energy/cost omitted unless probed.
- Model routing: deterministic policy; RESTRICTED never auto-selected; night stronger model only if `hardware.idle === true`.
- Spec optimization: BASELINE → HYPOTHESIS → isolated benchmark → REJECT/PROMOTION_CANDIDATE. `autoPromote()` is always false.
- Thai: combining-mark fixture round-trips HTTP `parseObjective`, `createJarvisRequest`, task objective, SQLite fact, trace, JSON, Command Center. Windows IME remains BLOCKED_LOCAL_ACCEPTANCE.
- Artifacts + media: stage/manifest/validate simulator. MoneyPrinterTurbo `installed: false`. Publish never auto.
- Memory: lexical + semantic fusion keeps SQLite canonical; Qdrant index-only orphans dropped.
- Scheduler: audited reminders / night / monitor only. Jobs are not permissions. No fourth scheduler.
- Command Center: Intelligence panel on the existing lab UI. Empty analyzer shows INSUFFICIENT_DATA.
- Night Cycle: consumes traces for owner-review spec candidates. `autoPromoted: false`. No training.

Verification: targeted addendum+related **49/49**; `npx tsc --noEmit` PASS; `npm run test:cloud` **468/468**. Browser visual QA not run.

## Previous — cloud finalization wiring (memory, stream, depth, night resume, grant)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware/browser/Ollama remain **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed.

Branch: `cursor/jarvis-cloud-finalization-4838` from `6ba63bd` (`cursor/jarvis-runtime-integration-4838`).

Follow-up after the ask-router / ActionGate pass (`8945da3`):

- Experience writes validate actor + secrets + Discord social filter **before** idempotent id reuse. Duplicate `exp_task_*` ids cannot smuggle `DISCORD_TOKEN=…` or webpage actors.
- Default lab memory store attaches to Command Center so a real WorkAgent outcome writes one canonical `jarvis.db` episode (`trustedSemanticWrite: false`).
- `askStream` uses the same typed router as `ask` (research/work no longer fall through to LLM-only).
- Owner `researchDepth` is forwarded into `research.search` / `research.current`. Depth `none` performs no web fetch.
- Night Cycle `run()` continues from the paused stage; HTTP accepts `action: resume`.
- Command Center client snapshot now includes `permission.taskId/stepId/proposalId` and registry-only model-adaptation counts. Grant once posts those ids. SSE skips `seq <= lastSeq`.
- Affect may suppress casual slang when formal; it cannot authorize and cannot drop immutable facts.

Verification this turn: targeted suite **119/119**; `npx tsc --noEmit` PASS; `npm run test:cloud` **457/457**. Browser visual QA not run (no browser MCP).

## Previous — cloud finalization (ask router, ActionGate handshake, one evolution loop)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed.

- P0 router: `routeJarvisRequest` → CONVERSATION / INFORMATION / RESEARCH / WORK / CAPABILITY with IGNORE/REACT/SPEAK. `hello` / `how are you?` / `explain recursion` stay off WorkAgent. Research/work/unbound capability go through `/api/jarvis/ask` → WorkAgent.
- P0 permission: `grantPermission` no longer marks gated steps done. Owner lease is bound to task/step/capability/scope/risk/expiry. Same step resumes through CapabilityHost. Jarvis/system cannot self-approve. Tokens are stripped from `work.db`. Denial stays denied.
- P0 synthesis + evolution: user-facing SUCCESS/PARTIAL/BLOCKED/FAILED/CANCELLED/DEGRADED. One experience id `exp_task_<taskId>`. Duplicate observers are no-ops. Failure still cannot mint a trusted skill.
- P0 memory: optional canonical episode write via `writeExperienceEpisode`. Research/untrusted tool output cannot become owner-trusted semantic memory.
- P1: failure-adaptive retry bounds, trusted-only skill retrieval, night BENCHMARK stage, Command Center route/permission/benchmarks/honest empty Fluctlight, affect style metadata only.
- P2: vision health + SEE≠CLICK, monitor simulation helper, VIEW≠CONFIGURE preserved. Authoritative queue: `BLOCKED_LOCAL_ACCEPTANCE.md` LA-001–LA-013.

## Previous — runtime integration (CapabilityHost, persistence, night cycle)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware paths remain **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed.

Branch: `cursor/jarvis-runtime-integration-4838` from `e9403bb`.

Maturity audit (code, not class-exists):

- JF-014.6: FUNCTIONAL_CORE. Event bus + SSE replay exist. Browser SSE QA still **BLOCKED_LOCAL_ACCEPTANCE**.
- JF-015: INTEGRATED + UNIT_VERIFIED. `createCapabilityWorkInvoker` calls CapabilityHost. Isolated `work.db`. Restart/resume tested. Unrestricted shell denied.
- EVO-001–010: INTEGRATED + UNIT_VERIFIED for the outcome → experience → reflection → candidate path. Durable `evolution.db`. Night cycle writes reflections and success-only skill candidates. Still no auto-promote. Affect cannot authorize.
- JF-016/017/018: SIMULATION_ONLY + **BLOCKED_LOCAL_ACCEPTANCE**.
- Command Center: FUNCTIONAL_CORE. Real `runObjective` / night endpoints + lab host attach. Simulation stays labeled. Not **OWNER_VERIFIED**. No browser MCP in this cloud.

Verification this turn: targeted integration tests **9/9**; work/evolution/command-center/lab-ui/night **50/50**; `npx tsc --noEmit` PASS; `npm run test:cloud` **436/436**. The two prior Night Agent Linux failures are classified TEST_PORTABILITY_BUG and fixed without weakening assertions (`path.win32` for Windows fixtures; Cursor launch accepts `node` or `node.exe`).

## Previous — cloud-safe Jarvis roadmap (JF-014.6 / JF-015 / EVO / Command Center)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **LIVE_VERIFIED** not claimed. Hardware paths are **BLOCKED_LOCAL_ACCEPTANCE**. No merge to main. No Discord features. No secrets committed.

The previous cloud pass wrote work-agent / evolution / ops libraries and then stopped before SSE APIs, lab UI wiring, docs, commit, and PR. This turn finished that wiring.

- JF-014.6: event `id`/`seq`, bounded buffer, SSE `id:` + `after=`/`Last-Event-ID` replay, heartbeat comments, visual-state mapping. `/jarvis-lab` EventSource reconnects. Browser SSE QA not run in cloud.
- JF-015: DAG work agent with cancel/pause/resume, permission wait, stale-terminal write guard, simulated demos via `CommandCenterRuntime`.
- EVO-001–010: claims, retrieval rank, structured reflection (failure cannot mint trusted skills), skill lifecycle, failure ledger, self-model `INSUFFICIENT DATA` until n≥3, growth planner cap 3, practice/benchmarks, night cycle pause on `realtime_voice`, affect cannot authorize, identity overlay, journal, candidate manager (no auto-promote), LoRA registry only (`trained: false`).
- JF-016/017/018: simulated vision (see ≠ click/type/submit), proactive monitor, VIEW-only devices, owner autonomy 0–5 (Jarvis cannot raise max).
- Lab: `/api/jarvis/command-center` GET + demo/control/cancel/grant POSTs (loopback + mutation guard). Simulation banner, live ops steps, evolution rail, source graph, devices.
- Verification this turn: targeted Jarvis tests **48/48** pass; `npx tsc --noEmit` PASS; `npm run test:cloud` **425/427** pass. The two failures are pre-existing `night_agent_grok_only` Windows-path assertions on Linux (`path.basename` of `C:\\...` and `node.exe` vs `node`). Not claimed as this change. Browser SSE / Ollama / Whonix / mic / CCTV remain **BLOCKED_LOCAL_ACCEPTANCE**.

## This turn — cloud-safe Jarvis checkpoint for Cursor Cloud Agents

Labels: **OFFLINE_VERIFIED** for a dedicated checkpoint branch. No merge, no PR into main, no reset/clean, no push to `main`/`master` or `feature/jarvis-platform-contracts`.

- Original local branch was `feature/jarvis-platform-contracts` at `3d32cb4`. Created `cloud/jarvis-checkpoint-2026-08-19` without discarding the dirty tree.
- Remote is GitHub `https://github.com/eikq/DiscordBOT.git`. Cursor Cloud Agents can use this when the owner’s GitHub account is connected.
- Cloud prep: `.cursor/environment.json` + Debian `node:22-bookworm` Dockerfile (no project COPY, no secrets), `npm run test:cloud`, AGENTS.md §13. Windows/VBox/Whonix stay mockable or fail-closed.
- Deliberately excluded: `.env`, `.runtime/` (OVA, Gitleaks binary, screenshots), VirtualBox VM disks, `data/brain|memory|jarvis|voice*`, `night-agent.config.json`, cookies/browser auth, root PNG/ZIP/PDF dumps, `.cursor/mcp.json`.
- Gitleaks v8.30.1 is re-run on the working tree, staged files, and git history before push. Findings that are confirmed test fixtures/placeholders are documented in the owner report. Any possible real credential stops the push.

## Previous — Whonix black-screen diagnosis (NEM / dual-start)

Labels: **LIVE_VERIFIED** for Gateway-alone desktop after dual-start hang. **LIVE_TESTED** not claimed for Tor or PRIVATE_BROWSER. Workstation not restarted. No VBS/HVCI change. No graphics/firmware/network change. No commit/push/reset/clean.

- Both VMs used NEM snail mode: `HM: Attempting fall back to NEM: VT-x is not available` and `NEMR3Init: Snail execution mode is active!`
- Dual-start hang: kernel reached GIM/KVM (~20s) then stalled. Gateway NAT `e1000#0` RX/TX stayed **0 bytes**. ACPI ignored. Guest Additions runlevel 0.
- Official match: Whonix forum 23292 + Kicksecure Green Turtle (`only launch 1 VM at a time` while keeping VBS).
- After Workstation hard power-off + Gateway restart **alone**: LXQt desktop visible; `updatecheck` 48 packages; VBoxService 7.2.12; NAT RX ~22 MB / TX ~1.8 MB. Workstation left off.
- PRIVATE_BROWSER: `available=false`, `Workstation=down`.

## Previous — official Whonix import + fail-closed live health

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** (security tests **20/20**, `tsc --noEmit` PASS). Host VirtualBox/Whonix import is **OFFLINE_VERIFIED** (hash + OpenPGP + NIC/isolation). Live Tor / guest Playwright are **not** LIVE_TESTED. First-boot legal/security acknowledgement is **OWNER_ACTION_REQUIRED**. Encryption unchanged. No BitLocker/Device Encryption enable. No Windows security weakening. No UAC bypass. No owner Chrome/Edge. No commit, push, reset, or clean.

- `VBoxManage --version` = `7.2.16r174877`. Existing VMs before import: none.
- Official OVA already on disk (2,791,580,160 bytes). SHA512 matched official sums. Official signing key fingerprint `916B 8D99 C38E AF5E 8ADC 7A2A 8D66 066A 2EEA CCDA`. `gpg --verify` = Good signature on OVA and sha512sums; `file@name` notations match. Signify not installed on Windows; OVA OpenPGP is the stronger official check.
- Imported only `Whonix-Gateway-LXQt` + `Whonix-Workstation-LXQt`. Official NICs preserved: Gateway NAT+Internal `Whonix`; Workstation Internal `Whonix` only.
- Isolation applied: clipboard/DnD off, shared folders none, USB controllers off, mic/capture off, host camera not attached.
- Started Gateway, then Workstation (`--type gui`). VBox `screenshotpng` stayed black (VMSVGA). Gateway CPU ~8% — likely sitting at a guest first-boot dialog. I did not send keys or accept any guest legal text.
- Live host health: `virtualBox/gateway/workstation=up`, `isolationOk=true`, `tor=unknown`, `available=false`, `LIVE_TOR_CHECK_REQUIRED`.
- Health checker now inspects Workstation NICs by default (VirtualBox 7.2 `Attachment:` format + machinereadable `nicN=`), finds `VBoxManage` under Program Files, and will not set `available=true` without a live Tor check.

## Previous — security-first continuation (JF-014.5 / 014.55 / 014.6)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for privilege leases, fail-closed PRIVATE_BROWSER policy, SSRF/injection, telemetry bus, evolution primitives. **LIVE_TESTED** not claimed for VirtualBox/Whonix/Playwright guest. Encryption classified **UNKNOWN** (WMI/`manage-bde` unavailable); **not** enabled or modified. No commit, push, reset, or clean.

- Owner override: do not enable BitLocker/Device Encryption. Host protections stay on. No UAC bypass.
- Official versions (2026-08-19): VirtualBox **7.2.16-174877** from virtualbox.org; Whonix **LXQt 18.2.1.9 Intel/AMD64** from download.whonix.org (wiki short OVA name 404s); Playwright via official npm, worker only in Whonix; Gitleaks **8.30.1** official GitHub zip.
- Detected: Node v22.23.2; VirtualBox **missing**; Whonix **missing**; Playwright **not a repo dependency**; Gitleaks **missing**; session is **standard user** (Medium IL).
- Host registry (read-only): Firewall ON; UAC ON; Tamper Protection ON; HVCI ON; VBS ON; Secure Boot ON; Defender not disabled. PassiveMode=2 reported, not changed.
- New code: `src/jarvis/security/*`, `src/jarvis/research/private/*`, `src/jarvis/evolution/*`, worker package, provision scripts, lab `/api/jarvis/events|security|private-research`.
- Docs: host/privilege/Whonix/private-research/browser/threat/telemetry/evolution + `JARVIS_SECURITY_STATUS.md` / `JARVIS_MASTER_STATUS.md` + ADR-021.

## This turn — JF-014 safe local workspace intelligence

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process real `jarvis-project` A–F, H, I). **HUMAN_QUALITY_VERIFIED** not claimed. 27B was not required for deterministic search/symbol/compare. HTTP Command Center Workspace rail was not separately live-QA'd this turn. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center redesign. JF-010/011/012/013/013.5 authority unchanged. JF-SKILLS-001 still `scriptsAllowed=false`. Historical CCTV id remains `JF-014-CCTV`.

- Host-owned `config/jarvis/workspaces.json` → `jarvis-project`. Model authority is `workspaceId` / `documentId` / query. Argument `path` stays forbidden.
- PathPolicy fail-closed: absolute, `..`, UNC, ADS, drive switch, symlink/junction escape, `.env`, credentials, operational DBs, `data/**`.
- Isolated index `data/jarvis/workspace/workspace.db` (FTS5 + symbols). Incremental mtime/size/hash. First live index **945–1036ms / 356 files** after wrapping refresh in a SQLite transaction (was ~72s without it). Symbol lookup **20–22ms**.
- READ_ONLY capabilities: list/search/get/excerpt/findSymbol/compare/metadata/current/refreshIndex. No write/delete/rename/exec/readPath. `workspace.openDocument` skipped.
- JF-013.5: “หาไฟล์ memory”, “CapabilityHost อยู่ตรงไหน” resolve to workspace. “read credentials” stays conversation. “อ่าน .env” / absolute hosts stay forbidden. “แก้ PROJECT_CONTEXT.md” unsupported.
- Interaction context: เปิดอันแรก / สรุปไฟล์นี้ / hybrid web. Local `documentRefs` ≠ web `sourceRefs`. Document text is data; injection fixture cannot invoke tools or write memory.
- Lab: compact Workspace block after Sources; excerpts as text; refresh `{ workspaceId }` only; `GET /api/jarvis/workspace` rejects `?path`.
- Tests: `jarvis_workspace` **21/21**; JF-010–014 set **157/157**; full `tests/*.test.ts` **379/379**; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS (existing `import.meta` warning).
- Docs: `docs/JF014_SAFE_LOCAL_WORKSPACE.md`, ADR-020.

## This turn — JF-013.5 natural intent + conversational recovery

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process `createJarvisLabRuntime` A–J on this machine). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center redesign. JF-010/011/012/013 authority unchanged. JF-SKILLS-001 still `scriptsAllowed=false`. JF-014 not started.

- Root cause: unmatched natural Thai/English fell through to Qwen, which refused to invent tools (“ไม่มีสิทธิ์ / I cannot access”) even when a registered capability existed. Leftover noise (`ช่วย`, `ให้หน่อย`) also kept `consumed=false`. Any PowerShell mention was treated as `BLOCKED_SHELL`.
- New `src/jarvis/intent/*`: classify → fast path → context/heuristic → optional catalog-only semantic JSON → conversation. Schema rejects unknown ids/fields and permission/executable keys. Interaction context is 10-minute TTL, not personal memory.
- Fast paths kept. Talk-about ≠ request. Clarification/unsupported/unavailable/forbidden stay distinct. Spotify-not-installed offers web alternative without auto-open. YouTube uses `desktop.openTrustedUrl` + JF-010 confirm.
- Live A–J in-process, then HTTP on restarted `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): YouTube `confirmation_required` (not opened); RTX/NVIDIA research completed; ASR health then “รีสตาร์ตมัน” → confirm `qwen-asr` (not executed); Spotify vague → clarification; `เปิด Spotify` → `NOT_INSTALLED` + web offer; “PowerShell คืออะไร” → Qwen explanation (~11.8s), not blocked; “รัน PowerShell” → `BLOCKED_SHELL`; “ช่วยทำหน่อย” → ask-what-task.
- Tests: `jarvis_intent` **20/20**; JF-010–013 + skills/core set **149/149**; full `tests/*.test.ts` **357/357**; `tsc --noEmit` PASS; `npm run build` PASS (existing `import.meta` warning).
- Docs: `docs/JF013_5_INTENT_RESOLUTION.md`, ADR-019.

## This turn — JF-013 safe web research + source intelligence

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process public HTTP + lab `/api/jarvis/ask` A–F + Command Center Sources rail). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign. JF-010/011/012 left intact. JF-SKILLS-001 still `scriptsAllowed=false`. Historical proactive-events id remains `JF-013-PROACTIVE`.

- Extends CapabilityHost; does not replace Discord `ResearchAssistant` / world-intel MCP. New `src/jarvis/research/*` with `research.search|fetchSource|getSource|compareSources|current` (READ_ONLY).
- SSRF: http(s) public only; localhost/127/::1/RFC1918/link-local/metadata/file/javascript/data/credentials blocked; redirects re-validated. Schema rejects `method|headers|body|cookie`. GET only. No JS. PDF → `UNSUPPORTED_CONTENT_TYPE`.
- Store: `data/jarvis/research/research.db` (`node:sqlite`). Refuses `jarvis.db` / `automation.db` / `data/brain`. Research does not write canonical memory. “ค้นทุกชั่วโมง” → `SCHEDULED_RESEARCH_UNSUPPORTED`.
- Citations lifted into `verifiedFacts` with `immutableForPresentation: true`. Webpage text is data (`untrustedOutput`).
- Live lab on `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): RTX 5090 → 6 sources / 11 evidence / nvidia.com OFFICIAL first (19.1s uncached); official-only 3 NVIDIA hosts; compare-last 4 sources (561ms); freshness 18ms published-unknown vs fetched; w3.org PDF unsupported; `http://127.0.0.1:3010` denied `BLOCKED_LOOPBACK` before fetch; `สวัสดีครับ` 860ms no research action. UI: SEARCH/FETCH/COMPARE/SYNTHESIS + nvidia.com source chips + inspector URL (no page execution).
- Live bugs found and fixed: `facebook.com` was treated as IPv6 (`fc` prefix); WordPress matched `/press/` as OFFICIAL; “เทียบข้อมูลจากหลายแหล่ง” searched leftover topic instead of last session. Body cap raised to 2.5MB after Wikipedia/NVIDIA HTML exceeded 400KB.
- Tests: `jarvis_research` **20/20**; with JF-010/011/012 **116/116**; full `tests/*.test.ts` **338/338**; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS (existing esbuild `import.meta` warning).
- Docs: `docs/JF013_SAFE_WEB_RESEARCH.md`, ADR-018.

## This turn — JF-012 reminders + scheduler / automation kernel

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process A–G + lab HTTP/UI). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign. JF-010/011 left intact. Historical queue id “JF-012 Qdrant” remains FUTURE as `JF-012-QDRANT`.

- Dedicated operational SQLite `data/jarvis/automation.db` (not `jarvis.db`, not Night Agent). Timezone `Asia/Bangkok` persisted. Occurrence uniqueness `reminderId + scheduledAt` in `BEGIN IMMEDIATE`.
- Thai/English parser; bare hour → `AMBIGUOUS_TIME`; past one-time → `PAST_TIME`. Recurring downtime skips backlog.
- Capabilities `reminders.*` through ActionGate. Reminder text is data. `อีก 1 นาทีรัน cmd.exe` → `SCHEDULED_ACTION_UNSUPPORTED`. Skills still `scriptsAllowed=false`.
- Lab: right-rail Reminders + due card (Done / Dismiss / Snooze 10m). `GET /api/jarvis/reminders`, `POST /api/jarvis/reminders/ack` with JF-011 mutation guard. Cross-origin ack → 403 `INVALID_ORIGIN`.
- In-process live (real clock): A 45s fire skew **69ms**, create **7ms**; B recover+fire once; C daily 20:00 next `2026-08-19T13:00:00.000Z`; D list **2ms**; E cancel; F pause/resume; G 0 launches.
- Lab live on `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): 70s reminder survived process restart and fired `on_time` at 17:37; 45s “เช็ก Jarvis” fired; due card + rail `scheduler healthy · next 08:00 PM`; TTS offline, notification still delivered. Live leftovers cancelled.
- Live bugs found and fixed (unit-tested): create phrase containing `ยกเลิก` was stolen as cancel; English daypart `night` ate “Night Agent” titles.
- Tests: `jarvis_reminders` **46/46**; with JF-010/011 **96/96**; `jarvis_*` files 240 tests included in full suite; full `tests/*.test.ts` **318/318**; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS (existing esbuild `import.meta` warning).
- Docs: `docs/JF012_REMINDERS_SCHEDULER.md`, ADR-017.

## This turn — JF-011 runtime + system capability pack

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (in-process A–J). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign. JF-010 left intact.

- Loopback mutation guard: Host, Origin/Referer, `Sec-Fetch-Site: cross-site`, `application/json`, 16 KB body, no confirm tokens in query. `JARVIS_STANDALONE=1` refuses `0.0.0.0`.
- Registry (ids only): `ollama`, `qwen-asr`, `jarvis-tts`, `rvc`, health-only `embedding` + `jarvis-lab`. Stop/restart confirm. Owned-child stop only (`NOT_OWNED` otherwise). No generic PID/process API.
- Read-only: runtime/system/battery/network/allowlisted apps. Battery on this machine: WMIC missing → honest `unavailable`.
- Live: Qwen healthy; ASR/TTS/RVC/embeddings offline; Chrome installed; Bluetooth settings opened; start ollama → `ALREADY_RUNNING` (2ms); stop/restart → confirmation, not executed; `chrome.exe` / `cmd.exe` blocked.
- Fast path: runtimeStatus 29ms; start already-running 2ms; no 27B wake.
- Tests: `jarvis_actions` 28/28; `jarvis_runtime` 22/22; `jarvis_*` 194/194; full `tests/*.test.ts` 272/272; Python 35 ran / 8 skipped; `tsc --noEmit` PASS; `npm run build` PASS.
- Docs: `docs/JF011_RUNTIME_SYSTEM_CAPABILITIES.md`, ADR-016.
- Skills still instruction/reference only (`scriptsAllowed=false`).

## This turn — JF-010 safe permissions + actions

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (safe lab A–F after Thai-intent fix + server restart). **HUMAN_QUALITY_VERIFIED** not claimed. No commit, push, reset, or clean. Unrelated owner dirty/untracked work was left in place. No Command Center visual redesign.

- Deterministic `ActionGate` + `PermissionPolicy` wrap the standalone CapabilityHost. The LLM never receives a shell.
- Capabilities: `desktop.openApplication`, `desktop.openProject`, `desktop.openTrustedUrl`, `system.status`.
- Confirmation tokens are proposal-bound, hashed, one-use, 120s TTL. UI: Deny / Allow once. Live reuse of the same token returned `CONFIRMATION_REUSED` and did not execute again.
- Thai intent uses `includes()` for Thai verbs (`เปิด`, `สถานะระบบ`); JS `\b` is Latin-only and missed those phrases before the fix.
- Audit JSONL at `data/jarvis/audit/actions.jsonl` (no tokens, prompts, or executable paths).
- Skills still cannot execute scripts or elevate permission. Persona cannot mutate `ActionResult`.
- Live A–F on `http://127.0.0.1:3010` (`JARVIS_STANDALONE=1`): status completed; Notepad launched; Spotify `NOT_INSTALLED`; PowerShell `BLOCKED_SHELL`; `javascript:` `BLOCKED_URL_SCHEME`; `https://example.com` required Allow once then completed.
- Tests: `tests/jarvis_actions.test.ts` **28/28**. `tests/jarvis_*.test.ts` **172/172**. Full `tests/*.test.ts` **250/250**. Python 35 ran / 8 skipped. `tsc --noEmit` PASS. `npm run build` PASS (existing esbuild `import.meta` warning).
- Docs: `docs/JF010_SAFE_ACTIONS.md`, ADR-015.

## This turn — visual course correction (owner rejected Blender-heavy iris)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (1920×1080 A/B/FINAL screenshots). **HUMAN_QUALITY_VERIFIED** still pending owner sign-off. Visual-only. No commit, push, reset, or clean. JF-SKILLS-001 / Core contracts / memory semantics / skills were not touched.

- Rejected silhouette causes: HUD/cage/radial GLBs are full rings (~14–17 unit radius) around the origin; additive hologram materials stacked to white posts; a bright inner nucleus + oval wash read as a white eye/pupil.
- Correction: keep the GLB pipeline, but present Blender as sparse off-core fragments (scanner upper-left, HUD lower-right, cage rear, radial front-left) with **NormalBlending**; Core scale 1.52; broken procedural orbits; 6 offset cyan cognition clusters; inner white seed/pupil mesh removed.
- Screenshot sequence at 1920×1080, rails open: `.runtime/COURSE_CORRECTION_BEFORE.png` (rejected), `COURSE_CORRECTION_A.png` (stale Vite — nearly identical to BEFORE; not used as the correction), `COURSE_CORRECTION_B.png` (first real correction after Vite restart), `COURSE_CORRECTION_FINAL.png` (brighter organic volume, still 0 center white pixels vs BEFORE 359).
- Pixel evidence FINAL vs BEFORE: mean channel-sum diff 74.84, 52% sampled pixels changed; center RGB 11,36,52 vs 77,116,135; white-hot center samples 0/17956 vs 359/17956.
- Targeted tests: `npx tsx --test tests/jarvis_lab_scene.test.ts tests/jarvis_lab_graph.test.ts` **19/19**. Screenshot FPS remains ~143 in the live GPU tab path; headless capture is not performance evidence.
- Dev server: `http://127.0.0.1:3010/jarvis-lab` (`JARVIS_STANDALONE=1`). Vite required a process restart to pick up CoreScene transforms (Windows watch cache).

## This turn — Master Prompt continuation (skills, Blender GLB, 1920 QA, regression)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (1920×1080 composition screenshots + GPU FPS). **HUMAN_QUALITY_VERIFIED** still pending owner sign-off. No commit, push, reset, or clean.

- Original Definition of Done re-audited against repo/runtime/MCP evidence (PASS/PARTIAL/NOT DONE/BLOCKED in the owner report).
- Curated Cursor skills verified with `npx.cmd skills list --json` (project scope, `.agents/skills/` copies). Custom `.cursor/skills/{jarvis-first-invariants,jarvis-lab-visual-qa,jarvis-night-agent-safety}` do not replace that phase.
- Community Three.js/R3F audit: OpenAEC/Impertio-Studio MIT LICENSE confirmed on `master`; `threejs-impl-react-three-fiber` + `threejs-errors-performance` installed as REVIEWED_COMMUNITY. EnzeD/r3f-skills and CloudAI-X remain not installed.
- Live Blender MCP scene `assets/jarvis/blender/source/jarvis_command_center_mcp.blend`: volumetric posts/fins/clamps added; four GLBs re-exported and loaded by `CoreScene.tsx` via `GLTFLoader` (also hashed into `dist/assets/*.glb` by `npm run build`).
- 1920×1080 three-pass screenshots (distinct files): `.runtime/jarvis-master-pass-a.png`, `pass-b.png`, `pass-c.png`. Headless Edge reports ~1 FPS and is not performance evidence. Cursor GPU tab at quality high: **144 fps** (`innerWidth` 1078 collapsed rails; 1920 shots have rails open).
- Idle SQLite graph remains **2 nodes / 1 real edge** (`entity:sys` → `fact:architecture.memory_backend`); layout now uses a tight halo. No fabricated edges.
- JF-SKILLS-001 still instruction/reference only. No JF-010. `tests/jarvis_skills.test.ts` 14 safety tests included in full TS suite.
- Verification this turn: `npx tsx --test tests/*.test.ts` **221/221**; `python -m unittest discover -s tests -p test_*.py` **35 ran, 8 skipped, OK**; `npx tsc --noEmit` PASS; `npm run build` PASS (GLBs in dist). Existing esbuild `import.meta` warning unchanged.
- Dev server: `http://127.0.0.1:3010/jarvis-lab` (`JARVIS_STANDALONE=1`).

## This turn — reference HUD alignment + JF-SKILLS-001

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE browser QA** (owner visual sign-off still pending). No commit/push. Dirty/untracked owner files were left in place.

- Applied the owner's four cinematic HUD references as visual language only (no Stark/SAO branding): cyan core light, sparse magenta HUD accents, dark navy grid, glass rails, trapezoid stage frame, scanline vignette.
- 3D Core remains the hero: closer default camera, magenta spark particles, quieter rings, brighter idle nucleus. Architecture, graph system, and Core contracts were not rewritten.
- Live QA at `http://127.0.0.1:3010/jarvis-lab`: WebGL canvas mounted (no 2D fallback), Auto/High **~144 FPS**, IDLE status readable, Persona/Voice still independent. Headless Edge screenshots report 0 FPS and are not used as performance evidence.
- JF-SKILLS-001: instruction/reference-only Jarvis skill runtime (`src/jarvis/skills/*`) with allowlist, path/symlink rejection, no script execution, host-policy wrapper, Core `skillRefs` provenance. Lab attaches it via `attachDefaultSkills`. Default skills: `jarvis-memory-safety`, `jarvis-runtime-qa`.
- Project Cursor skills (no scripts): `.cursor/skills/jarvis-first-invariants`, `jarvis-lab-visual-qa`, `jarvis-night-agent-safety`.
- Verification: targeted TS tests **69/69** plus `jarvis_first` Discord-free walk including `src/jarvis/skills`; `npx tsc --noEmit` PASS. Skill runtime has no `child_process`/`eval` and does not import Discord.

## This turn — UI-R9 focused visual refinement

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE browser QA**. Architecture was owner-accepted before this pass; final owner visual acceptance is still pending.

- Preserved the existing frontend architecture, Jarvis Core, memory graph adapter/layout, state/data APIs, and all current lab controls.
- Reworked only the WebGL presentation: layered seed/inner shell/plasma shell/particle volume/transparent cognition shell, interior-biased particles, shorter and substantially fewer depth-faded neural filaments, moving energy bands, and restrained local flashes.
- Increased default Core dominance through luminance layering and a closer default camera while keeping its geometry/state contract unchanged; the compact camera now pulls back/raises the Core so the state HUD remains below the nucleus on narrow screens.
- Rebuilt orbit appearance as broken instrument arcs with varied opacity, instanced ticks, radial marks, and counter-moving indicators; inactive tool labels now reveal only on hover/activity/failure.
- Reduced graph noise: default labels require importance, selection, or search; inactive edges/nodes recede while selected/path relationships brighten.
- Added selective sprite glow only to the nucleus, selected graph node, active tool nodes, and real transient streams; no full-screen bloom/postprocess was added.
- Added fog, near/far dust, depth fading, stage vignette, richer translucent panel materials, and a clean `IDLE` / `Awaiting a request` Core HUD.
- Refined observable state motion: quieter idle/listening, stronger thinking contraction/turbulence, memory/tool event emphasis, layered response/speech pulses, and subtle violet Night Agent mode.
- Browser QA completed as three screenshot passes: A (Core volume/depth), B (graph noise/orbit machinery), C (lighting/panels/spacing/composition), plus narrow-view correction. A redundant oversized nucleus glow sprite was removed and shell tessellation reduced after profiling transparent overdraw; final Auto/High with all layers reached about **144 FPS** in the single emulated 1920×1080 QA tab and remained about **72 FPS** while concurrent browser automation was active.
- Verification: targeted lab tests **22/22**, full TypeScript tests **203/203**, Python tests **38 passed / 7 skipped**, `npx tsc --noEmit` PASS, production build PASS (existing CJS `import.meta` warning and large lazy Three.js chunk warning remain).
- Dev server remains available at `http://127.0.0.1:3010/jarvis-lab`.

## This turn — UI-R9 Jarvis Command Center (WebGL redesign of /jarvis-lab)

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** (203/203 TS tests) + **LIVE browser QA** on this machine (dev server 3010, emulated 1920×1080 + native narrow). Owner visual acceptance pending.

- Real Three.js core: `src/jarvis/ui/three/CoreScene.tsx` (nucleus, GPU particle sphere, filaments, rings with ticks, tool orbit nodes from the real capability registry, space dust, ripple pulses, pooled memory streams/tool arcs)
- Pure logic split for tests: `three/quality.ts` (auto/high/balanced/minimal/2d, FPS stepping, DPR caps), `three/sceneState.ts` (phase→mood), `three/pulseBus.ts`, `graph/graphLayout.ts` (deterministic clustered layout, BFS path), `graph/graphTypes.ts`
- Interactive knowledge graph from the real SQLite store via new read-only `src/jarvis/memory/graphAdapter.ts` + `/api/jarvis/memory/graph` + `/api/jarvis/memory/node`; secret privacy labels redacted; no invented edges
- Ops data: `src/jarvis/standalone/labSystem.ts` + `/api/jarvis/system` (CPU/RAM/disk real, GPU via nvidia-smi cached, unknowns shown as unknown) and `/api/jarvis/night` (reads real night-agent state; showed 6/6 PASS run)
- Page recomposed (`JarvisLabPage.tsx` + `jarvis-lab.css`): translucent left memory/context/inspector rail, right operations rail, floating evidence/tool/task panels, REQUEST→…→PRESENTATION→SPEECH pipeline, floating dock with circular mic; existing ask/stream/mic/speech/persona/voice logic unchanged
- Live QA: real ask answered "Jarvis uses a SQLite memory backend." with memory evidence `fact:architecture.memory_backend`; node select/inspector/relations verified; drag-orbit verified; 2D↔auto quality roundtrip verified (fixed false context-lost on intentional unmount); ~144 fps at high
- Fixes found by QA: filament antipodal spike through core, polar cluster edge through nucleus (band layout + curved edges), Ripples material leak, hidden floats in a11y tree, narrow screens default-collapse rails
- Fallbacks kept: `JarvisCoreVisual` CSS core renders for 2D mode, missing WebGL, or lost context; reduced motion freezes to demand rendering; hidden tab stops the frameloop
- Dev server for viewing: `$env:PORT='3010'; $env:JARVIS_STANDALONE='1'; npm run dev` (left running)
- Not started: owner HUMAN_QUALITY pass, Discord work (none), Jarvis Core changes (none — adapters only)

## This turn — Grok-only tonight is startable

Labels:

- **IMPLEMENTED** + **UNIT_VERIFIED** Cursor CLI provider: official `%LOCALAPPDATA%\cursor-agent` lookup, Windows `node.exe`+`index.js` launch (avoids `agent.cmd` `EINVAL`), exact model `cursor-grok-4.6-xhigh-fast`, no Auto / no `cursor-grok-4.6-high-fast`, Qwen/Codex fallback off
- **LIVE_VERIFIED** isolated worktree `C:\Users\piriy\Documents\DiscordBOT-night-2026-08-19` from HEAD `3d32cb4e9309115b648bccd33f7d5abd39b7e983`
- **LIVE_VERIFIED** synthetic dry-run `NIGHT-DRYRUN-001` **PASS** via `cursor-grok` / `Cursor Grok 4.6 Extra High Fast`; NightToolHost ran `npx tsx --test tests/grok_dryrun_marker.test.ts` exit 0; Local Qwen attempts 0
- Primary repo project code was not written by Grok (marker files exist only in the night worktree)
- Windows Cursor CLI cannot `--sandbox enabled`; argv uses `--sandbox disabled` plus project `.cursor/cli.json` deny Shell/WebFetch/MCP and orchestrator scopeGuard
- Project `cli.json` is permissions-only (installed CLI rejects `version` on project files)
- Overnight run **LIVE_VERIFIED completed**: NIGHT-001..006 all PASS on first Grok attempt; Qwen attempts 0; no provider failures; no push/commit/merge. Report: `C:\Users\piriy\Documents\DiscordBOT-night-2026-08-19\.agent\night\reports\NIGHT_REPORT-2026-08-19.md`

### Owner start (do not run until they ask)

```powershell
npm run agent:night
```

Morning:

```powershell
npm run agent:night:status
npm run agent:night:report
```

## Git state

- Branch: `feature/jarvis-platform-contracts` (tracking origin)
- Unrelated dirty/untracked files left untouched
- No commit or push

## Earlier this calendar day — Grok-only zip landed (superseded)

Zip parked at `.runtime/addenda/night-agent-grok-only-tonight-fix/`. The PATH/auth/model blockers below are **superseded** by the live dry-run in the section above.

### What the zip required

1. Real Cursor CLI worker (fresh process, `--print`, `stream-json`, `--workspace`, exact `--model`, sandbox; `--force` only in isolated worktree)
2. Grok is a patch worker only (deny Shell / WebFetch / MCP / private paths); NightToolHost runs acceptance
3. Controller (dirty primary) vs clean isolated night worktree; create only with `--create-worktree --name`
4. On quota/auth/model/provider failure: record, mark `BLOCKED_PROVIDER`, write report, STOP; do not start Qwen
5. Never guess the model id; never auto-commit/push/reset/clean/delete worktrees

### Owner blockers (exact actions)

1. Install official Cursor CLI in PowerShell: `irm 'https://cursor.com/install?win32=true' | iex`
2. Open a **new** PowerShell, then: `agent --version` ; `agent login` ; `agent models`
3. Put the exact Grok 4.6 id into `night-agent.grok-only.example.json` as `cursorModel` / provider `model` (copy that file to `night-agent.config.json`)
4. Create the isolated worktree: `npm run agent:night:prepare -- --create-worktree --name night-2026-08-19 --acknowledge-head-only` (HEAD-only; dirty primary files are **not** included)
5. Set `workspaceRoot` to the printed path, then run one synthetic NIGHT_SAFE dry-run before an unattended queue

### Tests

- `npx tsc --noEmit` PASS
- `npx tsx --test tests/night_agent.test.ts` **13/13**
- `npx tsx --test tests/night_agent_grok_only.test.ts` **15/15**

## Previous turn — Night Agent NIGHT-BUILD-001 through 009

Labels:

- **IMPLEMENTED** + **UNIT_VERIFIED** for the separate `src/agent/` overnight coding worker (orchestrator, policy, NightToolHost, Qwen adapter, reports, CLI)
- **LIVE_VERIFIED** DEV_NIGHT Qwen context benchmark on this machine with Discord/ASR/JaiTTS/RVC off
- **LIVE_VERIFIED** synthetic sandbox dry run: 3 Qwen NIGHT_SAFE tasks PASS + 1 simulated fail BLOCKED with escalation
- **Not** a real overnight run on this dirty primary worktree
- **Not** Windows Task Scheduler (NIGHT-BUILD-010 not started)
- **Not** JF-010
- Discord client was not started
- Cursor `agent` CLI was not on PATH; v1 does not spawn it

### Architecture

Deterministic `NightOrchestrator` owns task selection, NIGHT_SAFE checks, file/command policy, attempts, time limits, acceptance tests, PASS/BLOCKED, escalation, and reporting.

`LocalQwenCodingAgent` is a development-only worker. Jarvis Core / `/jarvis-lab` do not receive coding/file/shell tools.

### npm commands

- `npm run agent:night:prepare`
- `npm run agent:night`
- `npm run agent:night:status`
- `npm run agent:night:report`

### DEV_NIGHT Qwen benchmark (voice services stopped)

Idle after ASR/JaiTTS/RVC stop: **1251 / 24463 MiB**. RAM 64956 MB total, 36644 MB free. Model `digital-me-qwen38:27b-ad-q4km` (`/api/ps` still labels quant Q8_0).

| num_ctx | GPU after (MiB) | cold load | warm prompt tok/s | warm gen tok/s |
|---|---|---|---|---|
| 16384 | 18181 / 24463 | 6.39 s | 1258 | 51 |
| 32768 | 19220 / 24463 | 7.37 s | 1369 | 57 |
| 49152 | 20250 / 24463 | 7.33 s | 1286 | 50 |

Recommended stable coding context: **32768**. 48K fits but leaves less headroom. Largest is not assumed best.

### Sandbox dry run

Temp git workspace. Qwen ctx 32768. 10 context resets.

| Task | Result | Attempts | Files |
|---|---|---|---|
| SANDBOX-001 unit test | PASS | 1 / 11852 ms | tests/add.test.ts |
| SANDBOX-002 type fix | PASS | 1 / 8420 ms | src/typo.ts |
| SANDBOX-003 README | PASS | 1 / 11071 ms | README.md |
| SANDBOX-FAIL | BLOCKED | 3 | escalation packet |

Cloud/Codex disabled: local packet saved, independent tasks continued.

First dry-run attempt failed acceptance with Windows `spawn EINVAL` on `npx.cmd`. Allowlisted `tsx --test` / `tsc --noEmit` now run through `process.execPath`. Re-run passed.

### Tests / lint / build

- `npx tsx --test tests/night_agent.test.ts` **13/13**
- `npx tsc --noEmit` PASS
- `npm run build` PASS (known SQLite `import.meta` CJS warning)

## Previous turn — JF-009 standalone speech output

**IMPLEMENTED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** typed `/jarvis-lab` speak. Native Edge-TTS. Not HUMAN_QUALITY_VERIFIED. JF-009 is accepted; JF-010 was not started.

## Next READY

- Owner command to start the seeded overnight queue: `npm run agent:night` (do not start until asked)
- `JF-010` permission/action policy — **do not start unless the owner asks**
- NIGHT-BUILD-010 Windows scheduler — **do not start unless the owner asks**
- `UI-R9` WebGL core — **do not start unless the owner asks**

## Blocked / stopped

- Stopped before Windows automatic scheduling
- Stopped before JF-010
- Qdrant / MEMORY-003
- Discord JARVIS-006+
- Digital Me dashboard rewrite
