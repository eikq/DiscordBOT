# Evolution architecture (fail-closed runtime)

EVO-001–010 now have a **fail-closed runtime**, not autonomy.
Queue 04 adds **Procedural Skills V2** on the same `evolution.db`.

- `ExperienceStore` — structured experiences; webpage/skill cannot write;
  secrets are rejected; owner claims can supersede; TTL stale
- `runExperiencePipeline` / `applyTaskOutcome` — one lifecycle per task
  (`exp_task_<id>`), idempotent:
  task → experience → outcome verification → success/failure class →
  structured reflection → memory candidate → skill candidate →
  isolated benchmark candidate
- `reflectStructured` — structured fields only, no hidden CoT
- Failure reflections **cannot** mint trusted skill candidates
- Skill trust states: `DRAFT` → `REVIEW_REQUIRED` → `TRUSTED` |
  `REJECTED` | `DEPRECATED`. Stages stay
  `DISCOVER != INSTALL != REVIEW != TRUST != EXECUTE`
- Only `TRUSTED` skills are auto-selected. Skill text is a **plan**, not
  authority; CapabilityHost / ActionGate still execute
- Isolated skill benchmarks never set `TRUSTED`. `autoPromote=false`.
  Jarvis / model / skill actors cannot `trust()`
- `FailureLedger` — structured kinds: capability_unavailable,
  provider_timeout, unsupported_host, known_bad_plan, owner_denied,
  verification_failed. Planning may avoid known failures without
  granting new privileges
- `CapabilitySelfModel` — `INSUFFICIENT DATA` until n≥3
- `GrowthPlanner` — max 3 active goals
- `NightCycle` — pauses on `realtime_voice`; owner-gated; still
  success-only DRAFT skill proposals
- `AffectEngine` — style only; `affectCannotAuthorize`
- `CandidateManager` — sandbox only; `productionPromotionAllowed()` is always false
- `ModelAdaptationRegistry` — LoRA **registry only** (`trained: false`)
- `createCandidateSandbox` / `rejectProductionWrite` — candidates cannot
  edit production
- `resolveMemoryContradiction` — webpages cannot overwrite memory

Simulated Command Center demos (`research|coding|evolution|monitoring`)
are tagged `simulated: true`. Do not treat them as live verified.
No uncontrolled recursive self-modification.
