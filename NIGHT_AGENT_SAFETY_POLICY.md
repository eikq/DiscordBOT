# Night Agent Safety Policy

## Allowed by default
- read/search project code
- edit approved source/test/docs paths
- run approved local tests
- lint/typecheck/build
- inspect Git status/diff
- write night state/reports/escalations

## Explicit opt-in required
- install dependencies
- modify lockfiles
- modify real user DB schema/data
- local Git commits
- create/delete branches/worktrees
- network-dependent installers
- access outside project workspace
- OS scheduler changes
- services that require secrets

## Denied in v1
- Git push
- remote merge/PR
- destructive Git commands
- deleting repo/user data
- editing/printing `.env`
- live Discord/email/message sending
- live voice capture
- voice-clone training
- CCTV/NVR config
- public port exposure
- financial actions
- consent-rule changes
- disabling security controls

## Private paths blocked
At minimum:

```text
.env
.env.*
.runtime/
.venv-*/
data/voice_samples/
data/local_voice/
data/brain/
data/memory/
data/jarvis/jarvis.db
data/voice_consents.json
data/personas.json
```

## Workspace rule
Prefer an isolated workspace/worktree.

If the primary worktree is dirty, refuse unattended coding by default rather than mixing with active Cursor work.

## Command validation
Use allowlisted command families/templates, e.g.:

```text
npm test -- ...
npx tsx --test ...
npm run lint
npx tsc --noEmit
npm run build
git status --short
git diff -- ...
```

## Limits
Each task has:
- max attempts
- max minutes
- max files changed
- optional diff-size cap

Exceeding a limit creates a blocker/escalation instead of looping forever.
