# Night Agent Architecture

Suggested modules (adapt to existing repo conventions):

```text
src/agent/night/
  NightOrchestrator.ts
  NightTaskQueue.ts
  NightPolicy.ts
  NightToolHost.ts
  NightWorkspace.ts
  NightStateStore.ts
  NightReporter.ts
  NightEscalation.ts
  NightResourceGuard.ts

src/agent/coding/
  CodingAgent.ts
  LocalQwenCodingAgent.ts

scripts/
  run_night_agent.ts
  prepare_night_agent.ts
```

Runtime state:

```text
.agent/night/
  state.json
  tasks.json
  reports/
  escalations/
  lessons/
  logs/
```

## Tool surface

READ:
- list/read/search project files
- inspect package scripts
- Git status/diff/log

WRITE:
- create/edit only approved workspace paths
- apply patch

EXECUTE:
- approved test/lint/typecheck/build commands

DENY:
- git push
- git reset --hard
- git clean
- arbitrary delete
- writes outside workspace
- `.env` access
- public deploy
- external messaging
- OS/network/security changes

Never execute arbitrary shell text just because the model emitted it.

## DEV_NIGHT resource profile

When the night agent runs:
- Discord off
- ASR off unless specifically required
- JaiTTS/RVC off
- one local Qwen coding agent slot
- Qwen kept warm where practical
- benchmark context instead of assuming 32K/64K
- repository/index state may use system RAM

The purpose is to give the coding model most of the GPU budget.
