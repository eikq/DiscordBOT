# Cursor Cloud handoff — Presenter + Desktop Presence

Authoritative software-only package after the 2026-08-20 **local** live
acceptance pass. Do not treat this as LIVE_VERIFIED for LA-026/LA-027.
Do not install Tauri, Electron, Rust, or a Windows service until the owner
approves the architecture below.

Do **not** include or commit `.env`, tokens, `ops.db` / `work.db` /
`evolution.db` / `jarvis.db`, `.runtime/acceptance/*`, or private voice data.

---

## 1. LOCAL BASELINE

- Branch: `local/jarvis-acceptance-2026-08-20` (no merge, no push from this pass)
- Presenter feature commit: `b2db545`
- Follow-up local-acceptance commit: see `SESSION_STATE.md` HEAD after this pass
- Lab: `JARVIS_STANDALONE=1` `http://127.0.0.1:3010` (Discord not started)
- Simulation: **false**
- Model: `digital-me-qwen38:27b-ad-q4km` (Ollama 0.32.14)
- TTS: Edge-TTS via `StandaloneVoiceRouter` (JaiTTS service offline)
- Tests: `npx tsc --noEmit` PASS; targeted presenter+desktop **21/21**;
  `npm run test:cloud` **498/498** (was 496 at `b2db545`)

### LIVE_VERIFIED

None of LA-001, LA-002, LA-026, LA-027.

### PARTIAL

- **LA-001** — owner-directed PARTIAL. Prior sim-off ask evidence remains
  historical. Remaining includes ask JSON missing `llm.model`.
- **LA-002** — owner-directed PARTIAL. Not OWNER_VERIFIED (LA-013). Ops
  panel can intercept dock Ask.
- **LA-026 Presenter** — real rich/plain selection after isolation fix;
  real Edge-TTS summary; follow-ups (except repeat/back); reduced-motion
  class. Speech↔motion sync **not** proven.
- **LA-027 Desktop** — **NATIVE_SHELL_REQUIRED**. Real 2-display enum
  after timeout fix. Browser host cannot move the tab. Window movement
  is not LIVE_VERIFIED.

Do not start LA-003+ (Whonix / Discord / CCTV / PRIVATE_BROWSER).

---

## 2. PRESENTER EVIDENCE

### Selection

| Turn | Result |
| --- | --- |
| `hello` | plain, no briefing |
| `สถานะระบบ` | rich / report / **System status** from live `system.status` |
| research Qwen docs | briefing / comparison, untrusted public URLs |
| compare without the word `research` | CONVERSATION; LLM said it lacked metrics |

First live pack attached leftover `researchSnapshot().last` to every
briefing. Isolation fix: only RESEARCH / `research.search` may attach
research. After the fix, diagnostic Presenter showed real telemetry, not
stale Qwen sources.

Browser Presenter (dock ask, Speak on):
`requestId=jarvis-1787236162758`. Title **System status**. Executive
summary = CPU/RAM/Disk/GPU RTX 5090 Laptop / battery unavailable / wifi.
Sections: `sec-summary` (+ follow-up before shorten). **No GPU card /
per-metric section**, so “focus GPU while GPU is spoken” cannot be shown.

### Real TTS

- Provider: **Edge-TTS** (`sourceEngine=edge`). UI: “Jarvis native voice
  uses Edge-TTS. Speech is ready.”
- Timed speak (API retest): `sourceTtsMs=3006`, `totalMs=3009`,
  `mime=audio/mpeg`, profile `jarvis`.
- Spoken text = `spokenSummary` (“Here is the report. CPU …”), **not**
  the raw document.
- Only the summary is synthesized. Narration **segments are not spoken
  in order**.
- `scaleNarrationToSpeech` exists but lab never passes `spokenMs`.
- Pause: `POST /api/jarvis/speak/cancel` exists; not fully exercised.
- Repeat chip does **not** re-speak.

### Motion synchronization — PARTIAL

