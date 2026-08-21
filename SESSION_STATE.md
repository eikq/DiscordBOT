# Cursor Session State

Updated: 2026-08-21
Agent/model: Cursor Grok 4.6 (owner Windows)

## This turn — Cinematic Presence v4

Branch: `local/jarvis-cinematic-presence-v4-2026-08-21` from exact
`8c938ae40fe3beeb87e6ba4d0bcba9bea9323f59`. Did not modify `main`.

Primary URL: `http://127.0.0.1:3000/jarvis`  
Ambient: `http://127.0.0.1:3000/jarvis?mode=ambient`  
Control Center: `http://127.0.0.1:3000/jarvis-lab`  
Replay: `http://127.0.0.1:3000/jarvis?visualReplay=1`  
Fixture example: `http://127.0.0.1:3000/jarvis?visualScene=research`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** is not claimed.

- Full-viewport WebGL Core with energy shaders, 3-axis gyros, structured particles, and UnrealBloom.
- Research constellation, activity telemetry, and DEVELOPMENT REPLAY stay query-gated.
- Pointer hover/select is presentation only and cannot grant authority.

See `docs/JARVIS_CINEMATIC_PRESENCE.md`.

## Previous — Cinematic Presence visual system

Branch: `local/jarvis-cinematic-presence-v3-2026-08-21` from exact
`5315ebb0990d32ec40af2519e4eb16f75ff06eb7`. Did not modify `main`.

Primary URL: `http://127.0.0.1:3000/jarvis`  
Ambient: `http://127.0.0.1:3000/jarvis?mode=ambient`  
Control Center: `http://127.0.0.1:3000/jarvis-lab`  
Fixture example: `http://127.0.0.1:3000/jarvis?visualScene=research`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** is not claimed.

- Structured Presence Core (nucleus/rings/nodes), not the lab particle field.
- Contextual HUD composition with permission and Emergency Stop override.
- Research stages mapped from existing SSE events; leftover sources stay off idle.
- Fixtures require `visualScene` and stay labelled DEVELOPMENT FIXTURE.

See `docs/JARVIS_CINEMATIC_PRESENCE.md`.

## This turn — Presence-first interface

Branch: `local/jarvis-presence-interface-2026-08-21` from exact
`a28265ffcbcf125feb4e6ac38182ddc41e48c86c`. Did not modify `main`.

Primary owner URL: `http://127.0.0.1:3000/jarvis`  
Control Center (preserved): `http://127.0.0.1:3000/jarvis-lab`

Labels: **IMPLEMENTED** + **UNIT_VERIFIED**. **OWNER_VISUAL_VERIFIED** is not claimed.

- Presence is the default living assistant: Core, operational phase, voice/text, contextual HUD.
- `/jarvis-lab` is the advanced Control Center; Tasks/Security/System/Activity/Evolution remain.
- Yes/Allow Once binds one exact pending confirm or grant. Not a global approval.
- Ambient: `/jarvis?mode=ambient`. `Ctrl+.`. Open Control Center by speech or `Ctrl+Shift+L`.
- OPEN Cursor is allowlisted. SEE/CLICK/TYPE/SUBMIT and CCTV stay PREPARE_CONTRACT.
- Verification: `npx tsc --noEmit` PASS; `npm run test:cloud` **578 / 578**.

See `docs/JARVIS_PRESENCE_INTERFACE.md`.

## This turn — Local acceptance completion

Branch: `local/jarvis-acceptance-completion-2026-08-21` from exact
`0cd7b0da462ae0f5baf083c05db81ea9f94100c0`. Did not modify `main` or rewrite
the journal recovery branch.

Labels: **CODE_FIXED** + **UNIT_VERIFIED** + **LIVE_VERIFIED** (HTTP/SSE/goals).
**OWNER_VERIFIED** is not claimed. Dashboard:
`http://127.0.0.1:3000/jarvis-lab`.

- Self Knowledge: setup / unavailable / permission / gap / PowerShell questions
  now answer from Capability Intelligence evidence. Live HTTP confirmed both
  previously failing queries.
- Command Center presents `WAITING_PERMISSION` ahead of `WAITING_INPUT`.
- LA-019 HTTP live turns PASS. Public research executed via `research.current`
  (morning harness had `research: false`).
- LA-020 HTTP continuation + Allow Once via `/api/jarvis/command-center/grant`.
  Windows toast remains **BLOCKED**. Restart/expiry remain unit-only this pass.
