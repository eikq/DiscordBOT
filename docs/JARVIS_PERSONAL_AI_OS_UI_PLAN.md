# JARVIS Personal AI Operating Interface — cloud implementation plan

Date: 2026-08-21  
Base: `cursor/jarvis-cloud-finalization-4838`

Implementation status: completed on `work/jarvis-trusted-operator-ui` for the
cloud-safe scope. The original dashboard remains temporarily in source as an
unmounted acceptance reference; `JarvisOperatingPage` owns the live route.
Local visual/provider/hardware acceptance is intentionally not claimed.

## Current-state audit

`JarvisLabPage` is an overloaded 2,000+ line surface. It owns data polling, SSE,
microphone/STT, speech playback, the WebGL scene, memory graph interaction,
assistant composition, approval handling, and every operational panel. The
result is a three-column engineering command center in which daily actions
compete with provider telemetry.

`CommandCenterPanels` repeats the same problem at component level: task state,
evolution, source graph, devices, and owner controls are rendered together.
Status also appears repeatedly in the top ribbon, active context, system
meters, model status, voice/STT status, live operations, and the central core.

Human-facing and expert-only information are mixed. Capability IDs, route
names, session IDs, providers, provenance IDs, FPS, camera controls, raw graph
controls, and latency internals are visible during ordinary use. Research,
workspace, reminders, evolution, devices, and security controls are placed in
a permanent operations rail instead of dedicated destinations.

## Function map

| Existing function | Future destination | Default visibility |
|---|---|---|
| Core state, current task, alerts, quick Ask | Home | Standard |
| Conversation, persona, voice, microphone, attachments contract | Assistant | Standard; timings in Expert Details |
| WorkAgent objective, DAG, permission wait, evidence, cancel | Tasks | Standard; IDs in Expert Details |
| Public research stages, sources, evidence, provenance | Research | Standard; raw source IDs in Expert Details |
| MinerU provider contract | Documents | Prepared / not configured |
| Local index, results, excerpts, refresh, Tokei contract | Workspace | Real index; metrics prepared |
| Multi-agent video/content pipeline | Content | Prepared contract |
| PC/vision/phone/CCTV capability separation | Devices | Real provider status or honest simulation/blocker |
| Reminders and scheduler | Automations | Real configured runtime |
| Experience, reflection, skills, failures, Night Cycle | Evolution | Honest data or insufficient-data state |
| Approval, autonomy, host protection, privilege leases | Security | Standard summary; lease internals in Expert Details |
| CPU/RAM/GPU/disk, model, voice/STT, services, capability explorer | System | Standard summary; raw metrics in Expert Details |
| Event stream, filters, task/capability/risk/status evidence | Activity | Dedicated audit timeline |
| Persona/voice, quality, proactive preferences | Settings | Standard |
| Memory graph and provenance inspector | Assistant/Activity Expert Details | On demand |

## Implementation sequence

1. Add a persistent personal-AI application shell with page navigation,
   human-readable page context, global `Ctrl/Cmd + K` command palette, and an
   always-accessible but confirmation-gated Emergency Stop contract.
2. Recompose the existing real runtime data into dedicated pages. Home becomes
   calm and answerable in five seconds; expert telemetry moves behind details.
3. Add trusted-operator components: `RiskBrief`, `PermissionCard`,
   `VerificationReport`, `RollbackStatus`, `ActivePrivilegeLease`,
   `OwnerApprovalDialog`, and `EmergencyStop`.
4. Keep every existing API and action path. Do not turn prepared provider
   concepts into live claims. Label simulation and local acceptance blockers.
5. Add deterministic UI-model tests, run cloud tests, typecheck, and build.

## Delivered outcome

- The mounted route is page-based; permanent memory/telemetry/debug rails no
  longer compete with conversation or the current task.
- Existing real endpoints are recomposed, not replaced. Prepared providers are
  labeled and disabled instead of filled with fake data.
- Host status, canonical memory, capability activity, research/workspace
  provenance, reminders, WorkAgent tasks and command-center audit data remain
  observable.
- Risk and approval use request-bound data. Emergency Stop and lease inventory
  are explicitly prepared contracts until typed read/revocation APIs exist.
- CatchMe/Personal Digital Memory and Security Academy addendum decisions live
  in `JARVIS_PERCEPTUAL_MEMORY_SECURITY_ACADEMY.md` and do not add empty primary
  navigation.
