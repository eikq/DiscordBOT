# JARVIS Memory Architecture

Status: Proposed design addendum. TypeScript interfaces and SQL live in `src/bot/memory/jarvis/`. No live data migration has been executed.

Purpose: Evolve the existing `SocialMemoryBrain` into a general Jarvis memory system without replacing the working social-memory implementation.

## Core decision

Do **not** use Obsidian as the primary runtime database.

Use a hybrid model:

- **SQLite** = canonical structured memory and relationships
- **JSONL** = append-only observation/audit stream
- **Qdrant** = semantic/vector retrieval index
- **Obsidian Vault** = human-readable/editable projection of selected memories
- **Local files** = images, audio, CCTV clips, documents
- **LLM context** = temporary working memory only

Obsidian is the "window into memory", not the memory engine.

## Why this fits the current project

The project already has:

- `SocialMemoryBrain`
- `brain_state.json`
- `observations.jsonl`
- Obsidian-compatible vault export
- persona-scoped behavior examples
- optional embedding service

Preserve these ideas and migrate incrementally.

## Memory model

### 1. Working Memory

Short-lived information used for the current turn/task.

Examples:
- current conversation
- current Discord speakers
- current tool outputs
- current CCTV alert being analyzed
- current coding task

Storage:
- in-process state
- LLM context
- optional short session cache

Lifetime:
seconds to hours.

Do not treat this as long-term truth.

### 2. Episodic Memory

"What happened?"

Examples:
- a conversation on 2026-08-18
- user started a voice-training session
- an unusual CCTV event
- Jarvis called a tool and received a result
- a coding agent fixed a reconnect bug

Recommended SQLite fields:

- id
- occurred_at
- source
- actor ids
- event type
- summary
- structured JSON payload
- confidence
- importance
- privacy class
- expires_at
- superseded_by
- artifact refs

Raw append-only evidence should also be represented in an audit JSONL stream where appropriate.

### 3. Semantic Memory

"What is believed to be true?"

Examples:
- a friend's nickname
- a project preference
- a device name
- a stable relationship
- a known project fact

Keep provenance.

A semantic fact should include:
- subject
- predicate
- object/value
- confidence
- evidence ids
- first_seen
- last_confirmed
- superseded_by
- sensitivity
- expiry policy

Contradictions should supersede rather than silently erase history.

### 4. Procedural Memory

"How do I do something?"

Examples:
- how to run the Digital Me project
- how to research safely
- how to join Discord
- how to handle a CUDA error
- tool instructions
- agent lessons

Storage:
Markdown/skills/rules in the repo or a dedicated local skills directory.

This is closer to `AGENTS.md`, MCP skills, and future `.agent/lessons/` than to vector memory.

### 5. Social / Relationship Memory

Preserve the existing SocialMemoryBrain concepts.

Examples:
- display names and aliases
- relationship interaction counts
- speaking habits
- games/activities
- how users address each other

Do not merge identity/persona state into generic semantic memories without clear keys.

### 6. Self / Identity Memory

This is the engineering analogue of a fictional "Fluctlight core".

It contains relatively stable Jarvis identity/configuration:

- assistant identity
- owner profile references
- safety boundaries
- voice/persona bindings
- response style preferences
- trusted devices
- permissions

Keep this small and explicit.

Do not let arbitrary retrieved memories rewrite core identity.

### 7. Affective / State Memory

Emotion/state is transient.

Examples:
- listening
- thinking
- speaking
- alert
- focused
- uncertain

Store a current state vector separately from long-term facts.

Only persist long-term emotional/preferences information when repeated evidence justifies it.

### 8. Perceptual Memory

Future CCTV/screen/audio observations.

Store structured events and artifact references, not every raw frame as an LLM memory.

Example:
- event id
- camera id
- zone
- object counts
- dwell time
- anomaly score
- snapshot/clip path
- detector version
- confidence

## Canonical storage

Recommended SQLite databases:

`data/jarvis/jarvis.db`

Suggested logical tables:

- `entities`
- `aliases`
- `relationships`
- `facts`
- `episodes`
- `observations`
- `sessions`
- `artifacts`
- `permissions`
- `memory_links`
- `memory_feedback`
- `consolidation_runs`

Use foreign keys and explicit provenance.

