# Jarvis operations telemetry (JF-014.6)

`JarvisEventBus` records **real** operations only. No fake activity. No
chain-of-thought. Secrets are redacted before emit.

Lab:

- `GET /api/jarvis/events` — recent redacted events
- `GET /api/jarvis/events?stream=1` — SSE
- `/api/jarvis/status` includes a compact `operations` list

The visual Core may later map these events to states (SEARCH, BROWSER,
PERMISSION, ERROR). Until a real event exists, the UI must stay idle.
