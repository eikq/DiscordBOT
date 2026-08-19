# Whonix + VirtualBox setup (JF-014.55A)

Resolved from official sources on 2026-08-19:

| Item | Official value |
|---|---|
| Whonix Windows hypervisor | Latest VirtualBox from virtualbox.org |
| VirtualBox Windows package | 7.2.16-174877 (`VirtualBox-7.2.16-174877-Win.exe`) |
| SHA256 | `9383a42bffa5c0ac4bc5f1c7d820478d84380d3a17b65aa9b43e6778cbdb615a` |
| Hash list | https://download.virtualbox.org/virtualbox/7.2.16/SHA256SUMS |
| Authenticode | Publisher must contain Oracle Corporation / Oracle America |
| Extension Pack | **Not installed** (PUEL; USB/PXE not needed) |
| Whonix edition | Stable LXQt VirtualBox, 18.2.1.9 Intel/AMD64 |
| OVA | https://download.whonix.org/ova/18.2.1.9/Whonix-LXQt-18.2.1.9.Intel_AMD64.ova |
| SHA512 | `*.ova.sha512sums` + `.asc` / `.sig` on the same official directory |
| Windows installer for Whonix | Officially unavailable |

The older wiki filename `Whonix-LXQt-18.2.1.9.ova` (without `Intel_AMD64`)
returned 404. The live `download.whonix.org/ova/18.2.1.9/` listing is the
source of truth.

## Isolation

Do not enable shared clipboard, drag-and-drop, shared folders, host filesystem
mounts, owner browser profiles, camera, microphone, or extra USB.

Whonix Workstation must **not** receive Bridged, NAT, or LAN adapters.
Internet path is Workstation → Gateway → Tor → Internet.

## Host security

Memory Integrity / VBS stay on. If VirtualBox is slower because of that,
report the limitation. Do not disable host protections.

## Provision scripts

```text
npx tsx scripts/provision_virtualbox.ts
npx tsx scripts/provision_whonix.ts
npx tsx scripts/whonix_health.ts
```

VirtualBox installer: official EXE into `.runtime/provisioning/`, SHA256 +
Authenticode, then launch. Windows UAC may appear. Jarvis does not bypass it.

## Live import evidence (2026-08-19)

| Check | Result |
|---|---|
| `VBoxManage --version` | `7.2.16r174877` |
| OVA | `Whonix-LXQt-18.2.1.9.Intel_AMD64.ova` (2,791,580,160 bytes) |
| SHA512 | Matches official `*.ova.sha512sums` |
| OpenPGP key | Official `https://www.whonix.org/keys/derivative.asc` fingerprint `916B 8D99 C38E AF5E 8ADC 7A2A 8D66 066A 2EEA CCDA` |
| OpenPGP OVA | `Good signature` from Patrick Schleizer; `file@name=Whonix-LXQt-18.2.1.9.Intel_AMD64.ova` |
| OpenPGP sums | `Good signature`; `file@name=...ova.sha512sums` |
| Signify | Not available on this Windows host; OpenPGP of the OVA is the stronger official path |
| Imported VMs | `Whonix-Gateway-LXQt`, `Whonix-Workstation-LXQt` only |
| Gateway NICs | NIC1 NAT (official), NIC2 Internal `Whonix` |
| Workstation NICs | NIC1 Internal `Whonix` only; NIC2–8 disabled |
| Isolation applied | clipboard off, drag-and-drop off, shared folders none, USB controllers off, audio capture off, no USB filters, host camera not attached |
| First-boot legal/security dialogs | **OWNER_ACTION_REQUIRED** — not auto-accepted |

After first-boot inside Workstation only:

```bash
bash tools/whonix-research-worker/bootstrap-guest.sh
```

Do not run that script on the Windows host.
