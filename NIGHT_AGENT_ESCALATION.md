# Night Agent Escalation

Default local retry limit: 3 meaningful attempts.

Escalate when:
- same targeted test still fails after bounded attempts
- same exception repeats without new evidence
- architecture decision is outside task spec
- needed file/action is outside allowed scope
- dependency install is required
- security/privacy blocks the action
- regression expands outside task scope
- task time budget is exceeded

Save:

`.agent/night/escalations/<task-id>-<timestamp>.md`

Packet fields:

```text
TASK
GOAL
ACCEPTANCE CRITERIA
CURRENT PROBLEM
EXACT COMMAND
EXACT ERROR
RELEVANT FILES
CURRENT DIFF SUMMARY
ATTEMPTS
WHAT CHANGED BETWEEN ATTEMPTS
SUSPECTED ROOT CAUSE
LAST KNOWN PASSING STATE
CONSTRAINTS
RECOMMENDED NEXT ACTION
```

Cloud/Codex escalation is optional.

If quota is unavailable:
1. save packet
2. mark task BLOCKED
3. continue independent NIGHT_SAFE tasks

Never send the entire local-model conversation as an escalation.
