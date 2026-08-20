# Cursor local acceptance — next (physical Windows machine)

Cloud sequential queue **01–12 is closed**. This file is the ordered
return-to-host plan. It does **not** claim any live hardware, Discord,
voice, camera, GPU, Tor, or native-helper result from Cloud.

Authoritative evidence labels:

| Label | Meaning |
| --- | --- |
| **CLOUD_COMPLETE** | Software exists; Cloud unit/offline tests passed. Cloud can do no more. |
| **LOCAL_VERIFY_REQUIRED** | Software exists; owner must run it on the Windows machine. |
| **LOCAL_IMPLEMENTATION_REQUIRED** | Scaffolding/contracts exist; a host binary, guest worker, or provider is still missing. |
| **OWNER_DECISION_REQUIRED** | Do not build, install, enable, or live-test until the owner chooses. |
| **BLOCKED_EXTERNAL** | Needs tokens, VMs, network, or hardware Cloud does not have and must not invent. |

Do **not** mark **LIVE_VERIFIED** from this document. Historical local notes
in `BLOCKED_LOCAL_ACCEPTANCE.md` remain history; they do not close owner
acceptance.

---

## Continuation

- Original Cloud base: `8aba6b019c436b1e636f32274607015a4dc23e38`
  (`origin/local/jarvis-acceptance-2026-08-20`)
- Dedicated branch: `cursor/jarvis-cloud-evolution-2026-08-20`
- Confirm tip: `git rev-parse origin/cursor/jarvis-cloud-evolution-2026-08-20`
- Do **not** merge. Do **not** push `main`.
- SQLite stays canonical. Do **not** start Qdrant.
- Do **not** download/install models, native helper, Tauri, Electron, or
  Whonix guest Playwright until the owner approves that step.

