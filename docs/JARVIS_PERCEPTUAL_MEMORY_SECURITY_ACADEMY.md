# JARVIS Perceptual Memory and Security Academy

Status: architecture study only. No external repository is installed, trusted, or executed by this document.

This addendum extends the Personal AI OS work without changing its P0/P1 delivery order. Personal Digital Memory is a future contract inside Assistant/Activity/Privacy Controls; Security Academy is a future Evolution practice source. Neither becomes a new authority system.

## CatchMe architecture study

Reference reviewed: [`HKUDS/CatchMe`](https://github.com/HKUDS/CatchMe).

CatchMe demonstrates useful event capture and organization patterns: pluggable recorders, boundary-event-driven organization, a Day → Session → App → Context → Event hierarchy, SQLite/FTS5 search, hierarchical retrieval, local model provider options, and a timeline/tree UI. Its current source also records active-window titles/paths/URLs and full clipboard text, starts keyboard/mouse/window/clipboard/idle recorders together, and stores raw event JSON plus blobs. Those defaults are not an acceptable JARVIS privacy boundary. The Windows instructions' global monitoring/admin expectation also conflicts with normal non-admin JARVIS operation.

| Idea | JARVIS classification | Decision |
|---|---|---|
| Event-driven capture adapters | MODIFY_FOR_JARVIS | Typed, separately enabled sources behind policy and a privacy gate; never one global “record all” switch. |
| Boundary events and debounce | BORROW_DESIGN | Use window/session/idle boundaries to reduce noise and close activity segments. |
| Day → Session → App → Context → Event | BORROW_DESIGN | Useful human navigation model, with provenance and source confidence on every level. |
| Tree-based retrieval | BENCHMARK_LATER | Compare recall quality, latency, privacy leakage, and storage growth against canonical retrieval. |
| Local SQLite + FTS5 staging | MODIFY_FOR_JARVIS | A bounded perceptual event store may stage redacted observations, but it cannot compete with canonical memory or bypass retention controls. |
| Local Ollama/vLLM/LM Studio summaries | ALREADY_HAVE / MODIFY_FOR_JARVIS | JARVIS already has a local-provider abstraction. Summaries remain untrusted derived observations and must carry provenance. |
| Timeline and tree exploration | BORROW_DESIGN | Prepare “Today / Sessions / Apps / Activities / Files / Visual Context / Recall” inside Activity and Assistant expert details. |
| Capture every window, key, clipboard value and screenshot | REJECT | Conflicts with minimum necessary observation and creates credential/financial/private-data risk. |
| Administrator/global-input monitoring as a default | REJECT | Normal JARVIS remains non-admin; source-specific elevation would require an independently reviewed scoped lease. |
| Production deployment or owner-machine monitoring in this cloud run | BLOCKED_LOCAL_ACCEPTANCE | Requires Windows permission, exclusion/redaction, performance, storage, screen, and owner-consent acceptance on the owner machine. |

### Privacy-first contract

```text
Windows / Digital Events
        ↓
Source-specific policy and consent
        ↓
Privacy Gate
        ↓
Sensitive Context Filter
        ↓
Redaction + minimization
        ↓
Perceptual Event Store (bounded staging)
        ↓
Hierarchical Activity Memory
        ↓
Provenanced summaries
        ↓
JARVIS canonical memory / retrieval
        ↓
Qwen as evidence, never authority
```

The Privacy Gate is fail-closed. Unknown application/window classification, filter failure, redaction failure, locked screen, secure desktop, or unavailable policy means no capture. A source cannot write directly to the event store, canonical memory, prompt, or capability host.

NEVER_CAPTURE defaults:

- password and passkey fields; credential and UAC/secure-desktop dialogs;
- password managers, OTP/2FA applications and authenticator views;
- private keys, seed phrases, certificate/private-key tooling and credential stores;
- banking, payments, checkout and card-management views;
- owner-defined private applications, windows, sites, workspaces and sessions;
- `.env`, secret stores, browser cookie/token stores and known credential paths;
- password-like, token-like, private-key-like or payment-like clipboard content;
- camera, microphone or screen sources unless that exact source has an active owner policy.

REDACT_BEFORE_STORAGE defaults:

- API keys, Discord/bot tokens, OAuth/access/refresh tokens and bearer credentials;
- authorization headers, cookies, session identifiers and signed URLs;
- PEM/private-key material, connection strings and password assignments;
- payment/card patterns, bank identifiers and high-risk personal identifiers;
- query strings, window titles, paths and notification bodies matched by policy;
- owner-configured names, applications, directories and patterns.

Redaction is performed before persistence, indexing, screenshots/blobs, summarization, logging, or model access. A hash or token fingerprint may only be retained when a typed use case requires correlation and policy explicitly permits it. Raw rejected content must not appear in rejection logs.

### Proposed typed boundary

The contract is deliberately provider-neutral:

```ts
type PerceptualSource = 'window' | 'file' | 'notification' | 'visual' | 'clipboard';

interface PerceptualObservation {
  observationId: string;
  source: PerceptualSource;
  observedAt: string;
  subject: Record<string, unknown>;
  confidence: number;
  provenance: { provider: string; policyVersion: string; redactions: string[] };
  authority: 'none';
}

interface PerceptualCaptureProvider {
  health(): Promise<'unavailable' | 'blocked' | 'ready'>;
  observe(request: ScopedObservationRequest): Promise<PerceptualObservation[]>;
}
```

Any future capabilities (`perception.observeWindow`, `perception.observeFileActivity`, `perception.recall`) must run through CapabilityHost policy. `OBSERVATION != FACT`, `PATTERN != OWNER PREFERENCE`, and `INFERENCE != AUTHORITY`. Perceptual content is untrusted data and can never request, approve, or execute a capability.

### Memory integration

JARVIS already has canonical memory IDs, provenance, confidence, supersession, source references, and audit-friendly retrieval. Perceptual storage is therefore bounded staging, not a second canonical memory:

1. Store only minimized, redacted observations with retention and deletion metadata.
2. Build human-facing session/context projections from observation IDs.
3. Create summaries as derived claims with explicit source IDs and confidence.
4. Promote only policy-eligible claims through the existing canonical memory service.
5. Preserve contradictions and supersession; a model summary never overwrites owner evidence.
6. Owner deletion removes raw blobs/index entries and records a non-sensitive deletion audit event.

Suggested lifecycle: `DISABLED → OWNER_CONFIGURED → LOCAL_ACCEPTANCE → ENABLED`, with independent source toggles, retention windows, pause controls, private lists, storage budget, export, delete-day, delete-app and delete-all controls.

### UI preparation

Do not add an empty primary navigation item. The current shell reserves coherent surfaces:

- Assistant: recall with compact source/provenance disclosure;
- Activity: Today, Sessions, Apps and activity timeline contract;
- Documents/Workspace: file observations within their existing domains;
- Settings: privacy controls, source toggles, exclusions, retention and deletion;
- Security: current observation permission and scoped lease, when real support exists.

All surfaces must show `PREPARE_CONTRACT` until a real provider, policy, store, deletion flow and local acceptance exist.

## Security Academy architecture study

Reference reviewed: [`CarterPerez-dev/Cybersecurity-Projects`](https://github.com/CarterPerez-dev/Cybersecurity-Projects).

The catalog spans defensive exercises (headers, audit, metadata, SBOM and DLP concepts) and dual-use/offensive exercises (keylogging, credential cracking, command-and-control, privilege escalation, trojans, exploit frameworks and pentesting). The repository is therefore `REFERENCE_ONLY` as a whole. It must not be bulk-cloned, installed, trusted or executed on the owner machine.

### Classification

| Material | Classification | Required treatment |
|---|---|---|
| Project names, learning objectives and benchmark shapes | REFERENCE_ONLY | Read-only catalog input; no authority. |
| Defensive validation concepts | BORROW_DESIGN | Re-express as typed JARVIS-owned exercises after separate review and tests. |
| Third-party source code | SANDBOX_REQUIRED | Pin commit, license/security review, deny network by default, disposable lab only. |
| Offensive/dual-use tooling | SANDBOX_REQUIRED or REJECT | Never owner-machine/LAN/Internet targets; only explicitly authorized isolated fixtures, if separately approved. |
| Automatic capability generation from tutorials | REJECT | Tutorials and model output cannot become executable authority. |
| Real lab runtime in this cloud run | BLOCKED_LOCAL_ACCEPTANCE | Requires an isolated lab, network controls, teardown proof and owner acceptance. |

### Proposed Security Academy flow

```text
Reviewed exercise manifest
        ↓
Disposable isolated lab
        ↓
Typed task with explicit target fixture
        ↓
Independent verification
        ↓
Objective benchmark
        ↓
Experience + Reflection
        ↓
Capability Self Model + Growth Planner
```

Each exercise manifest must declare: defensive objective, source/reference revision, license, fixture hash, allowed capabilities, target identity, network mode, risk, resource limit, timeout, expected evidence, verification oracle, cleanup/rollback, and prohibition list. Default network is `none`; the host, owner LAN, public Internet and production credentials are invalid targets.

The Academy never grants a production capability. A concept must pass `DISCOVER → REVIEW → TRUST → typed implementation → tests → owner policy` independently. Security exercise data remains untrusted and isolated from owner secrets and canonical owner preferences.

### Evidence-based evolution

An exercise may update the self model only from comparable measurements:

- immutable baseline and follow-up fixture versions;
- deterministic success/failure checks beyond exit code;
- false-positive and false-negative counts where applicable;
- resource/time budgets and repeated-run variance;
- stored evidence references and verifier identity;
- failure and regression retention.

A generated reflection, high model confidence, or one successful demonstration is not proof of improvement. Candidate skills remain candidates; failure cannot create a trusted skill and the Night Cycle cannot promote one to production.

### Current delivery status

- Personal Digital / Perceptual Memory: `PREPARE_CONTRACT`.
- CatchMe production integration: `REJECT` for capture-all defaults; otherwise `BENCHMARK_LATER` and `BLOCKED_LOCAL_ACCEPTANCE`.
- Security Academy UI concept: placed under Evolution as `REFERENCE_ONLY`.
- Third-party cybersecurity projects: `REFERENCE_ONLY` / `SANDBOX_REQUIRED`.
- Hardware capture and perpetual monitoring: `BLOCKED_LOCAL_ACCEPTANCE`.
