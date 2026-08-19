# Night Agent Reporting

Write a morning report:

`.agent/night/reports/NIGHT_REPORT-YYYY-MM-DD.md`

Include:

## Run
- start/end/duration
- model/runtime
- workspace/branch
- DEV_NIGHT config

## Completed tasks
- task id/title
- files changed
- acceptance commands
- attempts
- duration

## Blocked / needs human verify
- reason
- escalation packet

## Tests
- commands and results

## Safety
- denied model actions
- private-path attempts
- policy violations blocked

## Git
- final status
- diff summary
- explicit no-push confirmation

## Resources
- GPU/RAM/OOM/reload events
- chosen context/runtime settings

## Owner actions
A concise morning checklist.
