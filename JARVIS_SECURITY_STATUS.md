# Jarvis security status

Updated: 2026-08-20

| ID | Item | Status |
|---|---|---|
| SEC-000 | Host baseline probe (read-only) | IMPLEMENTED + LOCALLY_TESTED |
| JF-014.5 | Privilege leases + no generic shell | IMPLEMENTED + LOCALLY_TESTED |
| JF-014.55A | VirtualBox + Whonix provision | IMPLEMENTED host path: VBox `7.2.16r174877` installed; official OVA SHA512 + OpenPGP OK; Gateway+Workstation imported and isolated. First-boot legal/security ack **OWNER_ACTION_REQUIRED**. LIVE_TESTED Tor not claimed |
| JF-014.55B | Playwright worker + dedicated Chromium | IMPLEMENTED policy + worker package; guest Node/Playwright **not** installed yet. Live health: VMs up, isolation OK, `available=false` / `LIVE_TOR_CHECK_REQUIRED` |
| JF-014.55C | Deep research + SSRF/injection | IMPLEMENTED + LOCALLY_TESTED on policy/depth; live DEEP browse not available |
| JF-014.6 | Operations event bus + SSE | IMPLEMENTED + UNIT_VERIFIED (seq, replay, heartbeat, redaction). Command Center EventSource wired; browser SSE live-QA **BLOCKED_LOCAL_ACCEPTANCE** |
| JF-015 | Multi-step work agent | IMPLEMENTED + UNIT_VERIFIED (DAG, cancel, pause, permission, simulated demos). Live tool/Ollama runs **BLOCKED_LOCAL_ACCEPTANCE** |
| EVO-001–010 | Evolution / affect / LoRA | IMPLEMENTED + UNIT_VERIFIED fail-closed runtime (no auto-promote, LoRA registry untrained, affect cannot authorize). Queue 04 Procedural Skills V2: DRAFT/REVIEW_REQUIRED/TRUSTED; Jarvis cannot self-approve. Live night cycle **BLOCKED_LOCAL_ACCEPTANCE** |
| JF-016 | Vision architecture | IMPLEMENTED + UNIT_VERIFIED simulated fixtures (see ≠ click/type/submit). Live screen capture **BLOCKED_LOCAL_ACCEPTANCE** |
| JF-017 | Proactive monitor | IMPLEMENTED + UNIT_VERIFIED (quiet hours, cooldown, aggregation) |
| JF-018 | Device VIEW-only | IMPLEMENTED + UNIT_VERIFIED simulated devices. Live CCTV **BLOCKED_LOCAL_ACCEPTANCE** |
| Sysmon | Optional host telemetry | NOT_IMPLEMENTED (intentionally skipped) |
| Gitleaks | Official Windows x64 8.30.1 | Present under `.runtime/tools/gitleaks/gitleaks.exe` (not a live host-hardening install) |

## Explicit non-actions

- BitLocker was **not** enabled.
- Device Encryption was **not** enabled.
- Windows security controls were **not** weakened.
- No UAC bypass.
- No owner browser profile used.
- No commit / push / reset / clean of owner secrets, `.env`, or user data.
