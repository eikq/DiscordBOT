# Jarvis privilege model (JF-014.5)

The model never equals execution.

```text
LLM → structured intent → capability request → PermissionPolicy
  → privilege lease (when required) → typed handler → result
```

There is no `shell("anything")` capability.

## Leases

`PrivilegeLeaseStore` issues short-lived, scoped, audited, revocable,
non-transferable leases.

Jarvis / the model / a webpage / a skill cannot:

- approve a lease
- renew a lease
- expand a lease

Only actor `owner` can issue, approve, renew, or expand.

`research.privateBrowse` requires a valid lease **and** ActionGate
confirmation. Retrieval research (`research.current` and friends) stays
READ_ONLY and does not use a lease.