Use JSON columns only for flexible payloads, not as a replacement for all schema.

## Semantic index

Qdrant is an index, not the source of truth.

Each vector point should reference a canonical SQLite record:

```json
{
  "id": "episode:1234",
  "payload": {
    "memory_type": "episode",
    "canonical_id": "1234",
    "person_ids": ["..."],
    "source": "discord",
    "occurred_at": "...",
    "privacy": "private",
    "importance": 0.74
  }
}
```

Store embeddings for:
- episode summaries
- semantic facts
- documents
- future visual/event summaries

Potentially keep separate named collections or named vectors when models/modalities differ.

## Obsidian role

Continue exporting a selected vault, but do not make runtime correctness depend on Obsidian.

Suggested Vault:

```text
Jarvis Vault/
  People/
  Projects/
  Episodes/
  Knowledge/
  Devices/
  Decisions/
  CCTV Events/
  Daily/
```

A note may contain frontmatter/properties:

```yaml
memory_id: episode:1234
type: episode
occurred_at: 2026-08-18T10:20:00+07:00
importance: 0.82
confidence: 0.91
source: discord
privacy: private
```

Obsidian is excellent for:
- human inspection
- manual corrections
- backlinks
- graph exploration
- daily summaries
- Canvas-style conceptual maps

Edits from Obsidian should not automatically overwrite canonical memory until a safe sync/import design exists.

## Memory write pipeline

```text
Observation
 -> normalize
 -> privacy/consent check
 -> classify memory type
 -> novelty check
 -> confidence score
 -> importance score
 -> deduplicate
 -> write canonical record
 -> append audit/provenance
 -> embed eligible summary
 -> upsert vector index
 -> optional Obsidian projection
```

## Retrieval pipeline

Use hybrid retrieval rather than vector-only search.

```text
User/task
 -> identify intent/entities/time window
 -> structured SQL filters
 -> SQLite FTS lexical search
 -> Qdrant semantic search
 -> merge candidates
 -> rerank
 -> fetch canonical records
 -> build compact context
 -> LLM
```

Candidate ranking can consider:
- semantic similarity
- lexical match
- entity match
- recency
- importance
- confidence
- relationship relevance

Exact weights must be evaluated, not hard-coded as universal truth.

## Consolidation

Run periodically, not every turn.

Example:
- merge repeated observations
- promote repeated episodes into stable facts
- summarize a day's related episodes
- detect contradictions
- mark superseded facts
- reduce importance for stale low-value memories
- preserve evidence/audit

Never silently rewrite history.

## Forgetting / retention

Jarvis should be able to forget.

Each memory can have:
- retention class
- expires_at
- sensitivity
- deletion policy

Examples:
- temporary tool result: short TTL
- user preference: long-lived
- private raw artifact: policy-controlled
- CCTV clip: retention policy
- audit metadata: separate policy

"Forgotten" semantic memory may be deleted or made unavailable for retrieval according to policy; do not rely on embedding deletion alone.

## Memory feedback

Allow the owner to say:
- "จำอันนี้"
- "อันนี้ไม่จริง"
- "อย่าจำเรื่องนี้"
- "ลืมเรื่องนี้"
- "สำคัญมาก"
- "คนนี้คือ..."

Feedback should update canonical memory and provenance.

## Migration strategy

Do not replace SocialMemoryBrain in one large rewrite.

Phase 1:
- define interfaces and schema
- write adapters around existing brain
- preserve current JSON and vault behavior

Phase 2:
- introduce SQLite canonical store
- dual-write verified memory records
- add migrations/tests

Phase 3:
- enable Qdrant semantic indexing
- keep canonical IDs

Phase 4:
- move retrieval paths gradually
- compare old/new retrieval results

Phase 5:
- optional Obsidian correction/sync workflow

## Definition of success

Jarvis can answer:
- "เมื่อวานเราทำอะไรกับโปรเจกต์นี้?"
- "คนนี้เคยคุยกับเรายังไง?"
- "ทำไมฉันถึงเลือก architecture นี้?"
- "เหตุการณ์หน้าบ้านคล้ายกับวันไหนบ้าง?"
- "มีหลักฐานอะไรที่ทำให้ Jarvis เชื่อ fact นี้?"

And every important answer can point back to inspectable provenance.
