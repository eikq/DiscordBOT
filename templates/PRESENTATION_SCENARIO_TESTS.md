# Presentation Scenario Test Matrix

Use this template when implementing the decoupled Presentation Engine.

| Scenario | Brain | Persona | Voice | Expected |
|---|---|---|---|---|
| default Jarvis | jarvis | jarvis | jarvis | normal Jarvis response |
| Gam full | jarvis | gam | gam | verified facts, Gam style, Gam voice |
| Gam voice only | jarvis | jarvis | gam | Jarvis style, Gam voice |
| Gam persona only | jarvis | gam | jarvis | Gam style, Jarvis voice |
| Elemisu voice only | jarvis | jarvis | elemisu | Jarvis style, Elemisu voice |
| mixed | jarvis | gam | elemisu | Gam style, Elemisu voice |

Required assertions:

- persona selection does not mutate voice profile
- voice selection does not mutate persona profile
- verified facts survive rendering
- persona memory is scoped
- one-turn override expires
- session override persists only in that session
- legacy `/voice` mapping still produces current expected behavior
