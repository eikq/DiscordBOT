# Cursor Cloud sequential queue status

Updated: 2026-08-20

This is the continuation pointer for the long-running Cloud development
queue. Later queued prompts must **not** restart from
`origin/local/jarvis-acceptance-2026-08-20`.

## Continuation branch

`cursor/jarvis-cloud-evolution-2026-08-20`

Fetch and continue from the latest successfully pushed HEAD of that
branch only. Do not merge. Do not push `main`. Do not force push.

## Queue 01 — Presenter Intelligence + Desktop Presence

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Base: `8aba6b019c436b1e636f32274607015a4dc23e38`
(`origin/local/jarvis-acceptance-2026-08-20`)

Work landed first on
`cursor/jarvis-presenter-desktop-cloud-2026-08-20-4838` and is now the
starting HEAD of the dedicated evolution branch.

Queue 01 HEAD: `5d6e5bc32cf6d5d330e37e9dff0eccb1ccf11d89`

Cloud evidence: `npx tsc --noEmit` PASS; targeted Presenter/Desktop
48/48; `npm run test:cloud` **517/517**.

Labels stay:

- LA-001 **PARTIAL**
- LA-002 **PARTIAL**
- LA-026 **PARTIAL** (live speech↔motion NEEDS_LOCAL_VERIFY)
- LA-027 **PARTIAL — NATIVE_SHELL_REQUIRED**

Native helper is not installed. Do not mark LIVE_VERIFIED from Cloud.

Handoff: `CURSOR_CLOUD_PRESENTER_DESKTOP_HANDOFF.md`.

## Queue 02 — Research Intelligence V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Queue 02 HEAD: `d02f40155aa1521cefbf24fc05aac605310462de`

Structured query planning, depth budgets (NONE never hits providers),
source trustClass metadata, dedup with provenance, claim/evidence
links, contradiction reporting, cache honesty, citation grounding,
research Presenter mapping, observable traces. PRIVATE_BROWSER stays
fail-closed. Whonix/Tor: **LOCAL_VERIFY_REQUIRED**.

Cloud evidence: `npx tsc --noEmit` PASS; targeted research/v2 +
JF-013 + Presenter briefing tests green; `npm run test:cloud`
**532/532**.

Handoff: `docs/JF013_SAFE_WEB_RESEARCH.md`, ADR-024.

## Queue 03 — Canonical Memory Intelligence V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Implementation: `b7b9e49dc6c637fef4ea847d39254bd8693b55f2`
Queue 03 HEAD: `7b8b19dd08f3fc8db350c116a7c598fdd443bf47`

SQLite remains canonical truth. Qdrant/vector is a derived retrieval
index only and is **not** started. Obsidian/view layers stay
presentation only. SocialMemoryBrain JSON/JSONL is unchanged.

Shipped:

- Schema v3 quality fields: confidence, importance, status, provenance,
  created/updated, ownerTrusted, derived, memoryClass, supersedes,
  expiry, memoryRefs
- Statuses: ACTIVE / SUPERSEDED / FORGOTTEN / EXPIRED (no silent overwrite)
- Owner preference change: new fact + old retained as superseded
- Hybrid fusion: lexical/FTS + optional semantic hits + recency +
  importance + active + class relevance; orphan vector ids dropped
- Query-aware classes: conversation / technical / device / general
- Bounded turn retrieval (default 8, max 12) with transparent scores
- Episode → significance → candidate → validate → semantic or reject
- Web/research cannot become owner-trusted facts
- Owner correction: จำอันนี้ / อันนี้ไม่ใช่ / เปลี่ยนเป็น / ลืมเรื่องนี้
- Optional Presenter "Jarvis remembered this because..." provenance view

Cloud evidence: `npx tsc --noEmit` PASS; `npm run test:cloud` **541/541**.

Handoff: ADR-025, `tests/jarvis_memory_v2.test.ts`.

## Queue 04 — Safe Evolution + Procedural Skills V2

Status: **COMPLETE** (cloud-safe software). Not LIVE_VERIFIED.

Implementation: `866e843`

Preserve `DISCOVER != INSTALL != REVIEW != TRUST != EXECUTE`.
Jarvis may never approve its own privilege expansion.
`autoPromote=false`. Skill instructions are plans, not authority.

Shipped:

- One idempotent task lifecycle: experience → verify → classify →
  reflection → memory candidate → skill candidate → isolated benchmark
- Skill candidate fields: id, name, goal, trigger conditions, required
  capabilities, steps, preconditions, verification, failure modes,
  security scope, evidence, version, trust status
- Trust states: DRAFT, REVIEW_REQUIRED, TRUSTED, REJECTED, DEPRECATED
- Trusted-only retrieval; rejected/deprecated excluded
- Structured failure knowledge; planning may avoid known failures
  without new authority
- Isolated benchmark never sets TRUSTED
- No uncontrolled recursive self-modification

Cloud evidence: `npx tsc --noEmit` PASS; targeted skills/evolution tests
green; `npm run test:cloud` **553/553**.

Handoff: ADR-026, `tests/jarvis_skills_v2.test.ts`.

## Operating constraints still in force

- LLM output ≠ execution
- CapabilityHost / ActionGate remain authoritative
- Jarvis cannot approve itself
- web / model / skills output = untrusted data
- no unrestricted production shell
- no uncontrolled recursive self-modification
- no multi-agent swarm
- no automatic LoRA training / skill promotion / restricted-model routing