- SSE: connect, increment, unique seq, 15s heartbeat, replay/redaction.
- WorldIntel: healthy + bounded `intel_status`. Unit tests keep `worldIntel: false`.
- Verification: `npx tsc --noEmit` PASS; `npm run test:cloud` **571 / 571**;
  `npm run build` PASS.

See `docs/JARVIS_LOCAL_ACCEPTANCE_2026-08-21.md`.

## This turn — Persistent execution journal recovery

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for the reconstructed journal.
**OWNER_VERIFIED** / **LIVE_VERIFIED** are not claimed.

Starting checkout: `local/jarvis-acceptance-2026-08-20` at
`8aba6b019c436b1e636f32274607015a4dc23e38`, working tree clean. Path B: no
unpublished GPT Work journal existed locally. `origin/work/jarvis-pending-goal-continuation`
matched `38709c4ebe9e34c5aaa38b9cc93f902b75a1e407`. Created
`local/jarvis-journal-recovery-2026-08-21` from that exact SHA.

Local verification on this branch (2026-08-21, owner Windows):

- `npx tsc --noEmit` PASS
- `node --import tsx --test tests/jarvis_execution_journal.test.ts tests/jarvis_execution_recovery.test.ts` 28 then 29/29 after WorkAgent id sanitization
- `npm run test:cloud` **565 / 565 PASS** (previous published baseline was 545; this branch adds journal coverage)
- `npm run build` PASS (known Vite CoreScene chunk warning and esbuild `import.meta` CJS warning; not treated as failure)

Bugs found while verifying:

- `tests/jarvis_intent.test.ts` spawned live WorldIntel MCP from `createStandaloneCapabilityHost()` with default options, which kept the Node test worker alive and hung `npm run test:cloud` on Windows. Isolated the host with `worldIntel: false`.
- WorkAgent `requestId` values contain `:`, which failed journal schema validation and made reminder continuation `FAILED` instead of `COMPLETED`. Journal operation ids are now sanitized.

See `docs/JARVIS_EXECUTION_JOURNAL.md` and
`docs/JARVIS_LOCAL_ACCEPTANCE_2026-08-21.md`.

Local acceptance on this Windows machine used disposable fixtures only:

- LA-015 / LA-017 / Journal C: PASS via real temp-dir persistence (not HTTP UI)
- LA-001 hello / recursion / `สถานะระบบ`: PASS against local Ollama
- Research request routed RESEARCH/agentic but had no verified executable route in the harness
- Self-knowledge CCTV honesty PASS; setup-question classifier FAIL
- `/jarvis-lab` UI/SSE: NOT_RUN

`BLOCKED_LOCAL_ACCEPTANCE.md` is not upgraded to LIVE_VERIFIED for dashboard-complete procedures.

- Added `src/jarvis/executionJournal` with validated transitions, fingerprints,
  SQLite persistence, unique idempotency, checkpoint binding, and fail-closed
  corrupt-schema handling.
- Wired the journal through Trusted Operator, ActionGate, and the recovery
  sandbox. `CHECKPOINTED` no longer auto-mutates after restart.
- Rollback remains a separate journaled operation. Model identity cannot set
  journal state. Journal cannot grant permission or revive leases.

## This turn — Secure pending-goal continuation


Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for cloud-safe declared-goal
continuation. **OWNER_VERIFIED** and live owner-machine/provider verification are
not claimed.

Branch: `work/jarvis-pending-goal-continuation` from exact remote source
`work/jarvis-goal-catalog-input-adapters` at
`a7a11f5e8cafe17f26d1cece7e6f6bb4bad99b03`.

- Added an expiring, scope/session-bound PendingGoal record and optional SQLite
  store. Persisted context is redacted and contains no permission, lease,
  confirmation, credential, or model authority.
- Added typed one-field continuation, cancellation, explicit revision, goal
  drift detection, multi-pending disambiguation, cross-session explicit
  selection, bounded receipt idempotency, and restart-safe context reload.
- WorkAgent now represents `WAITING_INPUT` and `EXPIRED`, preserves the same
  task, and rebuilds a current bounded plan without replaying mutations.
- Resume re-runs GoalCatalog/adapters, capability availability, Gap Resolver,
  Emergency Stop, ActionGate, permission, lease, containment, and verification
  boundaries. An in-process claim serializes concurrent duplicate resumes.
