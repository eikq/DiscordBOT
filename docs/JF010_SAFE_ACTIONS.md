# JF-010 — Safe permissions and action execution

Jarvis may perform a small set of local desktop actions. The conversational
LLM never receives a shell, PowerShell, or arbitrary filesystem API.

## Authority order

1. System / host policy
2. Jarvis `PermissionPolicy`
3. Capability registry
4. Owner-approved allowlist config
5. Skill guidance (instruction/reference only)
6. Persona (style only)

A skill cannot add capabilities, change risk, bypass confirmation, execute a
process, or edit allowlists.

## Action flow

```
JarvisRequest
  → deterministic intent (optional)
  → ActionProposal (schema-validated arguments)
  → PermissionPolicy
  → CapabilityHost / ActionGate
  → DesktopActionAdapter (exact executable + argv)
  → structured ActionResult
```

Never: `LLM → shell(command)`.

## Risk classes

| Risk | Decision | Examples |
|---|---|---|
| `READ_ONLY` | allow | `system.status` |
| `LOW_RISK_ACTION` | allow | allowlisted app/project, trusted local Jarvis URL |
| `CONFIRM_REQUIRED` | confirm | arbitrary `https` URL |
| `BLOCKED` | deny | shell, delete, install, `javascript:`/`file:`/`data:`, unknown ids |

Fail closed: unknown app, invalid arguments, missing policy, expired/reused
confirmation, malformed proposal → deny or unavailable. No silent shell fallback.

## Current capabilities

| Id | Risk | Arguments |
|---|---|---|
| `desktop.openApplication` | `LOW_RISK_ACTION` | `{ applicationId }` |
| `desktop.openProject` | `LOW_RISK_ACTION` | `{ projectId }` |
| `desktop.openTrustedUrl` | confirm unless trusted local | `{ url }` |
| `system.status` | `READ_ONLY` | `{}` |

`lab.ping` and `world-intel.*` still pass through the existing host without
this gate.

## Confirmation

`CONFIRM_REQUIRED` actions issue a one-use server token bound to
`proposalId + argumentsHash`. TTL is 120 seconds.

- The model cannot inject `confirmed: true`.
- Changing arguments requires a new confirmation.
- Expired, reused, denied, or mismatched tokens cannot execute.
- UI: **Deny** / **Allow once**. No persistent always-allow in v1.
- Voice uses the same policy. Only an explicit whole-utterance confirm
  (`yes`, `allow once`, `ได้`, `อนุญาต`, …) while a proposal is pending
  counts as approval.

## Application allowlist

Owner config: `config/jarvis/applications.json`.

Add an app by giving it a stable `id`, `displayName`, and `candidates` (env
expansions such as `%SystemRoot%` are resolved at load). Jarvis receives
`applicationId`, never an executable path. If every candidate is missing,
the result is honest `unavailable`.

Projects: `config/jarvis/projects.json` (`projectId` only; no `..` escape).
Trusted local URLs: `config/jarvis/trusted-urls.json`.

## Adding a future capability

**A new action capability is not a new shell command.**

1. Register a typed capability with a narrow argument schema.
2. Add a dedicated adapter method (exact executable + argv, `shell: false`).
3. Assign a risk class in `PermissionPolicy`.
4. Validate arguments before policy.
5. Audit structured events only (no prompts, tokens, or secrets).
6. Add fail-closed tests.

Do not concatenate user text into a process command line.

## Audit

Append-only JSONL at `data/jarvis/audit/actions.jsonl` (gitignored).

Records: timestamp, proposalId, capabilityId, risk, decision, result, source,
optional reasonCode / targetClass.

Does not record: tokens, prompts, executable paths, credentials.

Opening Spotify is audit/history, not an automatic personal memory fact.

## Prohibited in JF-010

Arbitrary shell, file create/edit/delete, software install, registry/service
control, volume, keyboard/mouse, browser automation, sending messages,
purchases, CCTV, shutdown, admin elevation, credentials, clipboard,
screenshots, persistent always-allow, autonomous background actions.