UI clock: `spokenAtMs` ticks every 250ms only while Presenter is open
and `reducedMotion` is false. It is **not** tied to TTS start/end.
Estimates ~150 wpm. Edge-TTS has **no word timings**. Segment sync is
acceptable in contract but **not live-proven**.

Diagnostic briefing has no distinct GPU/evidence targets.

### Follow-ups

Client-only `applyBriefingFollowUp`. Live: Explain → subtitle
`Explained`; Expand → `Expanded`; Shorten removes the Follow-up section.
**No new WorkAgent / capability invoke.** Repeat / Go back return the
same model. `show-source` / recommendations appear only when the model
has evidence/actions (diagnostic did not).

### Reduced motion

Emulated `prefers-reduced-motion: reduce` → class `jcc-presenter is-reduced`.
`sec-summary` kept static `is-focused`. Content remained fully readable.
Pulse/zoom skipped in `visibleMotionCues` (unit-tested). Narration path
unchanged.

---

## 3. DESKTOP EVIDENCE

### Real topology (Windows `Screen.AllScreens`)

`config/jarvis/displays.json` is absent. Scale factor is **not** exposed
by this API.

| id | name | primary | bounds | working area |
| --- | --- | --- | --- | --- |
| `\\.\DISPLAY1` | DISPLAY1 | false | x=-3840,y=-6, 1920×1200 | 1920×1152 |
| `\\.\DISPLAY5` | DISPLAY5 | true | x=0,y=0, 1920×1080 | 1920×1032 |

Aliases from parser: device id + index `"1"` / `"2"` only.

`config/jarvis/displays.example.json` maps DISPLAY1→notebook and
DISPLAY2→external. **Do not copy it onto this machine** — primary here
is DISPLAY5, and DISPLAY1 is the left/non-primary screen.

### Live capability (after timeout fix)

Root cause of empty enum: capability `timeoutMs` was **4000** while
PowerShell `Add-Type` + `AllScreens` takes **~6–9s**. Spawn timeout was
already 15s. Fix: list/get **18s**, write **20s**.

After restart:

- `มีกี่จอ` → presented **“2 displays visible.”** (~5885ms),
  `capabilityId=desktop.listDisplays`, status ok
- `ตอนนี้นายอยู่จอไหน` → **“Jarvis lab is on DISPLAY5 (client-report).”**
  (~6162ms)

Briefing spoken line can still say “0 displays / unknown display”
because `buildBriefing` uses presence snapshot, not the capability
result. **CLOUD_IMPLEMENTATION_CANDIDATE.**

### Current-window awareness — BROWSER_HOST_LIMITATION

`GET/POST /api/jarvis/presence`:

- `hostKind=browser`
- `windowAvailable=true`
- `canMoveWindow=false`
- Client bounds: `x=-1920, y=-3, width=1920, height=1152`

Backend must **not** hunt Chrome/Edge HWNDs.

`displayContaining` uses the report point, then **falls back to
primary**. Window left edge `-1920` sits on the exclusive right edge of
DISPLAY1 / in the gap before DISPLAY5. **DISPLAY5 can be a false
match.** Honest answer should be “unknown display” until matching
improves.

### Own-window movement — fail-closed, not LIVE_VERIFIED

- `desktop.moveJarvisWindow` / `setJarvisWindowBounds` /
  `focusJarvisWindow` are `CONFIRM_REQUIRED` and Jarvis-window-only.
  `hwnd` / `processName` / `windowTitle` rejected.
- Live move waited for permission, then `task_8e8dee98a123` **FAILED**
  after grant (empty enum at that time). Not a fake success.
- Focus wait `task_3fab64116c52` cancelled by QA. No other-app mutation.
- Unit tests: after confirm, browser host returns `UNSUPPORTED_HOST`.
  That is the acceptable fail-closed result once displays resolve.

---

## 4. ARCHITECTURE DECISION (Proposed — not installed)

Intended product:

