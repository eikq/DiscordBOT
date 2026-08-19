# Private browser policy

Every autonomous browse:

```text
start → new non-persistent context → navigate/read → extract
  → close page → destroy context → close browser
```

Allow: navigate, read, scroll, render JS, follow public links, search,
extract, metadata, temporary screenshot when required.

Deny by default: login, account creation, purchase, payment, upload, send,
comment, sensitive forms, save password, extensions, executable download,
camera, microphone, geolocation, clipboard.

Downloads are denied. `.exe .msi .ps1 .bat .cmd .scr .dll .jar` are
explicitly blocked. There is no download → execute path.
