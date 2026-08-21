# Jarvis Goal Catalog and typed input adapters

Updated: 2026-08-21

Status: `IMPLEMENTED` + `UNIT_VERIFIED` for the cloud-safe goal families listed
below. This document does not claim `OWNER_VERIFIED` or owner-machine provider
acceptance.

## Purpose

Natural language is not execution authority. The Goal Catalog gives Jarvis a
small authoritative vocabulary of owner objectives and maps each objective to
registered capability dependencies. Trusted input adapters translate the
owner's representation into an existing capability schema without granting
permission, inventing identifiers, or widening scope.

The runtime path is:

1. classify the owner request and preserve existing forbidden fast paths;
2. resolve a declared goal conservatively;
3. extract only catalog-declared fields;
4. run an exact registered adapter for an exact registered capability;
5. validate its output against the capability descriptor's JSON schema;
6. resolve capability dependencies from the evidence-backed Self Knowledge
   snapshot;
7. build the existing WorkAgent DAG;
8. pass every step through CapabilityHost, ActionGate, permission, cancellation,
   verification, rollback, containment, and Emergency Stop as applicable.

No second planner, capability registry, permission system, model router, or
canonical memory store was added.

## Goal and capability are different

A goal is the owner's intended outcome. A capability is one typed runtime
operation that may contribute to that outcome. `research.topic` may be complete
even if its preferred `research.current` route is unavailable, provided the
declared `research.search` alternative succeeds and the final goal outcome is
verified. The failed capability attempt remains a capability-specific failure;
it is not rewritten as success.

Goal outcome evidence is stored separately from CapabilitySelfModel evidence.
A successful goal does not prove that every attempted capability succeeded.

## Initial authoritative goals

| Goal | Maturity | Scope | Current route |
|---|---|---|---|
| `research.topic` | REAL | public web | `research.current`, then declared `research.search`; private browser requires owner decision |
| `workspace.search` | REAL | approved workspace | `workspace.search`; no public-web substitution |
| `workspace.overview` | REAL | approved workspace | `workspace.listWorkspaces` + `workspace.listDocuments` |
| `documents.analyze-basic` | PARTIAL | indexed text document | `workspace.current`; unsupported binary formats still need a provider |
| `system.health` | REAL | system/runtime status | `jarvis.runtimeStatus` or `system.status`, read-only |
| `reminders.create` | REAL | local automation | `reminders.create`, low-risk mutation evaluated by ActionGate |
| `self.capabilities` | REAL | Self Knowledge | structured response, no capability execution |
| `self.explain-gap` | REAL | Self Knowledge | latest structured blocker/gap evidence |
| `devices.cctv.connect` | PREPARE_CONTRACT | owner device | no real provider; owner-only and community/demo excluded |

The catalog is intentionally small. An unknown objective remains `NO_MATCH` and
cannot become supported because a model suggested a plausible capability name.

## Trusted adapters

Current adapters cover public research query forms, workspace search/current
document forms, reminder creation text, and empty runtime/system status inputs.
Adapter registration binds one adapter ID to one capability ID. Output is
accepted only when it is JSON-safe, contains no authority/sensitive control
fields, and validates against the actual registered descriptor schema.

Adapters cannot create credentials, filesystem paths, permission grants,
confirmation tokens, risk values, shell/command fields, capability IDs, or
administrator flags. Workspace identity can be copied only from trusted runtime
context; it is never fabricated from owner text or model output.

Compatibility states remain explicit:

- `DIRECT_COMPATIBLE`
- `ADAPTER_COMPATIBLE`
- `MISSING_REQUIRED_INPUT`
- `INCOMPATIBLE`
- `UNKNOWN`

Only the first two may become executable plan steps.

## Matching, ambiguity, and missing input

Deterministic high-confidence rules cover the initial goal families. A future
model/semantic layer may suggest `goalId`, confidence, and extracted fields, but
the runtime rejects unknown goals and low-confidence suggestions. Ambiguous
scope, such as an unspecified comparison, asks whether the owner means public
web or approved workspace.

When required input is absent, the catalog asks the first smallest declared
question. For example, a reminder with content but no time asks only for the
time. A CCTV request without device identity asks only for the camera/NVR vendor
and model; it does not request credentials before the protocol/provider path is
known.

## Scope preservation

Catalog registration rejects undeclared capability prefixes and route scope
changes unless the route is explicitly marked as requiring an owner decision.
Workspace goals cannot silently route to public research. System health cannot
become configuration mutation. A reminder cannot become external messaging.

The model may help choose a declared goal. It cannot change runtime goal
availability, adapter registration, selected authority, or verification state.

## Alternatives and bounded pursuit

WorkAgent reuses CapabilityGapResolver and the existing replan budget. Only
declared, available, schema-compatible, existing/composed routes can be inserted
automatically. Adapter IDs and evidence are attached to plan steps and appear in
Expert Details. A higher-risk/private route is visible but never executed as an
automatic fallback. Setup, credentials, installation, new dependencies, and
scope/privilege increases stop for an owner decision.

The runtime records the selected goal, route, rejected alternatives, extracted
input evidence, adapter, capability dependencies, blockers, permission
requirements, verification expectation, and bounded attempt count. It never
stores chain-of-thought.

## Self Knowledge and UI

Self Knowledge now derives end-to-end goal readiness from the same capability
snapshot and reports `CAN_DO_NOW`, `NEEDS_APPROVAL`, `AFTER_SETUP`, `PARTIAL`,
or `CANNOT_COMPLETE`. System/Capability Explorer shows those goal records
separately from raw capability readiness. Task Center shows the human goal and
route in standard view; goal IDs, capability IDs, adapters, and evidence remain
under Expert Details.

## Honesty boundary

`REAL` means the catalog/adapter/runtime orchestration is implemented and
cloud-tested for the existing provider-independent path. It does not imply that
Windows, Ollama, owner files, browser rendering, reminder delivery, CCTV,
RTSP/ONVIF, phone, screen, voice, or Whonix were live-tested here.

MinerU/full document parsing, Content Studio, social intelligence, computer
use, and real devices remain future goal families. Their catalog shape is
extensible, but no empty fake goals or provider availability were added.