```
Jarvis Desktop Shell
  → owns native HWND(s)
  → Presentation React UI (reuse Presenter)
  → existing localhost HTTP/SSE Jarvis runtime
  → desktop provider mutates ONLY the shell window
```

Thai target UX (needs owner `displays.json` aliases, not invented names):

1. “ตอนนี้นายอยู่จอไหน” → `getJarvisWindow` + topology → speak real display
2. “ย้ายตัวเองไปจอโน้ตบุ๊ก” → resolve owner alias → ActionGate → move
   **own** window → verify bounds → speak
3. “เปิด Presenter เต็มจอที่จอหลัก” → move own presenter window →
   fullscreen on selected display → narrate

Future multi-window (do not overbuild): **CONTROL WINDOW** (conversation)
and **PRESENTER WINDOW** (fullscreen briefing). Both are views of **one**
runtime/session. No second autonomous Jarvis.

### Compare (not installed)

| | Native helper | Tauri | Electron |
| --- | --- | --- | --- |
| Own HWND | Yes (explicit adapter) | Yes | Yes |
| Multi-monitor | Win32 / Forms | Yes | Yes |
| Move/resize/focus | Only injected window | Yes | Yes |
| Fullscreen presenter | Yes | Yes | Yes |
| Second window | Optional later | Easy | Easy |
| RAM | Smallest | Medium | Heaviest (second Chromium) |
| Security | Fail-closed if helper absent; Jarvis-window-only IPC | Must lock IPC to own window | Same + huge attack surface |
| Build | Small helper + `NativeJarvisWindowAdapter` | Rust toolchain | Extra Node+Chromium runtime |
| Reuse React Presenter | Load existing `/jarvis-lab` | Bundle or URL | Bundle or URL |
| Talk to current runtime | localhost HTTP/SSE | localhost HTTP/SSE | localhost HTTP/SSE |

This repo is Express + React. `package.json` has **no** Electron/Tauri.
`JarvisWindowHost` already branches `browser` | `native-helper` | `electron`
and fail-closes without `native.setBounds`.

### Recommendation

**Phase 1 (owner review):** minimal **Windows-native helper** that owns
one HWND, hosts or attaches the existing web UI, and implements
`NativeJarvisWindowAdapter` (`listDisplays`, `getWindow`, `setBounds`,
`focus`, `setLayout`). Keep the current dashboard. If the helper is
absent, keep `UNSUPPORTED_HOST`.

**Phase 2 (optional):** Tauri shell if the owner wants a packaged app
and second presenter window with lower RAM than Electron.

**Do not choose Electron** unless the owner explicitly wants a second
Chromium. Do not install anything in Cloud until the owner approves.

Security boundary (frozen):

- CapabilityHost + ActionGate remain the only invoke path
- Presentation never calls tools
- Mutations target **Jarvis-owned windows only**
- Reject `hwnd` / `processName` / `windowTitle` from clients
- Confirm tokens never persist to work.db / ops.db
- No Chrome/Edge process handle theft

---

## 5. CLOUD WORK QUEUE

Software-only. Mocks/fixtures. No physical machine, no secrets.

### C1 — Briefing uses this turn only

- **Objective:** Research/display/system data in the briefing must come
  from the current turn, not leftover snapshots.
- **Current:** Isolation for research is in `labRuntime.buildBriefing` +
  `planner.isResearchTurn()`. Display briefing still says “0 displays”
  after a successful list. Diagnostics omit `systemSnapshot` cards.
- **Files:** `src/jarvis/standalone/labRuntime.ts`,
  `src/jarvis/presentation/briefing/*`
- **Steps:** Pass capability structured result / `systemSnapshot` /
  listed displays into `runPresentationPipeline`. Keep leftover research
  out of CAPABILITY/CONVERSATION.
- **Tests:** extend `tests/jarvis_presentation_briefing.test.ts`
- **Security:** no new tool calls from Presentation
- **DoD:** diagnostic has CPU/GPU cards; listDisplays briefing shows
  real count/ids from the same turn; hello stays plain

