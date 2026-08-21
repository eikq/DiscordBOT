# Jarvis secure pending-goal continuation

Updated: 2026-08-21

Status: `IMPLEMENTED` + `UNIT_VERIFIED` for the cloud-safe declared goals and
runtime paths described below. This is not `OWNER_VERIFIED` and does not claim
live owner-machine notification, provider, hardware, or browser acceptance.

## Purpose

A declared goal may be valid before it is executable. When one required field is
missing, Jarvis now preserves the validated goal context, asks the smallest
catalog-declared question, and accepts a later typed answer for that same goal.
The continuation is representation and context only:

- `CONTEXT != AUTHORITY`
- `PENDING GOAL != PERMISSION`
- `CONTINUATION != AUTOMATIC EXECUTION`

CapabilityHost, current availability, ActionGate, permission, privilege leases,
Emergency Stop, containment, verification, and rollback remain authoritative at
resume time.

## State and persistence

`PendingGoalCoordinator` owns the protocol and `PendingGoalStore` owns a small
optional SQLite inventory. The store contains an opaque random pending-goal ID,
GoalCatalog ID/version, redacted owner intent, validated fields, missing fields,
scope, maturity, selected route/adapter evidence, task link, expiry, revision,
and bounded idempotency receipts. It never stores permission tokens, privilege
leases, confirmation grants, credentials, hidden reasoning, or model state.

States are:

- `WAITING_OWNER_INPUT`
- `READY_TO_RESUME`
- `RESUMING`
- `RESOLVED`
- `EXPIRED`
- `CANCELLED`
- `INVALIDATED`

The default time-to-live is 15 minutes. Configuration is clamped between one
minute and 24 hours. Expiry is fail-closed, emits one structured event, and also
moves the linked WorkAgent task to `EXPIRED`. Unrelated later text is not
consumed by expired context.

## Continuation protocol

1. Resolve a request through the authoritative GoalCatalog.
2. If it is `NEEDS_INPUT`, create one pending record and one `WAITING_INPUT`
   WorkAgent task.
3. Accept a later reply only from the same session, an explicitly selected
   opaque pending-goal ID, or an unambiguous single candidate.
4. Bind the reply to only the first declared missing field.
5. Reject credentials and authority-bearing fields before persistence.
6. Re-run GoalCatalog resolution, the trusted adapter, actual capability schema,
   scope preservation, availability, and gap analysis.
7. Claim one resume path, rebuild the bounded WorkAgent plan, and execute through
   the normal Trusted Operator boundary.

Multiple compatible pending goals require explicit owner selection. A new
session cannot silently consume old context. Explicit selection identifies
context; it is not approval.

## Drift and revisions

A reply containing a different declared goal cue is `GOAL_DRIFT`. Jarvis keeps
the old pending goal unchanged and asks whether the owner wants to replace it.
`Never mind`, `Cancel that`, and equivalent bounded phrases mark the pending goal
`CANCELLED` and cancel its waiting task.

Explicit corrections such as `Actually make it Saturday at 4 PM` are recorded
as a revision. Only the currently missing declared field is updated in this
vertical slice. Goal identity, capability ID, target, permission, privilege,
risk, provider, and verification cannot be supplied through continuation text.
The revised inputs and route are validated again rather than reusing stale
adapter evidence.

## Idempotency and restart behavior

Opaque pending IDs are not authority. A bounded SHA-256 receipt inventory
deduplicates UI/network retries without storing the raw idempotency key. An
in-process resume claim prevents concurrent duplicate deliveries from starting
two WorkAgent executions. The pending record and `WAITING_INPUT` task survive a
configured process restart. A restart may reclaim a record left `RESUMING` only
when its linked task is still at the non-mutating `WAITING_INPUT` boundary.

This does not replace the execution journal. Recovery after an interrupted
already-running mutating step remains governed by the existing checkpoint,
containment, verification, and no-blind-retry rules.

## WorkAgent and Activity

WorkAgent now represents `WAITING_INPUT` and `EXPIRED` directly. The waiting
task preserves the declared goal, completed understanding step, safe route
metadata, missing field, question, expiry, and task evidence. Resume replaces
the placeholder plan with a freshly validated bounded plan; completed mutating
steps are never replayed by this protocol.

Structured events include `GOAL_WAITING_INPUT`, `GOAL_INPUT_RECEIVED`,
`GOAL_CONTINUATION_VALIDATED`, `GOAL_CONTINUATION_REJECTED`, `GOAL_REVISED`,
`GOAL_EXPIRED`, `GOAL_CANCELLED`, and `GOAL_RESUMED`. Event details are redacted
and contain no chain-of-thought.

Waiting, owner clarification, cancellation, and expiry are not capability
failures and do not inflate or punish CapabilitySelfModel competence.

## Verified reminder vertical slice

The cloud-safe acceptance path is:

1. `Remind me to test Jarvis` creates a pending `reminders.create` goal asking
   only for time.
2. `Tomorrow at 15:00` fills only `whenText` and resumes the same WorkAgent task.
3. Current availability and ActionGate are checked; no reminder exists before
   owner approval.
4. A scoped Allow Once grant resumes the same typed step.
5. One reminder record is created.
6. The registered deterministic verifier independently re-reads the isolated
   reminder store and compares ID, `ACTIVE` state, and next-run time.
7. A duplicate continuation delivery returns the existing task and does not
   create a second reminder.

This verifies storage/orchestration in cloud fixtures. Delivery through the
owner's real Windows notification environment remains local acceptance work.

## Scope examples

- `Compare the security notes` waits for `scope`; `My workspace` selects only
  the declared workspace route and cannot drift to public web.
- `Connect my CCTV` waits only for camera/NVR vendor and model. Supplying that
  identity re-runs the provider gap and remains owner-only `PREPARE_CONTRACT`.
  It neither requests credentials early nor claims a connection.

## Remaining limitations

- Unknown goals without a declared GoalCatalog entry or trusted missing-field
  adapter still require the owner to restate or clarify the objective.
- Expired, cancelled, or invalidated context cannot resume implicitly.
- Cross-session continuation needs explicit owner selection.
- This slice supports bounded revisions of the currently missing field, not an
  arbitrary multi-field conversational edit language.
- Real CCTV providers, owner notifications, Windows/browser UI acceptance,
  local models, and hardware integrations remain outside cloud verification.
