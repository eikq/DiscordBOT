# JF-013.5 — Natural intent resolution + conversational recovery

Jarvis maps **natural language** onto **registered, currently exposed
capabilities**. The owner does not need exact command phrases.

Security stays deterministic. The model may guess *what the user wants*.
It must not decide *whether that is allowed*.

## Root cause of over-refusal

Before this phase:

1. Deterministic fast paths only matched narrow cues (`หาข่าว`, `เปิด Notepad`).
2. Natural Thai/English that missed those cues fell through to ordinary Qwen.
3. `LocalLlmJarvisCore` told the model not to invent tools, and that no tools
   were called.
4. Qwen correctly refused to pretend it had access, which sounded like
   “ไม่มีสิทธิ์ / I cannot access…”.
5. `ช่วยเปิด Chrome ให้หน่อย` could match Chrome but leftover noise (`ช่วย`,
   `ให้หน่อย`) kept `consumed=false`, so Core still woke Qwen.
6. Any mention of PowerShell was treated as `BLOCKED_SHELL`, including
   “PowerShell คืออะไร”.

## Invariants

```
USER LANGUAGE != COMMAND SYNTAX
UNDERSTANDING INTENT != GRANTING PERMISSION
AMBIGUOUS != FORBIDDEN
UNAVAILABLE != FORBIDDEN
TALKING ABOUT AN ACTION != REQUESTING THE ACTION
```

Authority order:

```
Natural language
  → candidate capability (fast path or semantic resolver)
  → schema validation
  → PermissionPolicy
  → ActionGate
  → capability execution
```

The resolver never bypasses CapabilityHost, ActionGate, allowlists,
confirmation, network policy, scheduler, skills, or shell restrictions.

## Pipeline

```
User request
  ├─ deterministic fast path (reminders, research, desktop, runtime)
  ├─ short-lived interaction context (follow-up / clarification answer)
  ├─ heuristic CapabilityResolver (Thai/English paraphrases, no 27B)
  ├─ optional bounded semantic LLM (catalog JSON only)
  └─ conversation (normal Qwen)
```

Clear exact commands stay on the millisecond fast path. No unnecessary 27B
call. If no fast path matches, Jarvis does **not** assume ordinary chat.

## Compact catalog

The resolver sees only registered ids plus:

- `id`
- `shortDescription`
- `argumentSchemaSummary`
- `sideEffectClass`
- `availability`

It does not receive executable paths, shell commands, secrets, policy code,
or giant schemas. Unknown `capabilityId` is rejected.

Current catalog is built from the live gated registry (JF-010 through
JF-013), not a stale hardcoded product list.

## Structured result

```
kind: CAPABILITY | CLARIFICATION | CONVERSATION | UNSUPPORTED | FORBIDDEN
capabilityId?, arguments?, confidence, alternatives?, reasonCode
```

Unknown fields, unknown ids, and forbidden argument keys (`command`, `path`,
`pid`, `executable`, `allow`, `confirmed`, `method`, `headers`, …) fail
closed. Invalid args still cannot execute.

## Confidence

- HIGH + READ_ONLY → normal policy
- HIGH + mutating → PermissionPolicy / confirmation as today
- MEDIUM + mutating → ask if the target/action is unclear
- LOW → conversation or clarification
- FORBIDDEN → deterministic deny, no polite “maybe”

## Four failure classes

| Class | Behavior |
|---|---|
| AMBIGUOUS | Ask one short question. Do not say “I cannot do that.” |
| UNSUPPORTED | Explain the limitation. Offer another **existing** safe capability if one fits. |
| UNAVAILABLE | Name the missing target (for example Spotify not installed). Offer a safe alternative. Do not auto-execute it. |
| FORBIDDEN | Deny clearly. Do not ask unnecessary clarification. |

Do not collapse these into “ไม่มีสิทธิ์”.

## Clarification and interaction context

Clarifications are structured and expire (10 minutes). The next turn may
resolve only that pending clarification. Old state is not treated as
confirmation.

Interaction context is **not** canonical personal memory. It holds:

- last capability / service / application
- recent research query/session
- recent reminder ids
- pending clarification / proposal
- TTL timestamps

Used for follow-ups such as “เอาเฉพาะ NVIDIA”, “รีสตาร์ตมัน”, “ยกเลิกอันแรก”.

## Alternatives

An alternative is another **registered** capability, not a bypass.

Examples:

- Spotify app missing → offer Spotify Web URL (still JF-010 URL policy)
- “เปิด YouTube” → `desktop.openTrustedUrl` `https://www.youtube.com`
- “ปรับระดับเสียง” → explain unsupported; offer `desktop.openSettings` sound
- “เช็คราคา RTX 5090” → `research.current`
- “เปิดไฟล์ Jarvis” → clarification: workspace search vs `desktop.openProject`

## Conversational prompt

The Core prompt still forbids invented tool results. It now also says:

- never claim success unless an ActionResult is `completed`
- prefer a Jarvis capability over “I cannot access…”
- ask when details are missing
- name an unavailable target
- only call a request impossible when no permitted capability can satisfy it
- talking about a blocked tool is conversation

## Thai and English

Fast paths do not rely on JavaScript ASCII `\b` for Thai. They cover obvious
verbs (`เปิด`, `เข้า`, `เช็ก`, `เป็นไง`, `เตือน`, …). The heuristic/semantic
layer covers natural variants. Exact regex dictionaries are intentionally
small.

Talking about PowerShell/cmd is conversation. Requesting to run them remains
`BLOCKED_SHELL`.

## Skills

JF-SKILLS-001 may later help interpretation. Skills cannot invent
capabilities, change confidence policy, bypass PermissionPolicy, or execute
scripts. `scriptsAllowed` remains false. The resolver catalog is not skill
text.

## UI

No Command Center redesign. Tool activity may show a compact stage:

`UNDERSTANDING` / `CLARIFICATION` / `PERMISSION` / `ACTION`

No chain-of-thought. No raw classification JSON.

## Out of scope

JF-014 local workspace intelligence is implemented separately
(`docs/JF014_SAFE_LOCAL_WORKSPACE.md`). This resolver only maps phrasing;
it does not grant filesystem authority.
