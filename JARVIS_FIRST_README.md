# Jarvis-First Priority Addendum

This addendum changes project priority.

## New priority

Build the standalone Jarvis platform first.

Discord / Digital Me integration is deferred until Jarvis Core v1 is stable.

Do not delete or break existing Discord code. Keep it compiling and keep compatibility tests passing, but do not spend development time on new Discord features, live Discord verification, slash-command UX, voice-channel behavior, or Discord-specific presentation work unless a Jarvis-core change would otherwise break the existing system.

## Install

Copy this addendum into the repository root:

`C:\Users\piriy\Documents\DiscordBOT`

Then give Cursor the contents of:

`CURSOR_JARVIS_FIRST_PROMPT.md`

This addendum supersedes the previous task ordering where JARVIS-004/005 Discord integration might have been next.
