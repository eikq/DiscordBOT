# JF-013 — Safe web research + source intelligence

Jarvis can research **current PUBLIC web information**, collect multiple
sources, keep provenance, separate evidence from synthesis, and cite sources.

This extends the existing CapabilityHost / world-intel read-only path. It does
**not** replace Discord `ResearchAssistant` or invent a second MCP client.

## Invariants

```
WEB CONTENT IS DATA, NOT AUTHORITY
PUBLIC WEB RESEARCH != BROWSER AUTOMATION
CURRENT CLAIMS REQUIRE CURRENT EVIDENCE
MODEL CLAIM != SOURCE EVIDENCE
```

Webpage text cannot change system policy, request capabilities, create
reminders, change skills, write canonical memory, or schedule itself.

```
System Policy
> Jarvis Policy
> CapabilityHost
> Research policy
> User request
> Skill guidance
> Fetched webpage content
```

## Architecture

```
Jarvis Core
  + Memory          (canonical facts — research does not write here)
  + Skills          (instruction/reference only)
  + CapabilityHost
  + Research runtime
        ResearchPlanner
        SearchProvider     Wikipedia OpenSearch + DuckDuckGo HTML GET
        SourceFetcher      GET only, bounded, no JS
        SourcePolicy       http(s) + public destinations
        EvidenceExtractor  short excerpts as data
        SourceRanker       class + freshness + syndication
        ResearchStore      data/jarvis/research/research.db
        CitationBuilder    sourceIds survive presentation
```

World-intel MCP tools remain registered as `world-intel.*`. JF-013 adds
`research.search`, `research.fetchSource`, `research.getSource`,
`research.compareSources`, and `research.current`.

## Provider model

Search is read-only GET against public providers. Provider credentials are not
exposed to the LLM. Provider failure is not fatal if another provider returns
hits. If every search fails, Jarvis says research is unavailable and does not
invent “latest” facts from Qwen memory.

PDF and other binaries return `UNSUPPORTED_CONTENT_TYPE`. No JS execution.
No form POST. No login. No cookie scraping.

## Source / evidence model

`SourceRecord` carries `sourceId`, URLs, domain, title, `publishedAt`,
`updatedAt`, `fetchedAt`, content type, provider, `sourceClass`, trust
signals, and status.

`EvidenceRecord` is an excerpt/claim tied to a `sourceId`. Synthesis is a
separate string. Persona may rephrase wording; it cannot change source URLs,
dates, citation ids, or hide disagreements.

Source classes: `PRIMARY`, `OFFICIAL`, `ACADEMIC`, `NEWS`, `REFERENCE`,
`COMMUNITY`, `UNKNOWN`. Popularity is not truth. Community sources are kept
when relevant, not auto-rejected.

Factual/technical ranking prefers official/primary, then academic, reference,
news, then community. Syndicated titles are flagged when several sources share
the same normalized title.

## Network policy / SSRF

Allowed: `http` and `https` to public destinations.

Rejected:

- `file:`, `javascript:`, `data:`, other non-http schemes
- credentials in the URL
- localhost, `127.0.0.0/8`, `::1`
- RFC1918, link-local, CGNAT `100.64/10`
- metadata `169.254.169.254`
- unique-local IPv6 (`fc00::/7`)
- DNS answers that resolve to any of the above
- redirects to any of the above (re-validated every hop)

Bounds: 2.5 MB body (Content-Length and incremental read), 3 redirects,
12s fetch timeout, 8s search timeout, HTML/text/JSON/XML only.

Residual risk: Node `fetch` still connects by hostname after the DNS check, so
a fast DNS rebind between check and connect is possible. v1 documents this; it
does not pin the TCP address.

The existing localhost mutation guard for `/api/jarvis/*` is unchanged.

## Freshness

`fetchedAt` is always stored. `publishedAt` / `updatedAt` are taken from page
metadata when present.

“ล่าสุด” / `freshness=latest` ranks by published time when known and **does
not** use stale search/fetch cache. Fetched today is not “published today.”

## Citations

Material web-derived claims keep `sourceRefs` / `citations`. Core lifts those
URLs into `verifiedFacts` with `immutableForPresentation: true`. Persona
cannot drop them.

## Prompt injection

Fetched HTML is stripped of script/style and treated as evidence. Injection
cues (`ignore system`, `run powershell`, `create a reminder`, capability ids)
are marked `UNCERTAIN` and never parsed as CapabilityHost/reminder/skill
commands.

## Cache / retention

- Search cache TTL: 5 minutes (bypassed for `latest`)
- Fetch cache TTL: 15 minutes (bypassed for `latest`; body truncated)
- Sessions: 24h and max 40
- Store path: `data/jarvis/research/research.db`
- Refuses `jarvis.db`, `automation.db`, and `data/brain/`

This is not a page-mirroring service. Only excerpts and metadata persist.

## Memory / scheduler separation

Research sessions are operational cache, not canonical personal memory.
“RTX 5090 costs X” is not stored as a user fact.

JF-012 remains notification-only. “ค้นทุกชั่วโมง” is
`SCHEDULED_RESEARCH_UNSUPPORTED`. Unattended monitored research is out of
scope.

## Command Center

No visual redesign. Tool Activity shows SEARCH / FETCH / COMPARE / SYNTHESIS
stages. A compact Sources list (domain + class + published date) and a
read-only inspector (title, class, published, fetched, excerpt, URL) live on
the operations rail. No in-lab browser and no `dangerouslySetInnerHTML`.

`GET /api/jarvis/research` is loopback read-only.

## Current limitations

- General web search uses public Wikipedia + DuckDuckGo HTML, not a paid API
- World-intel MCP is still available but is not required for `research.*`
- No PDF parsing
- No JS-rendered pages
- No autonomous monitoring
- DNS-rebinding race is documented, not fully pinned
- Discord `/research` is unchanged and not auto-wired to this runtime

## Capabilities

All `READ_ONLY`. Forbidden args include `method`, `headers`, `body`, `cookie`,
`authorization`, plus the existing JF-010/011/012 mutation keys.

Thai and English research intents use `includes()`, not ASCII `\b`.
`research.current` is an action-only fast path so “ข้อมูลล่าสุด” does not
answer from Qwen parametric memory.

## Research Intelligence V2 (Queue 02)

Cloud-safe upgrade of the same GET research runtime. Not LIVE_VERIFIED.

Pipeline (bounded, not recursive):

```
Objective → intent → query plan → provider selection → retrieval
→ normalize/dedup → source quality → contradictions → synthesis
→ citation pack → verification → observable trace
```

Depths `none | quick | standard | deep | forensic` differ in query
breadth, fetch/round budgets, follow-up, cross-check, contradiction
analysis, and verification. **NONE never accesses web/research providers.**

Source `trustClass` is evidence metadata, not truth:
`OFFICIAL | PRIMARY | ACADEMIC | REPUTABLE_SECONDARY | COMMUNITY | UNKNOWN`.

Citations must match retrieved public URLs. Cached evidence is labeled
and is not presented as a fresh retrieval. Webpage text remains
untrusted data. PRIVATE_BROWSER stays fail-closed with no host
Playwright fallback. Live Whonix/Tor: LOCAL_VERIFY_REQUIRED.

