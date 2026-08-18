# ADR-002 — Jarvis Core is platform-level; Discord is a client

Date: 2026-08-18
Status: Proposed for acceptance

## Context

Digital Me began as a Discord-first voice companion.

The broader product goal is now a Jarvis-style local assistant shared across Discord, desktop, Android, CCTV, tools and automation.

A Discord-centric architecture would couple the central intelligence to one transport/client and make persona/voice behavior harder to reuse.

The user also requires independent selection of:

- reasoning brain
- speaking persona
- cloned voice

## Decision

Adopt:

- Jarvis Core as the platform-level intelligence layer
- Digital Me / Discord as one client/subsystem
- independent Persona and Voice presentation layers
- SocialBrain retained for Discord turn-taking
- shared memory/tool intelligence behind Jarvis interfaces
- legacy voice/persona coupling preserved temporarily through compatibility mapping

## Consequences

Positive:
- Jarvis can serve multiple clients
- one Qwen brain can power multiple presentations
- voice-only impersonation mode and persona-only mode become possible
- Discord-specific complexity stays outside Jarvis Core
- memory/tools can be shared without duplicating models

Negative:
- requires adapter/interface work
- existing voice-persona coupling must be migrated carefully
- more explicit state management is needed

## Non-decisions

This ADR does not yet approve:
- MEMORY-002 SQLite dual-write
- dashboard redesign
- automatic spoken research
- new live Discord command names
- autonomous external actions
