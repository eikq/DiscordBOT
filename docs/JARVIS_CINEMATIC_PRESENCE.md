# Jarvis Cinematic Presence v5

Updated: 2026-08-21

Primary owner surface: `/jarvis`  
Ambient: `/jarvis?mode=ambient`  
Control Center (unchanged dashboard): `/jarvis-lab`  
Development fixtures: `/jarvis?visualScene=research`  
Development replay: `/jarvis?visualReplay=1&replaySpeed=1`  
Inspect drag (dev only): `/jarvis?visualDebug=1&inspect=1`

This is a spatial visual system on top of the Presence-first operating shell. It does not replace Goal Catalog, WorkAgent, ActionGate, Journal, or Control Center pages.

## Visual hierarchy

JARVIS Presence → energetic 3D Core → live job geometry → a small amount of readable information → voice.

The Core is a true WebGL machine (Three.js / R3F). HTML is for crisp captions and approval copy only.

## Core

Presence uses a structured R3F Core: energy nucleus (custom shaders on HIGH/BALANCED), gyroscopic rings on independent axes, mechanical ticks, structured particle classes, neural cognition, lightning arcs, research constellation, and thresholded UnrealBloom. It does not reuse the lab particle-field CoreScene. Thinking pulls the camera in; Researching widens it. Palette is cyan / electric blue / indigo / violet. Red remains Emergency Stop only.

Quality tiers HIGH / BALANCED / LOW change bloom, shaders, gyro count, and particle budgets. Hidden-tab sets `frameloop="never"`. Reduced-motion freezes decorative travel. Emergency Stop zeros gyro/orbit speeds and closes red containment rings.

Pointer parallax and node hover/select are presentation only. They cannot grant or deny authority.

## Real-time research

Existing SSE types (`SEARCH`, `SOURCE`, `NAVIGATE`, `EVIDENCE`, `COMPARE`, `VERIFY`, plus task progress) map to research stages. Source counts, evidence counts, and trust come from `LabResearchSnapshot`. Untrusted / inferred evidence stays labelled UNTRUSTED. Visible nodes are bounded (8 on HIGH). Streams activate only when evidence exists. No fake percentages without a step denominator.

`?visualReplay=1` plays a sanitized structured sequence labelled **DEVELOPMENT REPLAY**. It cannot create capabilities or appear on `/jarvis` without that query.

## Fixtures

`?visualScene=` is opt-in only. `/jarvis` without that query never applies fixture data.

## Voice input

Voice → STT → family/slot resolver → Goal Catalog / typed adapters → CapabilityHost / ActionGate → verification → spoken response.

Wake enters LISTENING and does not create a task. Generic “yes” binds exactly one pending owner decision. Low-confidence STT does not execute mutating or delete-like interpretations. OPEN YouTube is not media control. CCTV and CLICK/TYPE/SUBMIT stay honest PREPARE_CONTRACT / unavailable.

## Evidence

`IMPLEMENTED` + `UNIT_VERIFIED`. `OWNER_VISUAL_VERIFIED` is for the owner only. `LIVE_VERIFIED` is not claimed.
