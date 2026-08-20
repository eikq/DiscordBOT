# Evolution architecture (fail-closed runtime)

EVO-001–010 now have a **fail-closed runtime**, not autonomy:

- `ExperienceStore` — structured experiences; webpage/skill cannot write;
  secrets are rejected; owner claims can supersede; TTL stale
- `reflectStructured` — structured fields only, no hidden CoT
- Failure reflections **cannot** mint trusted skill candidates
- `SkillVersionRegistry` / skill lifecycle — versioned skills; never
  overwrite the only known-good; rollback
- `FailureLedger` — repeated-failure signatures
- `CapabilitySelfModel` — `INSUFFICIENT DATA` until n≥3
- `GrowthPlanner` — max 3 active goals
- `NightCycle` — pauses on `realtime_voice`; owner-gated
- `AffectEngine` — style only; `affectCannotAuthorize`
- `CandidateManager` — sandbox only; `productionPromotionAllowed()` is always false
- `ModelAdaptationRegistry` — LoRA **registry only** (`trained: false`)
- `createCandidateSandbox` / `rejectProductionWrite` — candidates cannot
  edit production
- `resolveMemoryContradiction` — webpages cannot overwrite memory

Simulated Command Center demos (`research|coding|evolution|monitoring`)
are tagged `simulated: true`. Do not treat them as live verified.
