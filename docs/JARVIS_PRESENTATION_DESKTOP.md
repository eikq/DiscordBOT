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

`spokenSummary` is a short presenter script. `VoiceOutputRouter` still speaks
only when `speak: true`. If TTS duration is known, `scaleNarrationToSpeech`
stretches segment estimates. Otherwise segments use ~150 wpm estimates.
There is no fake word-level timing.

## Motion

Each narration segment can highlight/focus/scroll/spotlight a section, card,
source, or recommendation. Pulse and zoom are skipped under reduced motion.
No fabricated data animations.

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
`PERMISSION_REQUIRED`, `UNSUPPORTED_HOST`.

This repo is an Express + React dashboard, not an Electron app. The lab tab
can report `screenX/Y` + `outerWidth/Height` via `POST /api/jarvis/presence`.
Windows can enumerate `Screen.AllScreens` for list/get. Moving Chrome/Edge
is `UNSUPPORTED_HOST` unless a `NativeJarvisWindowAdapter` is injected.

Owner-named displays: copy `config/jarvis/displays.example.json` to
`config/jarvis/displays.json`. “Notebook” requires an owner name.
“External” works only when exactly one non-primary display is present.

Display enumeration is not run on `/api/jarvis/status` polling.
