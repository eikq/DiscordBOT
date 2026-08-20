# Jarvis Presentation Mode + Desktop Presence

User-facing layer only. CapabilityHost still owns invoke. Presentation never calls tools.
Core stays TTS-free. Typed Speak remains opt-in.

## When a turn becomes a briefing

`planPresentation()` chooses `plain` | `rich` | `briefing`.

Plain (normal chat): greetings, acks, short conversation.

Rich / briefing: research summaries, comparisons, diagnostics, plans/roadmaps,
benchmarks, monitor/device status, multi-section reports, completed work results.

## Presentation model

Typed fields: title, subtitle, mode (`summary|comparison|walkthrough|report|recommendation`),
summary, sections, cards, optional tables, evidence, confidence/limitations,
recommended actions, follow-ups, narration segments, motion timeline.

Hidden reasoning keys are stripped. Secrets are redacted.

## Narration + TTS sync

Spoken text is a concise sequence (overview → clipped section lines → finish),
not the raw document. `VoiceOutputRouter` still speaks only when `speak: true`.
Client `audio.duration` / `ontimeupdate` drive `spokenAtMs` and
`scaleNarrationToSpeech`. Pause is explicitly unsupported for Edge-TTS.
There is no fake word-level timing. Cloud: IMPLEMENTED + CLOUD_VERIFIED (unit).
Live Edge-TTS sequential briefing: NEEDS_LOCAL_VERIFY.

## Motion

Motion follows the active narration segment (focus, sparse highlight). Pulse
and zoom are skipped under reduced motion; static focus remains. Repeat/Back
are presenter-local seeks and do not invoke WorkAgent.

## Structured facts

`system.status` and `desktop.listDisplays` attach typed facts. Diagnostic
cards use `system.cpu` / `system.memory` / `system.disk` / `system.gpu`
(GPU omitted when absent). Display briefings use the real count; get-window
`count: 0` must not overwrite a list of two displays.

## Presenter Mode

Existing `/jarvis-lab` camera bar: Fit / Core / Graph / **Presenter** / Reset.
Quality still includes `minimal` and `2d`. Presenter does not auto-open on
every turn; use the camera button or **Open briefing**.

## Desktop presence

Capabilities (ActionGate / PermissionPolicy):

| Id | Risk |
| --- | --- |
| `desktop.listDisplays` | READ_ONLY |
| `desktop.getJarvisWindow` | READ_ONLY |
| `desktop.moveJarvisWindow` | CONFIRM_REQUIRED |
| `desktop.setJarvisWindowBounds` | CONFIRM_REQUIRED |
| `desktop.focusJarvisWindow` | CONFIRM_REQUIRED |
| `desktop.setJarvisLayout` | CONFIRM_REQUIRED |

Jarvis window only. `hwnd`, `processName`, and `windowTitle` are forbidden.

Fail-closed reasons: `WINDOW_UNAVAILABLE`, `DISPLAY_NOT_FOUND`,
`UNKNOWN_DISPLAY`, `PERMISSION_REQUIRED`, `UNSUPPORTED_HOST`, `INVALID_TARGET`.

Display matching uses greatest positive intersection area. Gaps and exclusive
edges return `UNKNOWN_DISPLAY` instead of falling back to primary.

This repo is an Express + React dashboard, not an Electron app. The lab tab
can report `screenX/Y` + `outerWidth/Height` via `POST /api/jarvis/presence`.
Windows can enumerate `Screen.AllScreens` for list/get. Moving Chrome/Edge
is `UNSUPPORTED_HOST` unless a `NativeJarvisWindowAdapter` is injected.

Capability timeouts must cover cold PowerShell `Add-Type` (observed 6–9s
on the owner laptop): list/get 18s, write 20s, spawn 15s.

Owner-named displays: copy `config/jarvis/displays.example.json` to
`config/jarvis/displays.json` **only after remapping real device ids**.
On the 2026-08-20 machine primary is `DISPLAY5`, not `DISPLAY2`.
“Notebook” requires an owner name. “External” works only when exactly
one non-primary display is present.

Display enumeration is not run on `/api/jarvis/status` polling.

Native-shell decision: ADR-023 Phase 1 contracts are implemented as
cloud-safe scaffolding (`nativeProtocol`, ownership registry, fake adapter).
The helper is not installed. Browser host remains supported and fail-closes
mutations with `UNSUPPORTED_HOST`. See
`CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.
