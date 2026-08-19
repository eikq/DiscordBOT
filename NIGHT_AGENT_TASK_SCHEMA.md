# Night Task Schema

Machine-readable queue:

`.agent/night/tasks.json`

Example:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "NIGHT-001",
      "title": "Add regression coverage",
      "status": "READY",
      "nightSafe": true,
      "priority": 100,
      "risk": "low",
      "goal": "Add deterministic regression coverage.",
      "scope": ["src/jarvis/", "tests/"],
      "acceptanceCommands": [
        "npx tsx --test tests/example.test.ts",
        "npm run lint"
      ],
      "maxAttempts": 3,
      "maxMinutes": 30,
      "maxFilesChanged": 6,
      "dependencies": [],
      "requiresHuman": false,
      "requiresNetwork": false,
      "requiresSecrets": false
    }
  ]
}
```

Statuses:
- READY
- IN_PROGRESS
- PASS
- BLOCKED
- NEEDS_HUMAN_VERIFY
- SKIPPED
- FAILED_LIMIT

The orchestrator selects only READY + nightSafe tasks whose dependencies passed and whose policy requirements are allowed.

The model never marks PASS directly. Acceptance commands/evidence determine PASS.