Queue pointer: `CURSOR_CLOUD_QUEUE_STATUS.md`.
Per-item live scripts: `BLOCKED_LOCAL_ACCEPTANCE.md`.
Presenter/Desktop cloud detail: `CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.

---

## What Cloud can no longer verify

Cloud Linux has no owner `.env`, Discord token, Ollama, Qwen3-ASR, JaiTTS,
Edge-TTS speaker, RVC, Windows `Screen.AllScreens`, native HWND, VirtualBox,
Whonix, Tor, cameras, phones, or GPU probes. It must not copy credentials
or claim those paths passed.

Simulation, fixtures, and `FakeNativeJarvisHelper` are **never** LIVE.

---

## Classification

### CLOUD_COMPLETE (software; unit / offline)

These are implemented and Cloud-verified as software. Not LIVE_VERIFIED.

- Queue 01 Presenter structured facts, narration model, Repeat/Back,
  display intersection matching, native-helper **contracts/mocks**
- Queue 02 Research Intelligence V2 (plans, trustClass, claims, cache honesty)
- Queue 03 Canonical Memory Intelligence V2 (SQLite canonical; Qdrant not started)
- Queue 04 Procedural Skills V2 (DRAFT / REVIEW_REQUIRED / TRUSTED; no self-approve)
- Queue 05 Model Registry V2 (RESTRICTED never auto-selected; cert FIXTURE_ONLY)
- Queue 06 Realtime voice FSM, barge-in classification, playback clock (**mocks**)
- Queue 07 Perception / screen / CCTV / devices (**SEE ≠ CLICK**, **VIEW ≠ CONTROL**, fixtures)
- Queue 08 Proactive runtime coordinator (no fourth scheduler; Night yields)
- Queue 09 Command Center V2 mode shell (Assistant / Presenter / Operations /
  Memory / Intelligence / Devices; REAL vs SIMULATION chip)
- Queue 10 Privilege-boundary hardening (SSRF incl. IPv4-mapped IPv6;
  forged native IPC fail-closed; untrusted content is not authority)
- Queue 11 Full-system integration: 14 offline fixtures; independent `turnId`;
  distinct failure codes
- Host PRIVATE_BROWSER **fail-closed** policy (no host Playwright fallback)
- Discord/Digital Me **compiling** + compatibility tests (no new Discord features)
- CapabilityHost / ActionGate remain invoke authority; Presentation never tools
- `RECORD_RAW_AUDIO=false` default unchanged

### LOCAL_VERIFY_REQUIRED

Run on the physical Windows machine. Do not skip evidence.

| ID | Item | Depends on |
| --- | --- | --- |
| LA-001 | Final owner Ollama/Qwen `/api/jarvis/ask` acceptance | Local Ollama + lab |
| LA-002 | Command Center visual acceptance (owner browser, not Cloud) | Lab UI |
| LA-026 | Presenter speech↔segment motion, sequential Edge-TTS | LA-002 + Speak |
| LA-008 | Resource priority under live voice (`realtime_voice` > owner > night) | Live voice session |
| LA-007 | Lab microphone, STT, TTS; clone only with consent | ASR/TTS services |
| LA-014 | Live Ollama model discovery vs registry | Ollama |
| LA-015 | Aligned Qwen3.8 27B live benchmark | LA-014 |
| LA-017 | Live capability certification (skip unavailable hardware) | LA-015 |
| LA-018 | Context-retention two-turn Thai+English | LA-015 |
| LA-019 | Windows IME combining marks | Lab + Thai keyboard |
| LA-020 | tokens/sec and latency p50/p95 (n≥5) | Live traces |
| LA-021 | RAM / VRAM / CPU / GPU probes (measured only) | Owner GPU tools |
| LA-022 | Hardware-aware routing (idle, never RESTRICTED) | LA-014–017 |
| LA-025 | Intelligence panel shows real traces, `INSUFFICIENT_DATA` when empty | LA-002 + one live ask |
| LA-013 | Owner visual / UI sign-off | LA-001 + LA-002 |
| LA-003 | Whonix Gateway health | Owner VMs |
| LA-004 | Whonix Workstation / live Tor | LA-003 |
| LA-005 | PRIVATE_BROWSER live through Workstation only | LA-003/004 |
| LA-006 | Existing Discord text + voice path (no new features) | Owner token |
| LA-009 | Real screen capture; click without grant fails | Owner screen permission |
| LA-010 | Proactive Windows monitor cooldown / quiet hours | Owner enable |
| LA-011 | CCTV VIEW; CONTROL/CONFIGURE denied without grant | Owner cameras |
| LA-012 | Phone/device VIEW vs CONTROL | Owner pairing |
| LA-027 | Native Jarvis window move/fullscreen/restore | Helper after owner approval |

LA-001 and LA-002 stay **PARTIAL**. Agent-browser and Simulation-OFF notes in
`BLOCKED_LOCAL_ACCEPTANCE.md` are history, not owner LIVE_VERIFIED.

LA-026 stays **PARTIAL**. Structured cards and Repeat/Back are CLOUD_COMPLETE;
live speech↔motion is not.

LA-027 stays **PARTIAL — NATIVE_SHELL_REQUIRED**. Browser host must keep
returning `UNSUPPORTED_HOST` for move/fullscreen until a real helper exists.

### LOCAL_IMPLEMENTATION_REQUIRED

- **Native Jarvis helper** Windows binary implementing protocol v1
  (`src/jarvis/desktop/nativeProtocol.ts`). Cloud has mocks only
  (`FakeNativeJarvisHelper`, `installed: false`). No installer in this repo.
- Optional later **Tauri** packaged shell (ADR-023 Phase 2). Do **not** add
  Electron unless the owner wants a second Chromium.
- Whonix **guest** Node + Playwright worker (JF-014.55B). Host stays fail-closed.
- Real **artifact/video provider** if the owner wants LA-024 (simulator remains default).

Do not implement these from Cloud. Do not install them from this pass.

### OWNER_DECISION_REQUIRED

- Approve **build/install** of the native helper (required before LA-027 movement)
- Whether `llm.model` must appear on the `/api/jarvis/ask` JSON (LA-001 leftover)
- Copy `config/jarvis/displays.example.json` → `displays.json` **after remapping
  this machine’s device ids** (do not commit; primary was `DISPLAY5` on 2026-08-20)
- Start **Discord** live checks at all (Jarvis-first defers new Discord work;
  LA-006 is existing-path verify only)
- Enable **RVC clone** (consent + mapping; never represent as the real person)
- Pair **CCTV / phone** hardware
- Whonix first-boot **legal/security ack**
- Optional **LA-016** RESTRICTED uncensored specialist benchmark (never security authority)
- Optional **LA-023** MoneyPrinterTurbo review (`installed: false` until then)
- Unattended **Night coding** on this host
- Product: operations panel intercepts dock Ask — not an LA-002 closer
- Keep Qdrant off; keep BitLocker/Device Encryption **not** enabled by Jarvis

### BLOCKED_EXTERNAL

- Owner `.env` / Discord token (Cloud must not copy or invent)
- Live Tor / Whonix NICs
- Qwen3-ASR, Edge-TTS/JaiTTS, RVC processes
- Windows display geometry and HWND
- Camera credentials, phone pairing
- GPU VRAM probes
- Owner Chrome profile (do not use Cloud or a stolen profile)

---

## Ordered local tests (physical Windows)

Prioritized by dependency. Stop and record `reasonCode` on failure.
Simulation OFF for live claims. Demos stay labeled SIMULATION.

### 0. Fetch the Cloud branch (no merge)

```powershell
git fetch origin
git checkout cursor/jarvis-cloud-evolution-2026-08-20
# Do not merge to main. Cherry-pick onto local/jarvis-acceptance-2026-08-20 if preferred.
$env:JARVIS_STANDALONE = '1'
npm ci
npx tsc --noEmit
npm run test:cloud
```

Start the owner’s usual lab (`npm run start:local` / existing `:3010`).
Do not start Discord unless you are on LA-006. Do not start Qdrant.

### 1. LA-001 — owner Ollama / Qwen path

Preconditions: Ollama up; current `.env` model pulled.

1. `hello` → `CONVERSATION`, no WorkAgent `taskId`.
2. `explain recursion` → `INFORMATION`, no work.db task.
3. Unique uncached `research …` → `RESEARCH`, WorkAgent, untrusted sources.
4. `สถานะระบบ` → `CAPABILITY` / `system.status`, not a greeting.

Owner decides whether missing `llm.model` on ask JSON still blocks LIVE_VERIFIED.

### 2. LA-002 — Command Center visual (owner browser)

Load `http://127.0.0.1:3010/jarvis-lab`.

