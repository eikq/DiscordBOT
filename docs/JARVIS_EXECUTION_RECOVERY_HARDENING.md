# JARVIS execution reliability and recovery hardening

Updated: 2026-08-21

This maturity record applies to `work/jarvis-execution-recovery-hardening`,
created from exact remote source
`e7101599ed55f042d703f788884a4a5002466571`. It records cloud-test evidence,
not owner-machine acceptance.

## Cancellation path

WorkAgent owns task cancellation. Its AbortSignal now travels through the
existing CapabilityHost and ActionGate into `CapabilityInvocationContext`:

`Owner cancel / Emergency Stop → WorkAgent → CapabilityHost → ActionGate → typed handler`

Handlers opt into cooperative cancellation in descriptor metadata. Existing
handlers that cannot safely observe cancellation remain `not_supported` and are
not modified blindly. Structured reasons remain distinct:

- `OWNER_CANCEL`
- `EMERGENCY_STOP`
- `TIMEOUT`

Structured states are `CANCELLABLE`, `CANCELLATION_REQUESTED`, `CANCELLED`,
`COMPLETED_BEFORE_CANCEL`, `NOT_CANCELLABLE`, and `FAILED_TO_CANCEL`.
WorkAgent no longer declares a running task cancelled merely because it emitted
a signal. Emergency Stop records the immediate request and may refine its
inventory after handler completion. It still does not claim arbitrary OS
process termination.

A mutating timeout is not silently retried. Timeout or an unacknowledged unknown
partial mutation activates containment before related mutation can continue.

## Recovery checkpoint contract

`RecoveryCheckpointStore` persists metadata and prior state under one
configured Jarvis runtime root. A record includes checkpoint/capability/task/
step identity, creation and expiry, scope, affected targets, an opaque prior
state reference, SHA-256 integrity, and lifecycle state:

- `CREATED`
- `AVAILABLE`
- `CONSUMED`
- `INVALID`
- `EXPIRED`
- `FAILED`

State blobs are verified before restoration. Metadata and state containing
secret-like material are rejected. Owner approval tokens are never stored.
`AVAILABLE` means the corresponding recovery state was actually recorded; Git
presence is irrelevant.

## Complete REAL cloud acceptance mutation

`operator.sandbox.writeConfig` writes one bounded value only to the fixed
Jarvis-owned recovery sandbox. It accepts a validated operation id and a short,
non-secret value. The runtime:

1. computes typed effects and structured preflight;
2. requests single-use owner approval;
3. captures actual prior state in an integrity-checked checkpoint;
4. records a persistent operation ledger;
5. checks AbortSignal before atomic commit;
6. writes the fixed target;
7. invokes a registered deterministic verifier that re-reads the file;
8. records `VERIFIED` only if the committed digest matches;
9. exposes the real checkpoint as `AVAILABLE`.

The operation ledger makes duplicate submission idempotent. Restart while
checkpointed resumes only if the target still equals prior state. Restart after
commit but before verification re-verifies the intended digest. An unknown
state fails closed rather than applying a second mutation.

## Rollback

`operator.sandbox.rollbackConfig` is a new ActionGate request. It receives no
authority from the original model output or original approval. Policy validates
the checkpoint id, fixed capability, and fixed target; owner approval is
required again.

The handler verifies checkpoint integrity, restores the prior content or prior
absence, then re-reads the target. Result states are
`ROLLBACK_VERIFIED`, `ROLLBACK_PARTIAL`, `ROLLBACK_FAILED`, or
`ROLLBACK_UNVERIFIED`. Only a digest match consumes the checkpoint as verified.
A second rollback returns the recorded verified outcome without applying a
second effect.

## Containment persistence

Shared runtime containment stores only bounded, redacted operational identity,
reason category, affected target identity, evidence text, timestamps, state,
and recovery references. It stores no approval token. Active incidents reload
across restart. Corrupt containment inventory creates a wildcard fail-closed
incident requiring owner review. Clearing containment remains owner-only and is
itself recorded.

## UI and audit

Existing Risk Brief, Permission Card, Verification Report, Rollback Status,
Task Center, Security, and Activity components consume the structured runtime
records. Security shows checkpoint lifecycle; Task Center shows cancellation
and rollback readiness and can request the scoped sandbox rollback. Raw ids and
integrity metadata remain in Expert Details.

Operational events include checkpoint, cancel request/result, verification,
rollback request/start/completion/verification, containment activation/clear,
and Emergency Stop/resume. Payloads are redacted and contain no hidden
reasoning.

## Maturity

REAL (cloud-tested code): AbortSignal propagation, cooperative handler pattern,
honest cancellation records, timeout separation, integrity-checked checkpoints,
deterministic verification registry, disposable sandbox mutation, owner-gated
verified rollback, duplicate/restart idempotency, scoped persistent containment,
operator/task UI records, and structured operational events.

PREPARE_CONTRACT: cooperative cancellation for additional typed handlers,
transaction/checkpoint implementations for real owner capabilities, bounded
external-process adapters that can prove cancellation, and wider deterministic
verification strategies.

BLOCKED_LOCAL_ACCEPTANCE: Windows filesystem and antivirus interaction, browser
rendering, owner runtime restart behavior, arbitrary OS process cancellation,
Ollama/GPU/VRAM, microphone/STT/TTS/RVC, VirtualBox/Whonix, screen capture,
CCTV, phone/devices, and owner visual acceptance.

Out of scope: Community Edition, Setup Wizard, hardware profiler, Hugging Face
browser/downloader, GGUF picker, automatic runtime installers, distribution
filtering, MinerU/Tokei installs, CatchMe capture, FlashInfer, Orbien, and new
device providers.
