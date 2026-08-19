# Private research (JF-014.55B / JF-014.55C)

Two modes:

| Mode | Path | When |
|---|---|---|
| RETRIEVAL | Existing JF-013 GET research | Low-risk public facts |
| PRIVATE_BROWSER | Whonix + Playwright + dedicated Chromium | Arbitrary/untrusted/JS-heavy/privacy-sensitive URLs |

`PRIVATE_BROWSER_AVAILABLE` is true only after Gateway + Workstation are up,
Workstation isolation looks official, **and** a live Tor check returns `up`.
VMs running with isolation OK but no Tor proof stays
`LIVE_TOR_CHECK_REQUIRED` and `available=false`.

Fail closed:

- No owner Chrome / Edge
- No host Playwright fallback
- No silent RETRIEVAL substitution for a PRIVATE_BROWSER task

Worker package: `tools/whonix-research-worker/` — install **inside**
Whonix Workstation only.

Depth for RETRIEVAL: `quick | standard | deep | forensic` via
`planResearchDepth()`. More URLs are not automatically more evidence.
