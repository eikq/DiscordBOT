# JARVIS Community Edition

Local-first personal AI operating interface.

Community Edition is a clean, demoable distribution of the reusable JARVIS core. It is **not** a dump of a private owner installation.

**COMMUNITY != PRIVATE OWNER RUNTIME**

## What JARVIS is

JARVIS is a standalone conversation and software-building interface. It keeps durable memory, asks before mutating a project, and can plan, build, test, and preview a local website.

## What Community Edition can do

- Cinematic Presence UI at `/jarvis`
- Natural text conversation with follow-up / referent context
- Goal catalog and capability routing
- Permission-first software / website builder
- Typed project workspace under the Community sandbox
- Test, build, and localhost preview
- Conversation history and durable SQLite memory
- Obsidian-compatible memory projection
- Realtime operations / SSE
- Restart persistence
- Emergency Stop / bounded cancellation
- Read-only public web research

It does **not** expose CCTV, household device control, offensive security tooling, private-browser / Whonix control, Discord, or voice cloning.

## Screen / experience

Open `http://127.0.0.1:<port>/jarvis`.

The Presence view is the product. Lab at `/jarvis-lab` is a smaller Community console: conversation, tasks, research, workspace, permissions, system, activity, and settings. Owner-only pages (devices, automations, evolution, content, documents) are hidden.

## Quick start

```powershell
git clone https://github.com/eikq/DiscordBOT.git
cd DiscordBOT
git checkout release/jarvis-community-edition-v1-2026-08-23
npm install
Copy-Item .env.community.example .env.community
npm run jarvis:community
```

Windows shortcut:

```powershell
.\Start-Jarvis-Community.ps1
```

Then open `http://127.0.0.1:3012/jarvis` (or `3013` if 3012 is already in use).

Community binds `127.0.0.1` only. It does not require Administrator, Discord, or a specific GPU model.

## Model setup

Community is **model-agnostic**. Point it at any OpenAI-compatible local endpoint:

```
JARVIS_LLM_BASE_URL=http://127.0.0.1:8086/v1
JARVIS_LLM_MODEL=local-model
JARVIS_LLM_API_KEY=
```

`JARVIS_LLM_MODEL` must match an id from `GET $JARVIS_LLM_BASE_URL/models`. A placeholder name such as `local-model` will show **LOCAL MODEL OFFLINE** if the server advertises a different id.

Edit `.env.community` and restart. The UI never displays the API key after entry.

If no model is running, Presence stays usable and shows **LOCAL MODEL OFFLINE**. It does not invent answers.

Start your local model separately. Community does not download large models.

## Example commands

These are suggestions only. They are not phrase-switch authority.

- `สร้างเว็บ todo แบบ modern ให้ผม`
- `เอาตามแผนนี้`
- `อนุญาตงานนี้`
- `เพิ่ม dark mode`
- `รัน test`
- `เปิด preview`
- `หา documentation React animation ให้หน่อย`
- `จำไว้ว่าผมชอบ UI แบบ clean futuristic`
- `เมื่อกี้เราทำอะไรไปบ้าง`
- `ตอนนี้คุณทำอะไรได้บ้าง`

## Memory

Canonical memory is SQLite at `data/community/community.db`.

Obsidian files under `data/community/obsidian/` are a projection, not the source of truth.

First run starts empty. Community does not migrate owner `data/jarvis/` history, memory, permissions, or projects.

## Software builder

Typical demo:

1. Ask JARVIS to create a modern todo website.
2. Review the visual BuildPlan. No files change yet.
3. Approve the plan.
4. Grant the bounded permission.
5. JARVIS scaffolds, installs dependencies, builds, tests, and starts a localhost preview.

Follow-ups such as “เพิ่ม dark mode” continue the same project.

## Permissions

The model cannot self-grant.

Community builder may request scoped permissions such as:

- `WRITE_PROJECT`
- `INSTALL_PROJECT_DEPENDENCIES`
- `RUN_PROJECT_COMMANDS`
- `START_DEV_SERVER`
- `NETWORK_FETCH`

Blocked:

- unrestricted shell
- admin / global filesystem
- owner-home or arbitrary folder access

Default workspace is `data/community/workspaces/<slug>/`.

## Privacy

Community is local-first and loopback-bound.

Do not commit `.env.community`, `data/community/`, tokens, or private notes.

Voice cloning and raw-audio capture stay off (`RECORD_RAW_AUDIO=false`).

## Architecture

See `docs/COMMUNITY_ARCHITECTURE.md`.

Product configuration is one edition manifest (`JARVIS_EDITION=community`). The manifest is not execution authority. ActionGate still evaluates every mutating action.

## Current limitations

- CLICK / TYPE / SUBMIT computer-use actions are not available.
- Community research is public web lookup, not a private browser.
- A local OpenAI-compatible model must be started separately.
- Discord / Digital Me remains in the repository but is not started by Community.
- Owner-only CCTV, device, and cybersecurity systems are not registered.

## Community vs private / owner edition

| | Community | Owner / private |
|---|---|---|
| Data root | `data/community/` | `data/jarvis/` |
| Presence + builder | yes | yes |
| Memory / history | isolated | isolated |
| Devices / CCTV | not registered | private |
| Cyber / Whonix | not registered | private |
| Discord / voice clone | not started | existing Digital Me |

Owner work continues on private branches after this submission.
