# Jarvis operations telemetry (JF-014.6)

`JarvisEventBus` records **real** operations only. No fake activity. No
chain-of-thought. Secrets are redacted before emit. Events carry `id` and
monotonic `seq`. The in-memory buffer is bounded (default 200).

Lab:

- `GET /api/jarvis/events` — recent redacted events
- `GET /api/jarvis/events?stream=1` — SSE with `id:` fields
- Reconnect cursor: query `after=<seq>` or the `Last-Event-ID` header
- Heartbeat comments keep the stream alive without inventing work
- `/api/jarvis/status` includes a compact `operations` list
- `GET /api/jarvis/command-center` — work-agent / evolution snapshot
- Simulated demos emit `simulated: true` and a `SIMULATION` event

The visual Core maps events to operational states (SEARCH, PERMISSION,
ERROR, …). Until a real or explicitly simulated event exists, the UI
must stay idle. Do not call unit tests live-verified.
