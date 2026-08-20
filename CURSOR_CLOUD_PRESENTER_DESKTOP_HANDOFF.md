# Cursor Cloud handoff — Presenter + Desktop Presence (return to Windows)

Cloud implementation pass completed 2026-08-20. This file is the
exact handoff back to the physical Windows machine.

Do **not** treat any item below as LIVE_VERIFIED. Cloud cannot perform
physical-machine acceptance. Do not install Tauri, Electron, or a native
helper from this pass.

Do **not** include or commit `.env`, tokens, `ops.db` / `work.db` /
`evolution.db` / `jarvis.db`, `.runtime/acceptance/*`, private voice
data, or the owner’s real `config/jarvis/displays.json`.

---

## A. Source base SHA

`8aba6b019c436b1e636f32274607015a4dc23e38`

Remote: `origin/local/jarvis-acceptance-2026-08-20`

Commit: `fix(jarvis): isolate Presenter research bleed and raise display enum timeout`

## B. Cloud branch

`cursor/jarvis-presenter-desktop-cloud-2026-08-20-4838`

Do not merge. Do not push `main` or rewrite the local acceptance branch.

## C. Final cloud HEAD

`6a7bac4216d625cfc2c50528918c7a47c34099f8`

## D. Commits (this pass only)

| SHA | Message |
| --- | --- |
| `98a55be` | feat(jarvis): add display intersection matching and native window contracts |
| `bcc3770` | feat(jarvis): drive Presenter from structured facts and TTS narration |
| `f5a9eb3` | feat(jarvis): route supplied-data comparisons without web research |
| `9ca981a` | test(jarvis): add Presenter and Desktop cloud regression coverage |
| `6a7bac4` | docs: record Presenter/Desktop cloud implementation handoff |

## E. Files / features changed

- Structured capability facts: `src/jarvis/capabilities/capabilityFacts.ts`
- Presentation model / narration / playback / authority
- Lab briefing merge + TTS duration scaling
- `/jarvis-lab` Presenter UI speech-driven `spokenAtMs`, Repeat/Back seek
- Display intersection geometry (no primary fallback)
- Owner alias schema (`displays.example.json` uses fictional ids only)
- Native helper protocol, ownership registry, fake adapter
- Comparison intent (`supplied_data` vs `needs_external_facts`)
- Ollama `LlmTurnMetrics.model`
- Tests: `tests/jarvis_presenter_desktop_cloud.test.ts` plus updates to
  briefing/desktop tests

## F. Presenter context fix — IMPLEMENTED + CLOUD_VERIFIED

`system.status` and `desktop.listDisplays` structured results become
typed facts. PresentationPlanner uses those facts, not leftover prose
and not leftover `researchSnapshot().last`.

- CPU / RAM / Disk / GPU cards (`system.cpu` … `system.gpu`)
- GPU card omitted when GPU is absent
- Display briefing uses the real count (does not say “0 displays” after
  a 2-display list, and get-window `count: 0` cannot overwrite it)

Research isolation from `8aba6b0` is preserved.

**NEEDS_LOCAL_VERIFY:** live `สถานะระบบ` / `มีกี่จอ` Presenter cards.

## G. TTS / narration sync — IMPLEMENTED + CLOUD_VERIFIED (unit)

Typed `NarrationPlaybackState`. Spoken text is the concise sequence:
overview → up to four section clips → finish. `applySpokenDuration` /
`scaleNarrationToSpeech` match actual speech duration when the client
reports `audio.duration`. UI `ontimeupdate` advances `spokenAtMs`.

Pause is modeled as **unsupported** (`pauseSupported: false`). Cancel
still uses existing speak/cancel. No word-level sync (Edge-TTS has none).

Independent clock ticks only when Presenter is open, not speaking, and
not reduced-motion.

**NEEDS_LOCAL_VERIFY:** real Edge-TTS sequential briefing.

## H. Repeat / Back — IMPLEMENTED + CLOUD_VERIFIED (unit)

Presenter-local. Restores segment index, visual focus, and seeks audio
`currentTime` when a player exists. No WorkAgent / CapabilityHost call.

## I. Monitor matching — IMPLEMENTED + CLOUD_VERIFIED (unit)

Greatest **positive** intersection area. Gap / exclusive-edge (local
evidence `x=-1920` between DISPLAY1 end and DISPLAY5 start) →
`UNKNOWN_DISPLAY`. No silent primary fallback. Negative coordinates
tested.

## J. Native adapter architecture — IMPLEMENTED (contracts) + CLOUD_VERIFIED (mocks)

```
Jarvis Runtime → localhost HTTP/SSE → React Presenter / Command Center
  → NativeJarvisWindowAdapter → Jarvis-owned native window only
```

Operations: `getOwnedWindows`, `getWindowState`, `moveOwnedWindow`,
`resizeOwnedWindow`, `focusOwnedWindow`, `setOwnedWindowLayout`,
`setFullscreen`, `restore`. CONTROL + PRESENTER are roles of **one**
runtime/session.