- Reminder creation now has a deterministic registered verifier that re-reads
  the isolated store. The tested continuation waits for Allow Once, creates one
  reminder, verifies its typed state, and does not duplicate on retry.
- Home and Task Center show the human waiting question; IDs, missing fields,
  adapter/route evidence, and expiry stay in Expert Details.

Verification: focused goal/continuation suite **39/39**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **545/545**; production client and
server build PASS with the pre-existing CoreScene chunk and CJS `import.meta`
warnings. Windows, owner files, actual reminder delivery, browser visuals,
CCTV/RTSP/ONVIF, Ollama/GPU, phone/screen/voice, and Whonix remain
`BLOCKED_LOCAL_ACCEPTANCE`.

## This turn — Authoritative Goal Catalog and typed input adapters

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for existing cloud-safe workflows.
**OWNER_VERIFIED** and live owner-machine/provider verification are not claimed.

Branch: `work/jarvis-goal-catalog-input-adapters` from exact remote source
`work/jarvis-capability-intelligence` at
`deab0bb96a02ab0465171221b97c0be0e8b58ca8`.

- Added one authoritative GoalCatalog for research, workspace, basic indexed
  documents, Jarvis/system health, reminder creation, capability Self Knowledge,
  gap explanation, and honest owner-only CCTV preparation.
- Added capability-bound trusted input adapters and JSON-schema validation.
  Adapters cannot add paths, credentials, capability IDs, permissions,
  confirmation, shell/command, risk, privilege, or admin authority.
- Intent resolution preserves existing fast-path behavior while attaching goal,
  route, typed input, rejected alternative, permission, and verification
  evidence. Unknown/ambiguous objectives do not become supported.
- WorkAgent consumes the declared route and can try a bounded compatible safe
  alternative. Higher-risk/private routes stop for owner decision.
- Goal outcome evidence is separate from capability competence. A failed first
  capability remains a failure even when an alternate route completes the goal.
- Self Knowledge and System/Task Center expose end-to-end goal readiness and
  adapter evidence with technical IDs under Expert Details.

Verification: focused goal/intent/capability/runtime suite **65/65**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **517/517**; production client and
server build PASS with the pre-existing CoreScene chunk and CJS `import.meta`
warnings. Windows, owner filesystem, actual reminder delivery, Ollama/GPU,
browser visuals, CCTV/RTSP/ONVIF, phone/screen/voice, and Whonix remain
`BLOCKED_LOCAL_ACCEPTANCE`.

## This turn — Capability Intelligence and Self Knowledge

Labels: **IMPLEMENTED** + **UNIT_VERIFIED** for cloud-safe Core paths.
**OWNER_VERIFIED** and live provider/hardware verification are not claimed.

Branch: `work/jarvis-capability-intelligence` from exact remote source
`work/jarvis-execution-recovery-hardening` at
`2d72ef59c95ac3b64a6fd30d7594ac66a783aac5`.

- Added evidence-backed Self Knowledge over the existing CapabilityHost,
  CapabilitySelfModel, model profiles/certifications, and provider/service state.
- Added Capability Graph, structured GapResolutionPlan, bounded WorkAgent
  blocker/replan integration, and human-readable Assistant/Task/System views.
- Competence now distinguishes verified and unverified success; repeated
  blockers produce weakness signals and Night Cycle requires VERIFIED success
  for skill distillation.
- Capability candidate lifecycle separates discover/review/test/security review/
  verify/owner approve/install/register/enable. It cannot self-promote.
- Prepared owner-only CCTV RTSP/ONVIF/vendor contracts with opaque local secret
  references, strict credential-bearing URL/path rejection, and no LAN scanning.
- Community Edition, setup/model installer, distribution filtering, real CCTV,
  and broad device control remain out of scope.

Verification: focused capability/evolution/WorkAgent/runtime suite **71/71**;
`npx tsc --noEmit` PASS; `npm run test:cloud` **506/506**; production build
PASS with the pre-existing large CoreScene chunk and CJS `import.meta` warnings.
Windows, CCTV/RTSP/ONVIF/NVR, owner LAN, Ollama/GPU, screen/phone, voice,
browser visuals, and Whonix remain `BLOCKED_LOCAL_ACCEPTANCE`.

## This turn — cloud finalization wiring (memory, stream, depth, night resume, grant)

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
