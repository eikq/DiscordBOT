# JF-012 — Reminders + scheduler / automation kernel

Jarvis can create, list, modify, cancel, recover, and deliver **persistent
time-based reminders** in Thai and English. This is an operational scheduler,
not a general unattended action engine.

## Invariants

```
REMINDER TEXT IS DATA, NOT INSTRUCTION
SCHEDULED REMINDER != SCHEDULED CAPABILITY EXECUTION
Jarvis Memory != Jarvis Reminder Store
Night Agent != Jarvis Reminder Scheduler
Reminder != Scheduled arbitrary action
```

A reminder may **deliver a notification**. It does not gain authority to launch
applications, run shell, send Discord/email, change settings, or invoke
mutating desktop capabilities when it fires.

Stored reminder title/message is user content. At fire time it is displayed or
spoken as data. It is never treated as a new model instruction or capability
call.

## Architecture

```
Jarvis Core
  + Memory (canonical SQLite facts — untouched)
  + Skills (instruction/reference only)
  + CapabilityHost / PermissionPolicy / ActionGate
  + Automation runtime
        ReminderStore      data/jarvis/automation.db
        Schedule parser    Thai/English, deterministic
        Scheduler          one timer, nearest due
        Delivery           Command Center + optional speech
        ReminderAudit      data/jarvis/audit/reminders.jsonl
```

The LLM may propose a reminder intent. Deterministic TypeScript validates time,
recurrence, timezone, bounds, ownership, and mutation.

A `TimeTrigger` type exists for later safe automation
(`Trigger → Scheduled Event → ActionProposal → Policy → CapabilityHost`).
JF-012 only implements `Scheduled Event → Reminder Delivery`.

## Persistence

Dedicated operational SQLite file: `data/jarvis/automation.db`.

- Versioned `schema_migrations` (v1)
- Tables: `automation_settings`, `reminders`, `reminder_occurrences`
- Refuses `data/brain/` paths
- Refuses the canonical memory file `jarvis.db`

Owner timezone is written once to `automation_settings.timezone` from
`JARVIS_TIMEZONE`, `TZ`, or `Intl` — never from free-form LLM output.

Reminders survive server restart, browser refresh, model unload, and lab
reload. The scheduler lives in the Node standalone runtime, not in React
`setTimeout`.

## Time model

Every persisted schedule has an explicit IANA timezone. Instants are stored as
UTC ISO strings. Wall-clock local time is converted with `Intl` so DST is
correct even on machines that do not observe DST (for example Asia/Bangkok).

DST policy:

- Spring-forward gap: advance to the next valid local instant
- Fall-back overlap: choose the earlier offset

### Schedule kinds (v1)

| Kind | Examples |
|---|---|
| `once_relative` | อีก 30 นาที, in 2 hours, อีก 45 วินาที |
| `once_absolute` | พรุ่งนี้ 7 โมงเช้า, August 21 at 09:30 |
| `daily` | ทุกวัน 2 ทุ่ม, every day at 8 PM |
| `weekly` | ทุกวันจันทร์ 8 โมง, every Monday at 8 AM |
| `weekdays` | จันทร์ถึงศุกร์ 7 โมงเช้า |

No cron language is exposed to the LLM. Raw `cron` / `rrule` / `sql` / `command`
argument keys are rejected.

### Documented dayparts

Used only when the utterance names a part of day, not a bare hour:

| Phrase | Local time |
|---|---|
| morning / เช้า / ตอนเช้า | 08:00 |
| noon / เที่ยง | 12:00 |
| afternoon / บ่าย | 15:00 |
| evening / เย็น / ช่วงเย็น / tonight | 18:00 |
| night / ดึก / ค่ำ | 21:00 |

Thai `N ทุ่ม` is deterministic (`1 ทุ่ม` = 19:00 … `5 ทุ่ม` = 23:00).
`N โมงเช้า` / `โมงเย็น` / `โมงบ่าย` are deterministic.

### Ambiguity

Bare `7 โมง` or `at 7` without AM/PM/เช้า/เย็น → `AMBIGUOUS_TIME`.
Do not guess 07:00 vs 19:00.

Day-only (`เตือนวันศุกร์`) with no time → `CLARIFY`.

Recurring `ทุกวันจันทร์ 8 โมง` (no เช้า/เย็น) uses the morning clock (08:00)
as a documented recurring default.

### Past-time policy

One-time absolute times that are already past → `PAST_TIME`.
Never silently fire immediately.

Recurring schedules compute the next valid occurrence in the future.

## Capabilities

