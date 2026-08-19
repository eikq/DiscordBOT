# Jarvis security status

Updated: 2026-08-19

| ID | Item | Status |
|---|---|---|
| SEC-000 | Host baseline probe (read-only) | IMPLEMENTED + LOCALLY_TESTED |
| JF-014.5 | Privilege leases + no generic shell | IMPLEMENTED + LOCALLY_TESTED |
| JF-014.55A | VirtualBox + Whonix provision | IMPLEMENTED host path: VBox `7.2.16r174877` installed; official OVA SHA512 + OpenPGP OK; Gateway+Workstation imported and isolated. First-boot legal/security ack **OWNER_ACTION_REQUIRED**. LIVE_TESTED Tor not claimed |
| JF-014.55B | Playwright worker + dedicated Chromium | IMPLEMENTED policy + worker package; guest Node/Playwright **not** installed yet. Live health: VMs up, isolation OK, `available=false` / `LIVE_TOR_CHECK_REQUIRED` |
| JF-014.55C | Deep research + SSRF/injection | IMPLEMENTED + LOCALLY_TESTED on policy/depth; live DEEP browse not available |
| JF-014.6 | Operations event bus + SSE readiness | IMPLEMENTED + LOCALLY_TESTED (unit). Command Center live SSE not browser-QA'd |
| JF-015 | Multi-step work agent | NOT_IMPLEMENTED |
| EVO-001–010 | Evolution / affect / LoRA | EXPERIMENTAL foundation only (experience/reflection/skill versions/sandbox). No autonomy |
| Sysmon | Optional host telemetry | NOT_IMPLEMENTED (intentionally skipped) |
| Gitleaks | Official Windows x64 8.30.1 | Present under `.runtime/tools/gitleaks/gitleaks.exe` (not a live host-hardening install) |

## Explicit non-actions

- BitLocker was **not** enabled.
- Device Encryption was **not** enabled.
- Windows security controls were **not** weakened.
- No UAC bypass.
- No owner browser profile used.
- No commit / push / reset / clean.
