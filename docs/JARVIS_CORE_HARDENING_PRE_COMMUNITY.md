# JARVIS Core hardening before Community Edition

Updated: 2026-08-21

This is the runtime maturity record for `work/jarvis-core-hardening-pre-community`.
It describes code and cloud-test evidence only. It is not owner-machine acceptance.

## Execution boundary

Every registered mutating capability must use ActionGate. A mutating capability
outside the gated catalog is rejected as `UNGATED_MUTATION_FORBIDDEN`.
Capability descriptors may declare typed `ActionEffect` records: effect kind,
targets resolved from validated fields, destructive/reversible flags, affected
object estimates, privilege, and bounded generated-output policy. Model prose
cannot change these fields.

`DestructiveActionCircuitBreaker` classifies `SAFE`, `LOW`, `MEDIUM`, `HIGH`, or
`CRITICAL` and produces structured `ActionPreflight` data for the Risk Brief.
Defaults require review above 5 deletes, 20 moves/renames, or 50 modifications.
Explicitly bounded generated output may opt out in capability metadata. A
destructive effect with no explicit target is blocked.

The preflight contract includes action, why, risk, impact, affected targets,
expected changes, protections, reversibility, rollback, privilege, and
permission scope. Secret-like targets and URL query strings are redacted.

## Emergency Stop — REAL runtime contract

The owner-only local endpoints are:

- `GET /api/jarvis/operator`
- `POST /api/jarvis/emergency-stop`
- `POST /api/jarvis/emergency-resume`
- `POST /api/jarvis/leases/revoke`

Emergency Stop latches before cancellation work begins, blocks new autonomous
WorkAgent/capability execution, invalidates pending one-use confirmations,
revokes ACTIVE privilege leases, suspends lease issue/renew/expand/consume, and
asks registered runtime participants to cancel owned work. It reports
`CANCELLED`, `CANCELLATION_REQUESTED`, `NOT_CANCELLABLE`, or `UNKNOWN`.

It does not claim to kill arbitrary OS processes. Typed capability handlers do
not yet receive an AbortSignal; an already-running handler is therefore
`NOT_CANCELLABLE` even though subsequent execution is blocked. Only `owner` may
resume. `jarvis`, `model`, and `system` cannot clear the latch. The shared local
runtime persists the active latch; corrupt latch state fails closed.

## Privilege leases — REAL inventory

The in-memory high-privilege grant remains temporary and secret-free. Inventory
shows lease id, capabilities, resource scopes, optional task/step, risk, issue
and expiry time, remaining actions, owner approval provenance, and state:
`ACTIVE`, `EXPIRED`, `REVOKED`, or `CONSUMED`. Jarvis cannot issue, renew, or
expand its own lease. Reusable approval tokens are not returned or persisted.

## Verification and rollback

Capability completion is not objective success. Results carry one of:

- `VERIFIED`
- `PARTIALLY_VERIFIED`
- `UNVERIFIED`
- `FAILED_VERIFICATION`
- `NOT_APPLICABLE`

Handler-result-only checks are `PARTIALLY_VERIFIED`. Independent structured
postconditions may be `VERIFIED` or `FAILED_VERIFICATION`. WorkAgent finishes a
mutation with incomplete independent verification as `DEGRADED`, and the
Experience Store records that outcome as partial rather than success.

Rollback is `AVAILABLE`, `PARTIAL`, `UNAVAILABLE`, `NOT_REQUIRED`, or `FAILED`.
`AVAILABLE` requires an actual checkpoint reference from the capability result.
Git presence alone never establishes rollback. Unexpected failure after a
declared destructive effect, or handler-reported targets outside preflight,
opens a containment incident and stops related mutation. Recovery requires a
separate owner-reviewed action.

## Operational audit

The redacted event bus records risk, preflight, permission, lease, action,
verification, rollback, containment, Emergency Stop, and owner resume events.
It records structured operational facts, never chain-of-thought.

## Model-agnostic foundation

`src/jarvis/models/` provides the non-competing `ModelProfileRegistry`,
`InferenceProvider`, `ModelCertificationRegistry`, and conservative
`ModelRouter`. Profiles support unknown metadata. Certification is evidence
based (`PASS`, `PARTIAL`, `FAIL`, `UNKNOWN`, `NOT_TESTED`); `PASS` requires
evidence, and routing rejects required UNKNOWN/FAIL/NOT_TESTED capabilities.

The current `LocalLlmProvider` is adapted behind `LocalLlmInferenceProvider`.
Future llama.cpp, LM Studio, vLLM, or SGLang implementations are provider work,
not implemented runtimes. Current Qwen/Ollama tags remain owner configuration,
and Qwen ASR/service names remain because those are actual distinct local
services. Core permission, tool selection, and verification do not branch on
model family.

## Maturity labels

REAL (cloud-tested code): typed action effects, circuit breaker, structured
preflight, owner-only Emergency Stop latch, lease inventory/revocation,
verification/rollback records, failure containment, operator endpoints/UI,
model profile/certification/router contracts.

PREPARE_CONTRACT: cancellation signals inside typed handlers, capability-specific
independent postconditions beyond registered structured checks, owner-reviewed
recovery handlers, additional inference providers, provider benchmarks.

SIMULATION: existing device, vision, monitoring, and Command Center demo
providers remain visibly simulated.

BLOCKED_LOCAL_ACCEPTANCE: Windows/browser UI rendering, actual process/service
cancellation, restart-persistent latch behavior on the owner installation,
Ollama/model metrics and generation, GPU/VRAM, mic/STT/TTS/RVC,
VirtualBox/Whonix, screen/CCTV/phone, and owner visual sign-off.
