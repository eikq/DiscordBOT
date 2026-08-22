# JARVIS Community Architecture

## Principle

Community Edition packages the reusable JARVIS core. It does not ship a private owner runtime.

```
COMMUNITY
├─ conversation
├─ memory / history
├─ research (public)
├─ software builder
├─ project workspace
├─ plans
├─ permission
└─ localhost preview

OWNER / PRIVATE
├─ everything community has
└─ devices, CCTV, desktop control, world-intel MCP,
   private browser / Whonix, owner service control
```

## Edition switch

`JARVIS_EDITION=community` selects one typed manifest in `src/jarvis/edition/`.

The manifest is product configuration. It is not execution authority.

Path helpers (`jarvisDataRoot`, `jarvisMemoryDbName`, `jarvisWorkspaceDirName`) read the edition once. Call sites do not scatter `if (community)` checks.

## Data isolation

| Owner | Community |
|---|---|
| `data/jarvis/` | `data/community/` |
| `jarvis.db` | `community.db` |
| `builds/` | `workspaces/` |

Override with `JARVIS_DATA_ROOT` for tests. Community refuses the owner `data/jarvis` root.

Generated Community state is gitignored. There is no automatic owner-data migration.

## Capability registration

`createEditionCapabilityHost()` is the Community entrypoint.

Community registers conversation-supporting hosts: public research, software/project, reminders, workspace intel, recovery sandbox, and ActionGate.

Community does **not** register:

- desktop / Windows display control
- runtime service start/stop
- world-intel MCP
- `research.privateBrowse`
- CCTV / device contracts

`guardCommunityHost()` also rejects those IDs if invoked.

## Permissions

ActionGate remains in front of mutating work.

Builder requests stay scoped to the Community sandbox. Unrestricted shell, admin, and global filesystem stay denied. The model cannot self-grant.

## Model

`JARVIS_LLM_BASE_URL`, `JARVIS_LLM_MODEL`, `JARVIS_LLM_API_KEY`.

Fallback model name is `local-model`, not an owner-specific GGUF id. The UI must not require Qwen3.8 Cyber.

## UI

- `/jarvis` — cinematic Presence. Community welcome, sample prompts, model offline/setup.
- `/jarvis-lab` — filtered pages from `COMMUNITY_LAB_PAGE_IDS`.

## Startup

`npm run jarvis:community` or `Start-Jarvis-Community.ps1` sets `JARVIS_STANDALONE=1`, binds `127.0.0.1`, and skips Discord.
