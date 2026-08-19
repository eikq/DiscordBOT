# Proposed Future Jarvis Architecture

This is a design direction, not current implementation.

## Core principle

Digital Me should become a client/capability of Jarvis rather than being replaced.

```text
                         JARVIS CORE
                             |
            +----------------+----------------+
            |                |                |
        Event Bus        Permission       State/Memory
            |                |                |
    +-------+------+         |         +------+------+
    |              |         |         |             |
Perception       Tools     Actions   Structured    Vector
    |              |                   memory       search
    |              |
Discord Voice    MCP / APIs
CCTV
Screen
Android
    |
Specialized models
```

## Brain layer

Qwen is a reasoning engine, not the process manager.

Responsibilities:

- interpret ambiguous user intent
- plan multi-step work
- choose among allowed tools
- summarize results
- explain alerts
- ask for permission when policy requires it

Do not give the LLM direct uncontrolled access to destructive operations.

## Event bus

Normalize events into a stable schema.

Example event categories:

- `voice.transcript.final`
- `discord.session.joined`
- `research.result`
- `cctv.object.entered_zone`
- `cctv.activity.anomaly`
- `system.gpu.pressure`
- `automation.timer`
- `tool.result`
- `permission.request`

Each event should have:

- id
- type
- timestamp
- source
- payload
- confidence where relevant
- correlation/session id
- privacy class
- references to local artifacts rather than raw blobs where possible

## Perception layer

Use specialized systems:

- STT for speech
- detector/tracker for CCTV
- later screen/OCR/vision model only when needed

Perception emits structured events.

The LLM should not inspect every CCTV frame.

## Tool layer

MCP adapters and custom tools should be permission-aware.

Each tool declares:

- name
- input schema
- output schema
- side-effect class
- timeout
- retry policy
- required secret/service
- whether result is untrusted external content

## Memory

Keep separate concepts:

- short conversation context
- structured long-term facts
- episodic events
- behavior/persona examples
- semantic/vector retrieval
- audit trail

Do not fine-tune the LLM to remember routine user facts.

## CCTV integration

```text
RTSP
 -> ingest
 -> detector
 -> tracker
 -> zone
 -> event aggregation
 -> anomaly rules/baseline
 -> event store
 -> Jarvis event
 -> optional LLM summary
 -> alert
```

MVP does not require face recognition.

## Android edge node

Old Android hardware may later provide:

- wake word / VAD
- microphone
- speaker
- status UI
- local sensor/camera input
- lightweight offline commands
- LAN relay to Jarvis Core

Do not make Jarvis depend on one Android device.

## Autonomous developer

The local coding worker should operate on a development task queue, not directly on Jarvis's live production action bus.

Development sandbox and live assistant runtime should have explicit boundaries.
