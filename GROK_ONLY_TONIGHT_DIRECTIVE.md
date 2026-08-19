# Grok-Only Tonight Directive

Status: TEMPORARY ACTIVE OVERRIDE FOR FIRST REAL NIGHT

## Provider policy

Tonight:

```text
PRIMARY = Cursor CLI / exact Grok 4.6 variant selected by owner
LOCAL QWEN = DISABLED
CODEX = DISABLED
OTHER CLOUD FALLBACK = DISABLED
```

On quota/model/auth/provider failure:

```text
record provider failure
→ finish current deterministic bookkeeping
→ mark task BLOCKED_PROVIDER
→ mark remaining READY tasks BLOCKED_PROVIDER or leave READY according to state policy
→ write NIGHT_REPORT
→ STOP
```

Do not silently switch models.

## Cursor CLI setup

Official Cursor CLI supports Windows PowerShell installation and the `agent` command.

Setup must:

1. Check `Get-Command agent`.
2. If missing, require explicit owner action to install the official Cursor CLI.
3. After install, re-check `Get-Command agent`.
4. Run:
   - `agent --version`
   - `agent status`
5. If unauthenticated, stop setup and ask owner to run:
   - `agent login`
6. Run:
   - `agent models`
   - or `agent --list-models`
7. Resolve the exact CLI model id corresponding to the owner's requested Grok 4.6 variant.
8. Never guess the model id.

If the exact requested variant is not exposed by CLI, STOP and report available Grok model ids.

## Headless edits

Cursor print/headless mode requires direct-write approval for unattended file modification.

For tonight, if `--force` is required by the installed CLI, it is allowed ONLY under all of these conditions:

- isolated night worktree
- Cursor sandbox enabled
- project `.cursor/cli.json` installed
- shell denied to Cursor agent
- web fetch denied
- MCP denied
- private data denied
- write paths limited
- NightOrchestrator validates final changed-file scope
- acceptance commands are executed by NightToolHost, not by Grok

`--force` is not permission to bypass the Night Agent policy.

## Cursor agent role

Cursor/Grok is a PATCH WORKER.

It may:
- read allowed code/docs/tests
- edit allowed code/docs/tests

It may NOT:
- run arbitrary shell
- run Git
- install packages
- access network tools
- access MCP
- decide PASS
- decide next task
- change retry limits

The NightOrchestrator runs acceptance commands through NightToolHost.

## Fresh agent per task

Each task uses a fresh headless Cursor agent process.

Do not `--resume` or `--continue` across tasks.

## Local resource policy

Because Cursor/Grok is cloud-backed for tonight:

- Local Qwen coding fallback OFF
- Ollama is not required by Night Agent
- ASR OFF
- JaiTTS OFF
- RVC OFF
- Discord OFF

The owner may stop Ollama before sleeping after the Grok dry-run passes.

This keeps local GPU load low.
