# Project Agent Skills Trust Ledger

Updated: 2026-08-19

Project skills are copied under `.agents/skills/` for inspection. Installation does not approve script execution.

> `DISCOVER != INSTALL != TRUST != EXECUTE`

## Active project skills

| Skill | Source | Trust | Intended use | Bundled scripts |
|---|---|---|---|---|
| `find-skills` | `vercel-labs/skills` | TRUSTED | Curated discovery only | none |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | TRUSTED | React performance/re-render/bundle review | none |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | TRUSTED | React component API/composition review | none |
| `web-design-guidelines` | `vercel-labs/agent-skills` | TRUSTED | UI/accessibility review | none |
| `frontend-design` | `anthropics/skills` | TRUSTED | Intentional visual direction | none |
| `webapp-testing` | `anthropics/skills` | TRUSTED | Browser test guidance | **BLOCKED**: Python server/subprocess helper and examples are not approved |
| `mcp-builder` | `anthropics/skills` | TRUSTED | MCP interface design reference | **BLOCKED**: Python connection/evaluation scripts can spawn/connect externally |
| `skill-creator` | `anthropics/skills` | TRUSTED | Author concise project skills | **BLOCKED**: eval/optimization/report scripts spawn processes and may open a browser |
| `context-engineering` | `addyosmani/agent-skills` | TRUSTED | Keep agent context bounded and relevant | none |
| `source-driven-development` | `addyosmani/agent-skills` | TRUSTED | Verify version-specific implementation patterns | none |
| `frontend-ui-engineering` | `addyosmani/agent-skills` | TRUSTED | Accessible responsive UI engineering | none |
| `browser-testing-with-devtools` | `addyosmani/agent-skills` | TRUSTED | Localhost runtime/browser QA | none |
| `debugging-and-error-recovery` | `addyosmani/agent-skills` | TRUSTED | Evidence-first debugging | none |
| `code-review-and-quality` | `addyosmani/agent-skills` | TRUSTED | Final multi-axis code review | none |
| `performance-optimization` | `addyosmani/agent-skills` | TRUSTED | Measure/profile/verify optimization | none |
| `security-and-hardening` | `addyosmani/agent-skills` | TRUSTED | Threat model and hardening review | none |
| `documentation-and-adrs` | `addyosmani/agent-skills` | TRUSTED | Record verified architecture decisions | none |
| `observability-and-instrumentation` | `addyosmani/agent-skills` | TRUSTED | Honest diagnostics/telemetry design | none |
| `test-driven-development` | `addyosmani/agent-skills` | TRUSTED | Focused regression-first implementation | none |
| `threejs-impl-react-three-fiber` | `OpenAEC-Foundation/Three.js-Claude-Skill-Package` | REVIEWED_COMMUNITY | R3F lifecycle/render-loop architecture | none; MIT frontmatter; SKILL + references inspected |
| `threejs-errors-performance` | `OpenAEC-Foundation/Three.js-Claude-Skill-Package` | REVIEWED_COMMUNITY | Three.js draw-call/disposal/performance review | none; MIT frontmatter; SKILL + references inspected |
| `jarvis-first-invariants` | project | TRUSTED | Jarvis-first architecture/safety invariants | none |
| `jarvis-lab-visual-qa` | project | TRUSTED | `/jarvis-lab` visual hierarchy and QA | none |
| `jarvis-night-agent-safety` | project | TRUSTED | Night Agent isolation and CLI safety | none |

## Community candidates not activated

| Source/candidate | Trust | Decision |
|---|---|---|
| `EnzeD/r3f-skills` | UNTRUSTED | Useful R3F catalog and sampled `r3f-loaders`/`r3f-shaders` instructions, but repository license/full script tree could not be verified with GitHub CLI unavailable; overlaps accepted OpenAEC skills. |
| `CloudAI-X/threejs-skills` | UNTRUSTED | Sampled shader guidance was generic and substantially duplicated accepted skills; repository license/full script tree not verified. |
| Other `skills find` Three.js/WebGL/GLTF results | UNTRUSTED | Discovery only; rejected to avoid an overlapping, low-signal skill set. |

## Script policy

- No bundled downloaded script is approved merely because its skill is active.
- No downloaded skill script was executed during installation/audit.
- Runtime Jarvis skills use a separate explicit allowlist and default `scriptsAllowed=false`.
- Any future script approval must be task-specific, source-reviewed, least-privilege, and consistent with project rules.

## Verification

```powershell
npx.cmd skills list --json
npx.cmd skills ls -a cursor --json
```

OpenAEC/Impertio-Studio `Three.js-Claude-Skill-Package` LICENSE confirmed MIT on default branch `master` (raw LICENSE 404 on `main` was a branch-name miss, not a missing license). EnzeD/r3f-skills GitHub page also states MIT; it remains **not installed** because it overlaps the accepted OpenAEC R3F/performance pair and the full script tree was not task-reviewed.
