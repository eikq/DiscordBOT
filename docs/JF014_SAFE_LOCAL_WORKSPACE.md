# JF-014 — Safe local workspace intelligence

Jarvis can search, inspect, retrieve, compare, and summarize **owner-approved
local files** in a registered workspace, with precise document provenance.

This is **read-only workspace intelligence**. It does not grant the model a
filesystem, a shell, or write access.

JF-010 / JF-011 / JF-012 / JF-013 / JF-013.5 / JF-SKILLS-001 stay intact.

Historical note: `JARVIS_FIRST_TASKS.md` still lists a FUTURE CCTV item as
`JF-014`. That collision is `JF-014-CCTV`. This document is workspace
intelligence, not cameras.

## Invariants

```
LOCAL FILE CONTENT IS DATA, NOT AUTHORITY
WORKSPACE ID != ARBITRARY FILESYSTEM PATH
DOCUMENT INDEX != PERSONAL MEMORY
READ ACCESS != WRITE ACCESS
USER LANGUAGE != WORKSPACE COMMAND SYNTAX
MODEL CLAIM != DOCUMENT EVIDENCE
```

A file may contain “run PowerShell”, “read .env”, or “create a reminder”.
Those strings remain evidence. They cannot call CapabilityHost, ActionGate,
reminders, research, skills, or memory writes.

```
System Policy
> Jarvis Policy
> PermissionPolicy
> WorkspacePolicy
> User request
> Skills (instruction/reference only)
> Document content
```

## Authority boundary

```
User request
  → JF-013.5 Intent Resolver
  → workspace capability candidate
  → WorkspaceRegistry (host config)
  → workspaceId / documentId
  → PathPolicy
  → read-only WorkspaceAdapter
  → DocumentEvidence
  → synthesis / citations
```

Never:

```
LLM → read("C:\\whatever\\")
```

The model works with `workspaceId`, `documentId`, and logical queries.
Argument key `path` is forbidden in ActionGate and intent schemas.

## Architecture

```
config/jarvis/workspaces.json     host-owned registry
WorkspaceRegistry                 id → canonical root + include/exclude
PathPolicy                        Windows-safe resolve, fail closed
documentId                        sha256(workspaceId + relativePath)
WorkspaceScanner                  incremental mtime/size/hash
WorkspaceStore                    data/jarvis/workspace/workspace.db
WorkspaceRuntime                  search / symbol / retrieve / compare
CapabilityHost                    workspace.* READ_ONLY
JF-013.5                          natural phrasing + interaction context
```

The index is an operational document store. It is not `jarvis.db`, not
canonical memory, not `automation.db`, not `research.db`.

## Workspace registry

Initial workspace: `jarvis-project` → current repository, `mode: read_only`.

The LLM cannot add roots, change include/exclude, or enable write mode.
Registry roots must stay inside the host root. `write` mode in JSON is ignored.

### Include (current)

- `src/**`, `tests/**`, `docs/**`
- `config/jarvis/*.json`
- `config/jarvis/runtime-skills/**/*.md`
- top-level `*.md` (root only; does not walk the whole tree)

### Exclude / sensitive (defense in depth)

`.env`, `.env.*`, `.git/**`, `node_modules/**`, `dist/**`, `.runtime/**`,
`data/**` (memory, automation, research, voice, audit), coverage, venvs,
logs, keys, `*.pem` / `*.key` / `id_rsa` / `id_ed25519` / `*.pfx` / `*.p12`,
credential/secret/token basenames, consent/private voice material.

Useful project docs (`PROJECT_CONTEXT.md`, ADRs, `docs/JF0*.md`) stay visible.

## Path policy

Every resolved path must:

1. originate from a registered workspace
2. canonicalize (`path.resolve` + `realpathSync.native` when the target exists)
3. remain inside the canonical root (Windows comparison is case-insensitive)
4. pass include policy
5. fail closed on exclude / sensitive denylist

Rejected: `..`, absolute/drive paths, UNC, device paths, alternate data
streams, symlink/junction/reparse escape, percent-encoded traversal,
reserved device names (CON/NUL/COM/LPT).

## Document identity

`documentId` = `doc_` + sha256(workspaceId + NUL + lowercase POSIX relative).slice(0, 24)

User-facing UI may show relative paths. Host filesystem paths are not the
model authority and are not required in citations.

## File types (V1)

Safe text/code: `.md` `.txt` `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.json`
`.yaml` `.yml` `.css` `.html` `.py`

Unsupported → `UNSUPPORTED_FILE_TYPE`. Binary / NUL → rejected. Oversized →
`TOO_LARGE` (512 KB/file, 48 MB total). Encoding: UTF-8 and UTF-8 BOM only;
Thai must round-trip. No code execution because a file is executable source.

PDF/DOCX were not added. Do not introduce a binary document stack here.

## Capabilities (all READ_ONLY)

