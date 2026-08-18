# Testing and Verification Policy

## Evidence levels

Use these exact categories when reporting state.

### 1. IMPLEMENTED
Code exists.

This alone proves nothing about runtime behavior.

### 2. UNIT_VERIFIED
Relevant unit tests passed.

### 3. OFFLINE_VERIFIED
Simulation/smoke/offline integration passed.

### 4. LIVE_VERIFIED
A real Discord/model/hardware/network run was observed.

### 5. HUMAN_QUALITY_VERIFIED
A human evaluated subjective output such as voice naturalness.

Do not collapse these into "done".

## Minimal change loop

For every code change:

1. inspect existing behavior
2. identify relevant test
3. implement smallest coherent change
4. run targeted test
5. inspect diff
6. run lint/type/build if affected
7. update status only with actual evidence

## Heavy gate

`npm run verify` is the repository-wide heavy gate.

Use when:

- a phase/integration is ready for broad validation
- shared/core behavior changed
- before asking the owner to test a new live build

Do not run it after every tiny edit if targeted tests are sufficient.

## Live tests

Never automate or fabricate:

- Discord credentials
- consent clicks
- human listening judgment
- actual voice identity quality
- real-world-intel freshness without a live source
- physical CCTV/NVR availability

If a live test cannot run, say exactly what remains unverified.

## Regression tests

Every bug fix should ideally include a test that would have failed before the fix.

Especially important for:

- barge-in cancellation
- consent/capture scoping
- persona isolation
- Discord reconnect/session state
- tool allowlist
- citation ledger
- upstream failure recovery
- file cleanup/deletion behavior
- GPU service status/degraded fallbacks

## Benchmark honesty

Benchmark output showing `OFFLINE` is not a model benchmark.

Training loss is not perceived voice quality.

Mocked MCP output is not proof of live data freshness.

Fallback TTS/LLM output is not proof the configured primary model is working.
