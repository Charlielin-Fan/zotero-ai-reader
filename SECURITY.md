# Security policy

## Scope

Security reports are welcome for the repository, the local bridge invocation,
secret handling, file-path handling, and accidental Zotero writes.

## Do not publish sensitive material

Do not put any of the following in a public issue or pull request:

- Zotero API keys, bridge tokens, private keys, cookies, or environment files;
- Zotero profile paths, database copies, private attachment keys, or item IDs;
- PDFs, extracted full text, annotation dumps, or audit logs from a private library;
- screenshots that expose a library, account, or filesystem path.

If a report contains sensitive data, remove it from the public channel and contact
the maintainer through a private channel before sharing details. This repository
does not promise a private security inbox yet: that channel is `[UNVERIFIED]` and
must be agreed with the maintainer before confidential material is sent.

## Safe testing

Use synthetic structured-character fixtures for unit tests. For a real library,
run the doctor and a dry-run preview first, verify the attachment, and keep a
backup before `--apply`. The project should never edit `zotero.sqlite` directly.

## Disclosure

Please include the affected version, operating system, reproduction steps that do
not reveal private data, expected behavior, and whether any library write occurred.
