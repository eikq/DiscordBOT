# Jarvis Presence Interface

Updated: 2026-08-21

Primary owner surface: `/jarvis`  
Advanced Control Center: `/jarvis-lab` (all previous Tasks, Security, System, Activity, Evolution pages kept)

This is a product-architecture split, not a CSS restyle of the dashboard.

## Interaction model

The owner talks or types to Jarvis. Jarvis selects the goal, capability, and HUD.

Presence does **not** start as a card grid. Default state is the Core, operational phase, conversation, and only the HUD required by the current job.

Ambient mode: `/jarvis?mode=ambient` or say "ambient mode". Keyboard: `Ctrl+.`. Control Center: say "Open Control Center" or `Ctrl+Shift+L`.

## Safety

Autonomous UX is not unrestricted authority. ActionGate, Risk Brief, Privilege Lease, Journal, Verification, Rollback, and Emergency Stop remain in force.

Spoken **Yes** / **Allow Once** binds one exact pending confirm token or one WorkAgent grant. It is not a global approval. Ambiguous dual waiters refuse instead of guessing.

## Desktop operator

SEE, OPEN, CLICK, TYPE, and SUBMIT remain separate classes.

OPEN is REAL for allowlisted apps/URLs/projects (including Cursor and YouTube via existing URL policy). SEE/CLICK/TYPE/SUBMIT stay `PREPARE_CONTRACT`. CCTV stays `PREPARE_CONTRACT`. Do not mark simulated device functionality REAL.

## Evidence

`IMPLEMENTED` + `UNIT_VERIFIED`. `OWNER_VISUAL_VERIFIED` is for the owner only.
