# Night Agent Provider Override — Tonight

Status: TEMPORARY ACTIVE OVERRIDE

## Goal

Tonight, use Cursor's Grok 4.6 agent as the primary coding worker.

Architecture:

```text
Night Orchestrator
      |
      v
Cursor Agent CLI
Grok 4.6
PRIMARY
      |
      +---- unavailable / usage exhausted ----+
                                              |
                                              v
                                      Local Qwen Coding Agent
                                          FALLBACK
```

## Important

The deterministic Night Orchestrator remains in control.

Changing the model provider must NOT give the Cursor agent unrestricted control of:
- task selection
- task safety classification
- pass/fail decisions
- retry limits
- filesystem policy
- protected paths
- Git push
- destructive commands

Cursor/Grok is the worker, not the orchestrator.

## Provider order

For tonight:

1. `cursor-grok`
2. `local-qwen`
3. `blocked/escalation packet`

If Cursor usage/quota is exhausted or the CLI returns a provider/auth/model error, switch to local Qwen for the next eligible attempt/task instead of stopping the whole night.

## Exact model id

Do not guess the CLI model string.

Before the run:

```powershell
agent --list-models
```

Resolve the model corresponding to the owner's currently available **Grok 4.6 Extra High Fast** selection.

Store that exact CLI model id in Night Agent config.

If the exact variant is not exposed by Cursor CLI, report the closest available Grok 4.6 variant and require owner approval before silently substituting another model.

## Invocation

Use Cursor CLI headless/print mode programmatically.

Conceptually:

```powershell
agent -p "<task packet>" `
  --model "<resolved-grok-4.6-model-id>" `
  --workspace "<night-workspace>" `
  --output-format stream-json
```

Use structured output parsing where practical.

Do not parse free-form terminal decoration as control signals.

## Context policy

Each NIGHT_SAFE task starts a fresh Cursor agent invocation.

Do not resume one huge chat across the entire night.

Each task gets:
- AGENTS.md
- exact task
- acceptance criteria
- concise project state
- allowed scope
- relevant files/context
- latest failure on retry

## Safety

Do not use `--force` / `--yolo` merely to avoid prompts.

Prefer project-specific Cursor CLI permissions plus the NightToolHost/orchestrator policy.

The overnight runner must still deny:
- Git push
- destructive Git
- `.env` access
- writes outside night workspace
- private voice/memory stores
- Discord sends
- CCTV changes
- deploys
- arbitrary dependency installation

## Usage strategy

Because Cursor usage is limited, Grok should handle:
- implementation
- multi-file reasoning
- difficult debugging
- test-driven fixes

Do not waste Grok calls on:
- formatting-only work
- trivial report generation
- deterministic task selection
- status polling
- simple test execution

The orchestrator performs those locally.

## Fallback

If Cursor CLI reports:
- quota exhausted
- model unavailable
- authentication failure
- repeated provider failure

then:
1. record the provider failure
2. keep task state
3. use local Qwen if task policy permits
4. otherwise save escalation packet
5. continue independent tasks

## Reporting

Morning report must show per task:

```text
Worker:
- Cursor/Grok 4.6
- Local Qwen fallback

Cursor attempts:
Local Qwen attempts:
Provider failures:
```

This lets the owner see exactly where Cursor usage was spent.
