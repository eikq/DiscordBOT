# Jarvis-First Development Directive

Status: Active project priority  
Owner intent: Finish a useful standalone Jarvis first; return to Discord/Digital Me afterward.

## 1. Priority rule

From this point forward:

```text
JARVIS CORE / STANDALONE JARVIS
            |
            v
     Jarvis Core v1 stable
            |
            v
   Discord/Digital Me integration
```

Discord is not the product being optimized right now.

It remains an existing client/subsystem that must not be broken.

## 2. Freeze Discord feature work

Until Jarvis Core v1 reaches its definition of done:

Do not prioritize:

- JARVIS-004 live Discord voice/persona decoupling
- JARVIS-005 DiscordJarvisAdapter runtime migration
- new slash commands
- Discord presentation UX
- Discord live smoke tests unless needed for a regression
- cloned-persona Discord scenarios
- spoken research inside Discord
- Discord-specific memory features

Allowed Discord work:

- fix a compile/test regression caused by Jarvis refactoring
- preserve current compatibility behavior
- keep existing consent/privacy invariants
- add small adapters/interfaces only when they unblock Jarvis Core design

## 3. What "Jarvis first" means

The next system should work as a standalone local assistant without Discord.

Target standalone loop:

```text
Text or Microphone
        |
        v
   Jarvis Client
        |
        v
    Jarvis Core
   /    |     \
Memory Tools  Policy
   \    |     /
        v
 Structured Result
        |
        v
Presentation Engine
   Persona + Voice
        |
        v
Text + Local Speech
```

## 4. Jarvis should be client-agnostic

Jarvis Core must not import Discord transport types.

Core should be reusable by:

- desktop UI
- local CLI
- Android client
- Discord later
- CCTV/event system later
- automation later

## 5. Immediate engineering priorities

Priority order:

1. Jarvis Core contracts and orchestration
2. canonical memory implementation
3. tool/capability framework
4. standalone local client
5. standalone voice path
6. presentation profiles (persona and voice independent)
7. permission/action framework
8. Jarvis UI / `/jarvis-lab`
9. runtime/resource profiles
10. automation/proactive events
11. CCTV integration
12. Discord integration after Jarvis v1

## 6. Preserve current investment

Do not rewrite existing working components if they can be adapted:

- Qwen3.8 / LocalLlmProvider
- Qwen3-ASR
- SocialMemoryBrain data/provenance concepts
- research MCP gateway
- TTS/RVC provider abstractions
- dashboard server
- existing tests

The standalone Jarvis should reuse these through clean interfaces.

## 7. Reasoning / presentation split

Keep:

```text
Jarvis reasoning -> structured facts/results
                 -> presentation/persona
                 -> voice
```

Voice and persona are independent.

This design remains important even though Discord is deferred.

## 8. Truth boundary

Persona may change style.

Persona must not alter:

- verified facts
- tool results
- permission decisions
- action results
- memory provenance
- errors/degraded state

## 9. Standalone-first testing

Prefer tests that can run without Discord credentials.

The primary local smoke target becomes:

```text
local text input
 -> Jarvis Core
 -> memory/tool reasoning
 -> presented text
```

Then:

```text
microphone
 -> STT
 -> Jarvis Core
 -> TTS
 -> local audio output
```

Discord is no longer the primary live-verification target.

## 10. Development mode

Do not start all voice/Discord services for every coding task.

Create or document a Jarvis development profile that can run:

- Ollama/Qwen
- memory
- research/tools
- dashboard/standalone client

without Discord and without unnecessary RVC/JaiTTS residency unless testing voice.

This protects VRAM and speeds iteration.
