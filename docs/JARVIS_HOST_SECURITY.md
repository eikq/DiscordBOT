# Jarvis host security

SEC-000 is a **read-only** host baseline. Jarvis does not enable, disable, or
decrypt anything.

## Owner decisions

- Do **not** enable BitLocker.
- Do **not** enable Device Encryption.
- If encryption is already on, report it only. Do not decrypt.
- Do not disable Defender, Firewall, Tamper Protection, Memory Integrity,
  Core Isolation, Secure Boot, or UAC to make VirtualBox faster.
- Do not bypass UAC.
- Normal Jarvis runtime stays a standard user.

## Probe

`probeHostSecurity()` reads registry values only. It never writes.

Classification for drive encryption:

```text
OFF | ON | UNKNOWN
```

Unknown is honest when WMI/`manage-bde` is unavailable. Presence of AutoDE
evaluation keys is **not** treated as encryption-on.

## Lab

`GET /api/jarvis/security` (loopback only) returns the same snapshot.
