# JF-011 — Jarvis runtime + system capabilities

Jarvis can inspect this machine and manage **only registered Jarvis-owned
services**. It still has no generic process, shell, or filesystem API.

## Invariants

```
REGISTERED JARVIS SERVICE  !=  ARBITRARY PROCESS
SERVICE ACTION             !=  SHELL COMMAND
```

The conversational LLM still cannot:

- run arbitrary shell / PowerShell / `cmd.exe`
- pass executable paths, PIDs, ports, or argv
- enumerate every installed program
- change Windows settings (it may only **open** an allowlisted Settings page)
- add services via Skills or Persona

JF-010 permission boundaries are unchanged.

## Authority order

1. Host / mutation boundary (loopback + Origin/Host)
2. `PermissionPolicy`
3. Capability registry + `JarvisServiceRegistry` (code/config only)
4. Owner allowlists (`applications.json`, `settings.json`)
5. Skill guidance (instruction/reference only)
6. Persona (style only)

## Local mutation API boundary

Standalone Lab binds to loopback (`127.0.0.1`) when `JARVIS_STANDALONE=1`.
`HOST=0.0.0.0` is forced back to `127.0.0.1`.

Mutating routes (`/api/jarvis/ask`, `/ask-stream`, `/actions/confirm`,
`/actions/deny`, `/presentation`) require:

- loopback `Host`
- same-origin `Origin` (or `Referer` when Origin is absent)
- reject `Sec-Fetch-Site: cross-site`
- `Content-Type: application/json`
- body ≤ 16 KB
- no confirmation tokens in the query string

There is no permissive CORS. CLI/text harnesses do not use these HTTP routes.

Threat mitigated: a random website using the owner's browser to POST to
`127.0.0.1`. Local malware is out of scope.

## Jarvis service registry

Registered ids (do not invent more):

| id | Lifecycle | Notes |
|---|---|---|
| `ollama` | start / stop / restart | `ollama serve` only — does **not** preload 27B |
| `qwen-asr` | start / stop / restart | existing local STT starter |
| `jarvis-tts` | start / stop / restart | existing JaiTTS starter |
| `rvc` | start / stop / restart | existing local voice starter |
| `embedding` | health only | no start/stop from Jarvis |
| `jarvis-lab` | health only | never stop the confirmation server |

The model passes `serviceId: "qwen-asr"`, never a command, path, or PID.

The model cannot add services. Skills cannot change the catalog or risk class.

### Lifecycle

`STOPPED → STARTING → RUNNING → STOPPING → STOPPED`, plus `DEGRADED` / `UNKNOWN`.

- start while running → `ALREADY_RUNNING`
- start while starting → one in-flight operation (no duplicate spawn)
- stop while stopped → `ALREADY_STOPPED`
- stop/restart of a process Jarvis did not spawn → `NOT_OWNED` (no `taskkill` by name)
- adapter failure / timeout → honest `failed` codes

Internal launch uses existing project starters or exact executable + argv with
`shell: false`. Start does not fake-timeout the spawn (STT/TTS may take minutes);
the HTTP/action turn may return `STARTING` after 2s.

## Capabilities

| id | Args | Risk |
|---|---|---|
| `system.status` | none | `READ_ONLY` |
| `system.batteryStatus` | none | `READ_ONLY` |
| `system.networkStatus` | none | `READ_ONLY` |
| `applications.status` | optional `applicationId` | `READ_ONLY` |
| `jarvis.runtimeStatus` | none | `READ_ONLY` |
| `jarvis.healthCheck` | optional `serviceId` | `READ_ONLY` |
| `jarvis.startService` | `serviceId` | `LOW_RISK_ACTION` |
| `jarvis.stopService` | `serviceId` | `CONFIRM_REQUIRED` |
| `jarvis.restartService` | `serviceId` | `CONFIRM_REQUIRED` |
| `desktop.openSettings` | `settingsId` | `LOW_RISK_ACTION` |

`desktop.openSettings` allowlist: `bluetooth`, `display`, `sound`, `network`,
`windows-update`. Resolved internally to known `ms-settings:` URIs. Raw URIs
from the model are rejected.

Optional voice-stack group actions were **not** added (would duplicate
per-service start/stop). Phrase `ระบบเสียง` maps to `qwen-asr`.

## System / runtime honesty

Unavailable telemetry is `unavailable` with a reason. Values are never invented
(no fake `0%` CPU/battery).

- CPU: two `os.cpus()` samples (~80ms apart) when needed
- RAM: `os.totalmem` / `freemem`
- Disk: `fs.statfs`
- GPU/VRAM: cached `nvidia-smi` via `execFile` (5s TTL; 60s backoff on failure)
- Battery: `WMIC.exe` `Win32_Battery` via `execFile` (15s cache). Not PowerShell.
- Network: `os.networkInterfaces()` only (10s cache). No external ping, no IPs, no passwords.

`applications.status` reports **allowlisted ids only**.

`jarvis.runtimeStatus` aggregates Core, registered services, memory file,
capabilities, skills, and last-known Night Agent state. One failed provider
does not invent the rest.

## Command Center

Existing right-side panels only. `/api/jarvis/status` attaches a cached service
snapshot (3s probe TTL). UI polls: status 20s, system 5s (battery/network reuse
their caches), night 30s. Hidden-tab polling pauses.

START / RESTART buttons call `/api/jarvis/ask` with `capabilityCalls` and
`actionSource: "ui"` — same CapabilityHost + PermissionPolicy path. Confirm
uses the existing JF-010 card. No UI backdoor.

Read-only health polling is **not** written to the persistent action audit.
Owner/UI/voice requested actions are audited.

## Polling strategy

| Signal | Interval / cache |
|---|---|
| Service HTTP health | 3s cache; UI 20s |
| GPU `nvidia-smi` | 5s cache |
| Battery WMIC | 15s |
| Network interfaces | 10s |
| Disk | on `/api/jarvis/system` (5s UI) |

Do not probe from the WebGL frame loop.

## How to add a Jarvis-owned service

1. Confirm the process already exists in this repo and has a trusted starter.
2. Add a catalog row in `src/jarvis/capabilities/actions/services/catalog.ts`.
3. Add a health URL in `services/health.ts` using existing env/port config.
4. If lifecycle is allowed, add an adapter that uses exact argv and `shell: false`.
5. Never accept model-supplied command/path/port.
6. If stop would kill the confirmation server, set `stopAllowed: false`.
7. Add tests: unknown ids rejected, owned-only stop, confirmation for stop/restart.

## Audit

Reuse JF-010 append-only `data/jarvis/audit/actions.jsonl`.

Example:

```json
{
  "capabilityId": "jarvis.restartService",
  "targetClass": "jarvis-service:qwen-asr",
  "decision": "execute",
  "result": "completed"
}
```

No command line, executable path, secrets, full conversation, or confirm token.

## Skills

JF-SKILLS-001 remains instruction/reference only. `scriptsAllowed = false`.
A skill may recommend `jarvis.startService { serviceId: "qwen-asr" }`.
It cannot invent ids, change the registry, alter risk, or bypass confirmation.

## Prohibited

There are no capabilities named:

- `system.killProcess`
- `system.runProcess` / `system.exec` / `system.shell`
- `system.startExecutable`
- `system.stopProcessByName`