Routed through the same JF-010/011 ActionGate (schema + policy + audit).

| Id | Risk | Notes |
|---|---|---|
| `reminders.create` | `LOW_RISK_ACTION` | parse / persist ACTIVE |
| `reminders.list` / `get` | `READ_ONLY` | no SQL, no store paths |
| `reminders.cancel` / `pause` / `resume` | `LOW_RISK_ACTION` | id or unique query |
| `reminders.reschedule` | `LOW_RISK_ACTION` | |
| `reminders.complete` / `dismiss` / `snooze` | `LOW_RISK_ACTION` | snooze 10/30/60 min only |

Natural-language cancel: exactly one clear match → cancel. Multiple matches →
`SELECTION_REQUIRED`. Vague bulk (“ยกเลิกทั้งหมดที่คิดว่าไม่สำคัญ”) →
`BLOCKED_BULK_CANCEL`.

Thai reminder verbs use `includes()`, not JavaScript `\b`.

Create vs cancel: an utterance that both reminds and names a time
(`อีก 10 นาที`, `ทุกวัน`, …) is treated as **create** even if the title
contains `ยกเลิก`. Explicit `ยกเลิกอัน` / `ยกเลิก reminder` / `cancel reminder`
still cancel.

Title extraction does not strip the English word `night` from names such as
`Night Agent`. Temporal night is `tonight`, `at night`, `tomorrow night`,
`ดึก`, or `ค่ำ`.

## Scheduler

- One timer aimed at the nearest `nextRunAt` (no busy loop, no per-reminder timers)
- `setTimeout` delay capped at 2³¹−1 ms
- Startup `recover()` then arm
- Unique occurrence key `reminderId + scheduledOccurrenceAt`
- Claim inside `BEGIN IMMEDIATE` before delivery (exactly-once)

### Missed-run policy

| Case | Behavior |
|---|---|
| One-time overdue ≤ 15 minutes (`ONE_TIME_GRACE_MS`) | deliver once as `missed` |
| One-time overdue > 15 minutes | mark `EXPIRED`, do not deliver. Audit reason `ONE_TIME_STALE` until 24h, then `ONE_TIME_EXPIRED` |
| Recurring downtime | do **not** replay missed occurrences; compute next future run; note `missedSkipped` |

Cancelled reminders stay `CANCELLED` across restart (`nextRunAt` null).

## Delivery

v1 surfaces:

1. Command Center notification (`GET /api/jarvis/reminders` pending deliveries)
2. Optional speech only when `deliveryMode = notification_and_speech` and a
   speech port exists. TTS failure does **not** fail delivery.
3. Session/action text from the capability result

No Discord, email, or cloud push.

Due card: title, scheduled local time, **Done** / **Dismiss** / **Snooze 10m**.
Dismiss on a recurring reminder acknowledges the occurrence only; the series
stays `ACTIVE`.

Reminder text is rendered as React text (escaped). Never `dangerouslySetInnerHTML`.

## Command Center

Compact **Reminders** block on the existing right operations rail. Scheduler
status line: `scheduler healthy · next HH:MM`. No calendar redesign. No
chain-of-thought.

Closing the browser does not cancel reminders while the Jarvis server is up.

## Memory and skills

Creating a reminder does not write a canonical personal fact.
“เตือนให้กินยา” does not become “user takes medication”.

JF-SKILLS-001 remains instruction/reference only. Skills cannot create hidden
schedules, mutate the DB, change policy, or run scripts (`scriptsAllowed` still
hard-fails).

## HTTP

`GET /api/jarvis/reminders` — read snapshot (loopback Host only).

`POST /api/jarvis/reminders/ack` — dismiss / complete / snooze. Reuses JF-011
`assertLocalMutationRequest`: loopback Host, same-origin Origin/Referer, reject
`Sec-Fetch-Site: cross-site`, `application/json`, 16 KB body, no tokens in URLs.
No permissive CORS.

Mutating list/cancel/pause/resume from the UI also go through
`/api/jarvis/ask` + gated `capabilityCalls`.

## Security

- Reminder text = data
- Shell / path / pid / cron / sql argument keys forbidden
- “เตือนให้รัน PowerShell” may store that **text**; it never executes PowerShell
- “ทุกวันเปิด cmd.exe” / “ตอนดังให้เปิด Chrome” → `SCHEDULED_ACTION_UNSUPPORTED`
- Parameterized SQL only; no model-supplied SQL
- Audit JSONL: event, reminderId, times, short sanitized title. No raw prompts,
  tokens, or secrets