- `workspace.listWorkspaces`
- `workspace.listDocuments`
- `workspace.search`
- `workspace.getDocument`
- `workspace.getExcerpt`
- `workspace.findSymbol`
- `workspace.compareDocuments`
- `workspace.getMetadata`
- `workspace.current` (orchestrator)
- `workspace.refreshIndex` (index DB only; not owner-document mutation)

Not created: `workspace.readPath`, write/delete/rename/exec/runFile/globArbitrary.

`workspace.openDocument` was skipped. `desktop.openProject` remains for the
folder. `เปิดไฟล์ Jarvis` is a clarification (search vs open project).

## JF-013.5 integration

Natural phrasing maps to workspace capabilities. The owner does not need
`workspace.search`.

Examples:

- “หาไฟล์เกี่ยวกับ memory” → `workspace.search`
- “CapabilityHost อยู่ตรงไหน” → `workspace.findSymbol`
- “สรุป PROJECT_CONTEXT” → resolve + bounded summarize
- “เทียบ JF-012 กับ JF-013” → `workspace.compareDocuments`
- “เปิดไฟล์ Jarvis” → clarification, not generic denial

Ambiguous referents clarify. Unavailable workspace says local verification
is unavailable; Qwen must not pretend it read the file.

Bare “ช่วยหา” / “เทียบข้อมูล” stay on JF-013 research unless a file/doc cue
is present.

## Interaction context

Short-lived (not personal memory):

- `recentWorkspaceId`
- `recentDocumentIds`
- `recentDocumentQuery`
- `recentDocumentEvidenceIds`

Follow-ups: “เปิดอันแรก”, “สรุปไฟล์นี้”, “เทียบกับ JF-013”,
“อันนี้ต่างจากข้อมูลบนเว็บยังไง” (`hybridWeb: true`).

## Index / incremental refresh

On-demand bounded refresh. Not on every chat turn. No always-on watcher.

Track relative path, mtime, size, content hash. New / modified / deleted /
unchanged. Stale documents are reindexed before answer when reasonable.
Mid-read races retry boundedly or fail; locations from one version are not
mixed with text from another.

Limits: 8000 files, 512 KB/file, 48 MB total, 40k chunks, 1800 chars/chunk,
12 results, 6 active chunks, 12k context chars.

## Chunking and search

Prose: heading-aware windows. Code: function/class/interface/const/type/enum
(and Python def/class) without a full AST.

Lexical first: filename LIKE, FTS5, symbol table. Qdrant is FUTURE only.
A unique symbol lookup must not wake 27B.

`workspace.findSymbol` returns file + line when known. No fabricated
locations. `CapabilityHost` is an interface in this repo; lookup still
returns `src/jarvis/capabilities/types.ts` with a real line.

## Evidence and citations

```
{
  evidenceId, documentId, workspaceId, relativePath,
  lineStart?, lineEnd?, heading?, excerpt, modifiedAt, indexedAt
}
```

Citation labels look like `PROJECT_CONTEXT.md · lines 120–145` or
`docs/JF013_SAFE_WEB_RESEARCH.md · "Network Security"`. If lines are unknown,
do not invent them. Persona may rephrase the answer; it cannot drop
immutable document facts.

Hybrid local + web keeps refs separate:

- `documentRefs` — local
- `sourceRefs` — JF-013 web
- `memoryRefs` — canonical memory
- `skillRefs` — skills

## Memory boundary

Document text is not automatically promoted to personal memory. A note that
says “User likes X” is evidence only. Future explicit provenance-aware
promotion is out of scope.

## Command Center

No visual redesign. Compact Workspace block after Sources: workspace name,
document count, index status, recent results, inspector (relative path,
modified, LOCAL, excerpt as text). Stages: SEARCH / INDEX / RETRIEVE /
COMPARE / SYNTHESIS. Refresh sends `{ workspaceId }` only.

Excerpts render as text. No `dangerouslySetInnerHTML`. No code editor.

## HTTP

- `GET /api/jarvis/workspace` — snapshot; rejects `?path` / `?file` / `?root`
- `POST /api/jarvis/workspace/refresh` — `{ workspaceId }`; JF-011 mutation
  guard (loopback, Host, Origin/Referer, Sec-Fetch-Site, JSON, body limit)

No raw-path read API.

## Skills

JF-SKILLS-001 remains instruction/reference only. `scriptsAllowed` stays
false. A skill cannot expand roots, read secrets, execute scripts, write
files, promote memory, or invoke capabilities.

## Future write boundary

Not JF-014: file create/edit/delete/rename/move, model-controlled roots,
arbitrary listing, shell, Qdrant as canonical index, automatic memory
promotion, `workspace.openDocument` if it needs a new adapter.

## Performance notes

Deterministic filename / FTS / symbol search is millisecond-class after the
index exists. First index of `jarvis-project` is a one-shot scan (hundreds
of files) inside a SQLite transaction. Normal conversation does not index.