1. One primary body at a time: Assistant, Presenter, Operations, Memory,
   Intelligence, Devices.
2. Global chip: REAL / SIMULATION / DEGRADED / OFFLINE. Simulation never looks live.
3. SSE connect, hidden-tab pause, reconnect replay; `seq <= lastSeq` dropped.
4. Real task DAG + permission wait (Grant once / wrong token / cancel).
5. No chain-of-thought, scratchpad, confirm tokens, `.env`.

### 3. LA-019 / LA-025 — Thai IME + Intelligence honesty

Type `น้ํา` / tone marks into lab Ask and `npm run jarvis:ask`.
Intelligence empty analyzer stays `INSUFFICIENT_DATA`. Live traces show
`requestId` / route only.

### 4. LA-026 — Presenter speech↔motion

1. `hello` stays plain (no briefing).
2. `สถานะระบบ` → rich CPU/RAM/Disk/(GPU if present) cards.
3. Speak ON: Edge-TTS uses `spokenSummary`; sections advance with `spokenAtMs`.
4. Repeat / Back seek this briefing only (no new DAG).
5. `prefers-reduced-motion: reduce` → static focus, no pulse/zoom.
6. `มีกี่จอ` must not say “0 displays” after a 2-display list.

### 5. Voice return test (LA-007 + FSM)

