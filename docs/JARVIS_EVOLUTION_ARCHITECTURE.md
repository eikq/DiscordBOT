# Evolution architecture (foundation only)

EVO-001+ is **not** autonomous yet. This repo now has fail-closed primitives:

- `ExperienceStore` — structured experiences; webpage/skill cannot write;
  secrets are rejected
- `reflectOnExperience` — structured fields only, no hidden CoT
- `SkillVersionRegistry` — versioned skills; never overwrite the only
  known-good; rollback
- `createCandidateSandbox` / `rejectProductionWrite` — candidates cannot
  edit production
- `resolveMemoryContradiction` — webpages cannot overwrite memory

Promotion, night consolidation, affect, and LoRA remain FUTURE. JF-015
multi-step work is not started.