### C2 — Per-metric diagnostic model + motion targets

- **Objective:** GPU/CPU/RAM/Disk sections so “GPU utilization” can
  focus a real target.
- **Current:** one executive-summary section
- **Files:** briefing model builder; `PresenterBriefing.tsx`
- **Tests:** planner + motion fixtures
- **DoD:** segment `target.id` matches a visible section/card; no
  invented telemetry

### C3 — TTS segment callbacks + `scaleNarrationToSpeech`

- **Objective:** Drive `spokenAtMs` from real speech, or scale
  estimates to `spokenMs`. Speak segments in section order if product
  wants it; otherwise document summary-only as the v1 contract.
- **Current:** unused scaler; UI clock ≠ TTS
- **Files:** `labRuntime.ts`, `StandaloneVoiceRouter`,
  `JarvisLabPage.tsx`, `narration.ts`
- **Tests:** scaler + no tool invoke during follow-up speak
- **DoD:** no fake word-level timing; Edge-TTS remains summary-level
  unless the provider actually returns marks

### C4 — Implement `repeat` / `back` + optional Presenter speak/cancel

- **Objective:** Repeat re-speaks `spokenSummary` via existing speak
  endpoint; back restores previous follow-up snapshot.
- **Current:** no-ops in `applyBriefingFollowUp`
- **Files:** `followUp.ts`, `PresenterBriefing.tsx`, `JarvisLabPage.tsx`
- **Security:** still no CapabilityHost from Presentation
- **DoD:** unit tests; cancel uses existing speak/cancel

### C5 — Comparison without the word `research`

- **Objective:** Only if product wants “compare A vs B” to research.
  Must go through the normal router / ActionGate, not a silent bypass.
- **Current:** CONVERSATION if `research` is absent
- **DoD:** explicit owner product decision first

### C6 — Honest display matching + briefing copy

- **Objective:** Do not fall back to primary when the point is in a
  gap. Report `unknown display`. Pass enum result into briefing.
- **Files:** `displayNames.ts` `displayContaining`, presence store,
  `labRuntime.buildBriefing`
- **Tests:** fixture bounds including a gap at x=-1920
- **DoD:** no invented friendly names; notebook only from owner map

### C7 — Native-shell **scaffolding + mocks only** (if owner approves)

- **Objective:** Types/contract for CONTROL + PRESENTER windows; mock
  `NativeJarvisWindowAdapter`; fail-closed without helper.
- **Do not** add Tauri/Electron/Rust dependencies in Cloud.
- **Files:** `src/jarvis/desktop/*`, tests
- **Security:** Jarvis-owned window ids only; no process/title targeting
- **DoD:** unit tests for move/fullscreen/restore on the mock adapter;
  browser host still `UNSUPPORTED_HOST`

### C8 — Presence parser hardening

- Already rejects `hwnd` / `processName` / `windowTitle`. Keep tests.
- Optional: persist last briefing on `/api/jarvis/command-center` so
  Presenter survives reload without a new ask.

---

## 6. LOCAL-ONLY QUEUE

Keep only work that needs this Windows machine:

1. Re-verify listDisplays after any further enum changes (cold
   PowerShell `Add-Type` is 6–9s here).
2. Owner writes `config/jarvis/displays.json` with **this** machine’s
   IDs (`DISPLAY1`, `DISPLAY5`) and Thai aliases. Do not invent names.
3. After a native helper exists: live HWND move, restore, presenter
   fullscreen on a chosen display, confirm no other-app windows move.
4. Owner visual sign-off (LA-013) and LA-026 motion/TTS if Cloud lands
   segment sync.
5. Optional: DPI/scale factor if Windows exposes it (current Forms
   path does not).

---

## 7. NEXT FLOW

LOCAL (this pass) → evidence + architecture → **STOP**  
CURSOR CLOUD → C1–C8 (no install unless owner approves scaffolding)  
LOCAL later → native-window live acceptance only

Do not merge to main from Cloud unless the owner asks.
