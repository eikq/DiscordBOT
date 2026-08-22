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

`JARVIS_EDITION=community` → `CommunityEditionManifest` → `jarvisProviderPlan()` → only Community provider factories run.

`createEditionCapabilityHost()` is the Community entrypoint. It sets `worldIntel: false`, `desktop: false`, and `privateGateway: false` before the standalone host is built.

`applyCommunityEditionEnv()` also sets `JARVIS_COMMUNITY_PROVIDER_LOCK=1`. Private constructors and process launchers (WorldIntel MCP, Discord client start, private-browser/Whonix health, desktop adapter, simulated devices, Night Orchestrator, voice-clone client) throw if that lock is set.

Community registers conversation-supporting hosts: public Wikipedia/DuckDuckGo research, software/project, reminders, workspace intel, recovery sandbox, and ActionGate.

Community does **not** register, start, spawn, or route:

- desktop / Windows display control
- runtime service start/stop
- world-intel MCP
- `research.privateBrowse` / Whonix / private browser
- CCTV / device contracts
- Discord
- voice cloning
- Night Agent
- cybersecurity capability subsystem

`guardCommunityHost()` also rejects those IDs if invoked. Community HTTP middleware 404s the matching Digital Me / owner routes.

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

`npm run jarvis:community` or `Start-Jarvis-Community.ps1` sets `JARVIS_STANDALONE=1`, binds `127.0.0.1`, applies the Community provider lock, and skips Discord.

Public research uses only the Community-safe Wikipedia + DuckDuckGo path. It does not construct `ResearchAssistant` / `McpResearchGateway` and does not spawn `world-intel-mcp`.
