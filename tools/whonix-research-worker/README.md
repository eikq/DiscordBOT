# Jarvis Whonix research worker

This package is intended to run **inside Whonix Workstation**, not on the Windows
host and not against the owner's Chrome or Edge profile.

```
Jarvis Core
  → PrivateResearchGateway
    → Whonix Workstation
      → Playwright
        → dedicated Chromium
          → Whonix Gateway
            → Tor
              → Internet
```

## Install (Workstation only)

On Whonix Workstation only, after first-boot acknowledgement:

```bash
bash bootstrap-guest.sh
```

Or use the Node.js / npm already provisioned in the guest. Then:

```bash
npm install
npx playwright install chromium
```

Do **not** pass `channel: "chrome"` or `channel: "msedge"`.
Do **not** set `userDataDir` to a host or owner profile.
Every task must create a new context and destroy it.

Host `PRIVATE_BROWSER` stays unavailable until Gateway + Workstation + isolation
health checks pass. The host must never fall back to this worker on Windows.
