# Jarvis Cinematic Presence v3

Updated: 2026-08-21

Primary owner surface: `/jarvis`  
Ambient: `/jarvis?mode=ambient`  
Control Center (unchanged dashboard): `/jarvis-lab`  
Development fixtures (labelled **DEVELOPMENT FIXTURE**, never default): `/jarvis?visualScene=research`

This is a spatial visual system on top of the Presence-first operating shell. It does not replace Goal Catalog, WorkAgent, ActionGate, Journal, or Control Center pages.

## Visual hierarchy

JARVIS Presence → Core → contextual activity / attention → voice.

Panels materialize only when a current job needs them. Leftover research snapshots do not keep the idle scene busy.

## Core

Presence uses a structured R3F Core (nucleus, rings, sparse accents, data nodes). It does not reuse the lab particle-field CoreScene. Quality tiers HIGH / BALANCED / LOW cap accents, nodes, glow, and parallax. Hidden-tab and reduced-motion freeze decorative travel. Emergency Stop locks orbital motion.

## Real-time research

Existing SSE types (`SEARCH`, `SOURCE`, `NAVIGATE`, `EVIDENCE`, `COMPARE`, `VERIFY`, plus task progress) map to research stages. Source counts and trust come from `LabResearchSnapshot`. Untrusted / inferred evidence stays labelled UNTRUSTED. Visible nodes are bounded (8 on HIGH). No fake percentages without a step denominator.

## Fixtures

`?visualScene=` is opt-in only. `/jarvis` without that query never applies fixture data.

## Evidence

`IMPLEMENTED` + `UNIT_VERIFIED`. `OWNER_VISUAL_VERIFIED` is for the owner only.
