# Jarvis persistent capability execution journal

Updated: 2026-08-21

Status: `IMPLEMENTED` + `UNIT_VERIFIED` on the owner Windows checkout of
`38709c4ebe9e34c5aaa38b9cc93f902b75a1e407`. This is not `OWNER_VERIFIED` and
does not claim live crash-kill, owner-file, or provider acceptance.

## Purpose

Mutating capability execution now has one authoritative persistent journal.
It preserves evidence for operation identity, goal/task/step, capability,
validated action and scope fingerprints, idempotency class, checkpoint
reference, execution/verification/cancellation/rollback/containment state,
and recovery disposition.

The journal reuses the existing sandbox operation ledger,
`RecoveryCheckpointStore`, `VerificationRegistry`, `FailureContainment`,
ActionGate, privilege leases, CapabilityHost, WorkAgent, cancellation,
Emergency Stop, and pending-goal continuation. It does not create a second
permission, privilege, or recovery system.

## Security invariants

- `PERSISTENCE != AUTHORITY`
- `JOURNAL != PERMISSION`
- `PREVIOUS APPROVAL != CURRENT PRIVILEGE`

The store never persists confirmation tokens, privilege grants, credentials,
cookies, Authorization headers, model hidden state, or secrets. Model identity
cannot set journal state. Expired leases cannot be revived from a journal
record. Emergency Resume clears in-process retry authorization and does not
auto-resume mutation.

## Reconciliation

Interrupted mutation is never blindly replayed.

| Persisted state | Observed target | Result |
| --- | --- | --- |
| `CHECKPOINTED` + prior | no write | `RETRY_OFFERED`; owner retry required |
| `EXECUTING` + unknown/prior | no write | `AMBIGUOUS` then `CONTAINED` |
| `MUTATED` / `VERIFYING` + intended | verify only | no remutation |
| neither prior nor intended | no write | `CONTAINED` |
| `ROLLING_BACK` + already restored | verify rollback | do not rollback again |

`UNKNOWN` and `NON_IDEMPOTENT` operations never auto-replay after restart.
A consumed or already-replayed checkpoint cannot authorize another mutation.
Rollback is a separate journaled operation and still requires its own owner
approval. Step `VERIFIED` is not entire-goal `COMPLETED`.

## Persistence

SQLite at `data/jarvis/runtime/execution-journal.db` (or the disposable
`recoveryRoot` used by tests). Connections open per load/write and close so
Windows test fixtures can delete the file. Corrupt active records fail closed
and block further mutation until owner review.

## Local verification (2026-08-21)

Not owner-machine crash-kill or UI acceptance.

- TypeScript: `npx tsc --noEmit` PASS
- Focused: journal + recovery tests PASS
- Cloud: `npm run test:cloud` 565 / 565 PASS
- Production: `npm run build` PASS with the existing CoreScene chunk and CJS
  `import.meta` warnings

