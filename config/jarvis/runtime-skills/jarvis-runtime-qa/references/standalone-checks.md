# Standalone Jarvis verification reference

Recommended evidence order:

1. `npx tsx --test` with the smallest relevant Jarvis test files.
2. `npx tsc --noEmit`.
3. `npm run build` when frontend/server bundling changed.
4. Browser verification at `http://127.0.0.1:3010/jarvis-lab`.
5. `npm test` for the final repository regression gate.

Never claim Discord, microphone hardware, cloned voice quality, or external tool freshness from unit tests alone.