## K. Helper protocol / scaffolding — IMPLEMENTED (cloud-safe only)

Protocol v1, loopback IPC, bounded commands, no generic shell/exec.
Owner-bound ephemeral token contract exists; tokens are never stored or
logged. `FakeNativeJarvisHelper` is tests-only (`installed: false`).
Absent helper → `UNSUPPORTED_HOST`. Browser host still works.

**Not installed. Not LIVE_VERIFIED.** No Electron. Tauri remains optional Phase 2.

## L. Security tests — CLOUD_VERIFIED (unit)

HWND / processName / windowTitle / pid rejected. Foreign window id →
`INVALID_TARGET`. Browser mutations → `UNSUPPORTED_HOST`. Helper
unavailable fail-closed. Trace redaction omits tokens / CoT.

CapabilityHost + ActionGate remain authoritative. Presentation never
gains tool authority.

## M. LA-001 / LA-002 software review — IMPLEMENTED + CLOUD_VERIFIED (unit)

Acceptance labels stay **PARTIAL**. Not LIVE_VERIFIED.

Already present at `8aba6b0` and still passing in
`tests/jarvis_local_acceptance.test.ts`:

- requestId correlation across research / WorkAgent traces
- actual capability calls in traces (`system.status`)
- Command Center latest-request follows conversation after research
- bounded recent completed DAG
- permission-wait UI / grant-once

This pass added `LlmTurnMetrics.model` from Ollama `payload.model`
(LA-001 remaining software note about missing `llm.model`).

## N. Targeted tests

```
npx tsx --test \
  tests/jarvis_presentation_briefing.test.ts \
  tests/jarvis_desktop_presence.test.ts \
  tests/jarvis_presenter_desktop_cloud.test.ts \
  tests/jarvis_local_acceptance.test.ts
```

**48 / 48 PASS** (unit). Presenter+Desktop subset: briefing 10 + desktop
11 + new cloud file 19 = **40**. LA software review: **8**.

## O. tsc result

`npx tsc --noEmit` **PASS** (exit 0)

## P. Full cloud test count

`npm run test:cloud` **517 / 517 PASS** (was 498 / 498 at `8aba6b0`)

## Q. Remaining local-only acceptance

Keep these labels. Do not upgrade in Cloud.

| Item | Status |
| --- | --- |
| LA-001 | PARTIAL |
| LA-002 | PARTIAL |
| LA-026 Presenter | PARTIAL — software landed; live speech↔motion not proven |
| LA-027 Desktop | PARTIAL — NATIVE_SHELL_REQUIRED |

Do not start LA-003+.

## R. Exact local acceptance commands

On the Windows machine, from this cloud branch or cherry-pick onto
`local/jarvis-acceptance-2026-08-20` (do not merge from Cloud):

```powershell
git fetch origin
git checkout cursor/jarvis-presenter-desktop-cloud-2026-08-20-4838
# or cherry-pick 98a55be..HEAD onto the local acceptance branch
$env:JARVIS_STANDALONE='1'
# Simulation OFF. Do not start Discord.
npm run test:cloud
npx tsc --noEmit
# then start the existing local lab (owner’s usual start:local / jarvis lab)
```

Live checks (Simulation OFF, `/jarvis-lab`, real Edge-TTS, real
`Screen.AllScreens`):

1. `hello` → plain, no briefing
2. `สถานะระบบ` → rich cards for CPU/RAM/Disk and GPU if present; Speak
   narrates sections in order; motion follows speech; reduced-motion
   keeps static focus
3. Repeat / Back seek the current briefing only (no new DAG)
4. `มีกี่จอ` → briefing shows **2 displays**, never “0 displays”
5. Window at `x=-1920` in the DISPLAY1/DISPLAY5 gap → unknown display,
   not a silent primary match
6. Browser move still `UNSUPPORTED_HOST` after ActionGate confirm
7. `compare those two sources` → no web research; `compare the latest
   Qwen documentation` → normal RESEARCH router
8. Native helper still absent → `native helper unavailable`

Copy `config/jarvis/displays.example.json` to `displays.json` **only
after remapping this machine’s current device ids**. Do not commit the
owner map. Example ids are fictional (`DISPLAY-EXAMPLE-SECOND`).

## S. Known limitations

- Cloud did not run Edge-TTS, Ollama, or Windows `Screen.AllScreens`
- Pause cannot be honest on current Edge-TTS → explicitly unsupported
- No word-level timing
- Native helper is not installed; browser host cannot move Chrome/Edge
- Physical display ids can change; aliases are owner-local
- Repeat/Back re-speak only if a local audio element is still loaded
- Comparison of two names without “latest/docs/those” is INFORMATION,
  not automatic web research

## T. Push status

Pushed: `origin/cursor/jarvis-presenter-desktop-cloud-2026-08-20-4838`

Not pushed: `main`, `local/jarvis-acceptance-2026-08-20`, other cloud
branches. No merge. No force push.
