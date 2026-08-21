# JARVIS Capability Intelligence

Status: cloud-implemented and unit-tested on `work/jarvis-capability-intelligence`; owner-machine/provider acceptance remains separate.

## Purpose

Capability Intelligence lets JARVIS answer what it is, what runtime capabilities are evidenced, why an objective is blocked, and which safe next path is available. It does not grant authority. The model may propose a goal or candidate dependency, but registry, provider, policy, permission, verification, and self-model evidence determine the result.

## Self Knowledge

`buildSelfKnowledgeSnapshot()` reuses the existing `CapabilityHost`, `CapabilitySelfModel`, `ModelProfileRegistry`, and `ModelCertificationRegistry`. One snapshot keeps these dimensions separate:

- identity and immutable trust boundaries;
- configured model profiles, certifications, provider state, and known limitations;
- registered capabilities plus separately labelled provider contracts;
- runtime availability and provider/service evidence;
- technical maturity and REAL/SIMULATION/PREPARE_CONTRACT mode;
- permission class without a grant;
- local acceptance state;
- cancellation, deterministic verification, and rollback support;
- owner-only/community/demo distribution metadata;
- verified competence, unverified outcomes, and recurring weakness evidence.

`UNKNOWN` remains a valid result. Registration alone does not prove availability, and a simulation never becomes REAL because its handler reports healthy. Provider and service reasons are redacted before the snapshot reaches Assistant or UI.

## Capability Graph and gap resolution

`CapabilityGraph` represents `REQUIRED`, `OPTIONAL`, and grouped `ALTERNATIVE` dependencies. A dependency is usable only when runtime evidence names an existing registered capability in an allowed state. Model text cannot declare a missing capability available.

`CapabilityGapResolver` produces a structured `GapResolutionPlan`: blocker code, current state, possible paths, recommended path, owner input, permission, external dependency, verification strategy, evidence, confidence, and a bounded attempt budget. It prefers existing registered capabilities and compositions, then configuration/provider recovery, trusted documentation research, reviewed adapter/skill candidates, precise owner input, and finally an honest blocker. Discovery never installs, trusts, registers, enables, or executes code.

## Goal pursuit

WorkAgent invokes the resolver for plan-invalid, provider-unavailable, local-acceptance, and simulation-only failures. Only an evidence-backed existing/composed route marked executable and input-compatible may be inserted. Replanning is bounded to at most four attempts, preserves an acyclic step graph and total step budget, and does not bypass CapabilityHost or ActionGate. Non-executable paths become structured blockers shown in Task Center and the final response.

This is intentionally conservative. Arbitrary natural-language goals still need declared goal graphs or trusted input adapters; JARVIS does not synthesize and execute a new provider in the same loop.

## Capability acquisition lifecycle

The candidate contract separates:

`DISCOVERED → RESEARCHED → DESIGNED → SANDBOXED → REVIEWED → TESTED → SECURITY_REVIEWED → VERIFIED → OWNER_APPROVAL_REQUIRED → OWNER_APPROVED → INSTALLED → REGISTERED → ENABLED`

Every automatic transition needs evidence. Only owner action can approve and enable. Installation, registration/trust, and execution are distinct transitions. Model or JARVIS actors cannot self-approve. Candidate sources and evidence are redacted, and the contract itself performs no download, installation, registry mutation, or execution.

## Competence and failure learning

`CapabilitySelfModel` now distinguishes verified attempts/successes from unverified successes. Confidence requires at least three independently `VERIFIED` observations, and observation IDs prevent duplicate experience writes from inflating competence. Legacy successes without verification provenance remain unverified.

Failure experiences classify capability, stage, blocker, reason, and next possible step. `FailureLedger.weaknessSignals()` aggregates repeated blockers for GrowthPlanner input. Night Cycle can distill skill candidates only from verified successful experiences; a reflection or handler `OK` cannot mint trusted competence.

## Assistant and UI

Assistant answers capability summary, CCTV status, computer-control status, unavailable capability, blocker, and verified-improvement questions from bounded Self Knowledge rather than asking the model to imagine an answer. The System Capability Explorer presents human state/reason/requirements/risk first and moves IDs, provider details, maturity, distribution, and evidence into Expert Details. Task Center shows structured blockers and the safest next path.

## CCTV owner-only contract

Before this branch, CCTV existed only as simulated device cards. This branch adds provider-independent `CCTVProvider` and profile contracts for bounded discovery, connect, status, view, snapshot, stream, and events. No real provider, LAN scan, credential store, stream decode, or camera connection is implemented.

Profiles accept an opaque `local-secret://` reference only. Host/IP and path fields reject credential-bearing URLs, user-info, fragments, control characters, and non-allowlisted query keys. Footage remains local-first; `VIEW` does not imply PTZ, CONTROL, CONFIGURE, or ADMIN.

To connect owner CCTV later, owner/local work must identify the NVR/camera vendor and model, provide a known LAN address, confirm RTSP/ONVIF/vendor protocol, supply an opaque local credential reference, implement one reviewed read-only adapter, verify status/snapshot deterministically, and complete owner-machine acceptance. Broad autonomous network enumeration is not authorized.

## Maturity

- REAL / FUNCTIONAL_CORE: Self Knowledge snapshot, capability graph, gap plans, bounded WorkAgent blocker/replan integration, verified competence accounting, weakness signals, acquisition state contract, Assistant structured answers, System/Task UI wiring, and owner-only distribution metadata.
- SIMULATION: current device/CCTV cards and simulator records. They do not access owner hardware.
- PREPARE_CONTRACT: real CCTV provider adapters, local secret-store integration, stream/snapshot verification, general goal catalog, automatic trusted-document research orchestration, and candidate sandbox tooling.
- BLOCKED_LOCAL_ACCEPTANCE: Windows/provider health, actual CCTV/RTSP/ONVIF/NVR, owner LAN, screen/phone/device behavior, local Ollama/model status, and browser visual acceptance.

Community Edition, setup wizard, Hugging Face workflows, hardware recommendation, automatic runtime installation, and distribution filtering are not implemented here.