See [Voice return test](#voice-return-test) below. Do this before LA-008.

### 6. LA-008 — resource priority

With a live voice session: start an eligible Night cycle. Night must
`pausedFor=realtime_voice`. Owner task still runs. No GPU steal for
background evolution.

### 7. Model stack (LA-014 → 015 → 017 → 018 → 020 → 021 → 022)

Discover installed models. Unknown stay `unverified`. RESTRICTED never
auto-selected and never `securityAuthority`. Cloud cert remains FIXTURE_ONLY
until a live run. Omit RAM/VRAM if not probed.

### 8. LA-027 browser honesty (before any helper)

`desktop.moveJarvisWindow` / fullscreen on the Express+Chrome/Edge host
must be `UNSUPPORTED_HOST` after ActionGate confirm. Never fake `moved`.
Gap geometry (`x=-1920` between DISPLAY1 and DISPLAY5) → `UNKNOWN_DISPLAY`,
not a silent primary match.

Then, **only if the owner approved a helper**, run
[Native window return test](#native-window-return-test).

### 9. Whonix (LA-003 → 004 → 005)

Start Gateway alone first. Workstation second, Internal `Whonix` NIC only.
`tor=up` only after a real Tor check. Host `/api/jarvis/private-research`
stays fail-closed. Guest Playwright is LOCAL_IMPLEMENTATION_REQUIRED until
installed.

### 10. Existing Discord (LA-006) — optional, owner decision

Text reply; voice join; IGNORE / REACT / SPEAK timing. No new Discord
features. Consent and `RECORD_RAW_AUDIO=false` unchanged. No evolution
row per message.

### 11. Perception / devices (LA-009 → 010 → 011 → 012)

SEE ≠ CLICK. VIEW ≠ CONTROL. Offline hardware is UNAVAILABLE, not fabricated
frames. Anomaly pipeline never auto-acts.

### 12. Optional / owner-gated

- LA-016 RESTRICTED specialist benchmark
- LA-023 MoneyPrinterTurbo review
- LA-024 real artifact pipeline (ARTIFACT READY ↛ publish)
- LA-013 owner sign-off after the above the owner cares about

---

## Native window return test

Helper scaffolding exists. **There is no Windows installer in this repo.**
`FakeNativeJarvisHelper` is tests-only and always `installed: false`.

### Build / install — OWNER_DECISION_REQUIRED

Do **not** build, download, or install a helper from Cloud or from this
document automatically.

When the owner explicitly approves a local implementation:

1. Implement `NativeJarvisWindowAdapter` against protocol **v1**
   (`NATIVE_HELPER_PROTOCOL_VERSION = 1`).
2. Transport: loopback IPC only (`127.0.0.1`). No generic shell/exec.
3. Auth: ephemeral owner token, never persisted, never logged, never committed.
4. Reject argument keys: `hwnd`, `processName`, `windowTitle`, `pid`,
   `shell`, `exec`.
5. CONTROL and PRESENTER are **roles of one runtime/session**, not two Jarvises.
6. Absent/forged/replay/impersonation → fail-closed
   (`UNSUPPORTED_HOST` / `FORGED_IPC` / `REPLAY_DETECTED` /
   `HELPER_IMPERSONATION` / `INVALID_TARGET`).

### Exact live sequence (after an approved helper is running)

Record `requestId`, `taskId`, `reasonCode`. Do not claim success without JSON.

1. **Start helper** on loopback. `HEALTH` → `ready`, protocol 1.
2. **Register** the Jarvis-owned window with roles CONTROL and PRESENTER
   for this `runtimeId` + `sessionId` only.
3. **Detect current display** via `desktop.listDisplays` +
   `desktop.getJarvisWindow` / `POST /api/jarvis/presence`.
4. **Move** the owned window to the second monitor
   (`desktop.moveJarvisWindow` after owner Grant once).
5. **Fullscreen Presenter** (`setJarvisLayout` `presenter` / `FULLSCREEN`)
   on that display.
6. **Restore** original display + layout (`RESTORE` / `restore`).
7. **Reject** arbitrary external targets: foreign `windowId`, `hwnd`,
   `processName`, `windowTitle`, `pid` → `INVALID_TARGET` or
   `FORBIDDEN_ARGUMENT`. Browser-hosted Chrome/Edge without helper remains
   `UNSUPPORTED_HOST`.

Copy display aliases only after remapping real ids. Example file uses
fictional `DISPLAY-EXAMPLE-SECOND`. Do not commit `displays.json`.

---

## Voice return test

Mocks in `tests/jarvis_realtime_voice.test.ts` are **not** live proof.
`RECORD_RAW_AUDIO` stays false. Do not commit WAVs.

### Preconditions

- Real microphone permitted in the owner browser for `/jarvis-lab` only
- Qwen3-ASR (or current standalone STT) reachable
- Edge-TTS or JaiTTS reachable; typed Speak default **off**
- Simulation OFF for live claims

### Exact sequence

1. **Mic → STT:** speak a short Thai+English phrase. Transcript appears.
   PCM is not written to disk. `turnId` is a mic turn; Core `requestId`
   may be seeded from that speech turn (typed asks keep independent `turnId`).
2. **TTS:** typed Speak ON for one turn. Payload is `spokenSummary` / spoken
   text, not hidden reasoning. Core stays TTS-free.
3. **Barge-in:** while speaking, say `stop` / a question / a Thai correction
   (`ไม่ใช่ แก้เป็น …`) / a new command. Playback cancels on stop.
   Mutating WorkAgent apply is **not** blindly cancelled.
4. **Presenter sync:** with a briefing open, `spokenAtMs` follows the audio
   element. Estimate timer does not override active speech. One playback clock.
5. **Persona / voice independence:** `selectPersona` must not change the RVC
   / voice profile; `selectVoice` must not load persona memory. Live Discord
   `/voice` coupling is unchanged and deferred.
6. **Priority:** live voice ⇒ Night background evolution yields
   (`realtime_voice`).
7. **Clone:** only with standalone consent + mapping. Generated audio is not
   the real person. Skip entirely unless the owner opts in.

Failure evidence: STT probe, speech router result, consent store (no WAVs),
`reasonCode` (`PROVIDER_UNAVAILABLE` vs `TIMEOUT` vs `UNSUPPORTED_HOST`).

---

## Security invariants (do not weaken)

- LLM output ≠ execution
- CapabilityHost / ActionGate authoritative
- Jarvis cannot approve itself
- web / model / skills / vision = untrusted data
- No unrestricted production shell
- No automatic LoRA training / skill promotion / restricted-model routing
- Traces omit CoT, scratchpads, confirm tokens, credentials, cookies, `.env`
- Simulation is never LIVE

---

## Stop conditions

Stop for missing secrets, consent, irreversible VM/disk changes, helper
install without approval, or conflicting product requirements.

Cloud must **not** start another feature queue automatically.
