# Jarvis / Discord Memory Sharing Policy

Status: Proposed
Purpose: Define which memories can be shared between Jarvis Core and Digital Me.

## 1. Memory domains

### Global Jarvis Memory

Examples:
- project knowledge
- owner-approved preferences
- device configuration
- important decisions
- general episodes

### Discord Memory

Examples:
- guild/session episodes
- conversation summaries
- participant relationships
- Discord-specific events

### Persona Memory

Examples:
- persona-specific slang
- behavior examples
- social phrasing
- relationship style

### Private/Restricted Memory

Examples:
- raw voice training artifacts
- consent records
- secrets
- sensitive private notes
- raw CCTV clips

These are not automatically retrievable by normal persona generation.

## 2. Retrieval rule

For a Discord response:

```text
Global relevant memory
+ Discord-relevant memory
+ Persona memory if personaMode permits
```

Do not load all memory categories indiscriminately.

## 3. Persona isolation

Gam persona must not inherit Elemisu behavior examples.

Voice profile selection must not change memory scope by itself.

Example:

```text
voice = gam
persona = jarvis
```

does **not** load Gam behavior memory.

## 4. Provenance

Every factual memory used by Jarvis should retain:

- canonical id
- source
- confidence
- evidence refs
- timestamps
- supersession state

Persona style output should not become a new fact merely because the LLM said it.

## 5. Write-back

After a Discord turn:

Possible writes:
- transcript observation
- episode
- repeated/stable fact
- relationship interaction

Do not automatically write:
- jokes as facts
- persona-generated wording
- hallucinated claims
- tool failures as successful results

## 6. Voice/persona learning

Voice training dataset and persona behavior learning are separate pipelines.

A user can consent to:
- voice clone
- behavior/persona learning
- both
- neither

Do not assume one implies the other unless current product policy explicitly defines it.

## 7. Future owner controls

Desired commands/UI:

- remember this
- forget this
- don't learn from this conversation
- use voice only
- use persona style
- disable social memory for this session
