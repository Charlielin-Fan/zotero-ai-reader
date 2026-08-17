# Contributing

Thank you for helping improve Zotero AI Reader. The project is intentionally
conservative because its apply path can change a user's Zotero library.

## Before opening a change

- Explain the user-visible problem and the reason the change belongs in this
  project rather than in Zotero or the local bridge.
- Do not include PDFs, private item keys, annotation IDs, library exports,
  profile paths, credentials, or full extraction output.
- Keep public tests synthetic and deterministic.
- Preserve the Zotero `9.0.6` compatibility contract unless a change explicitly
  documents a version boundary.

## Development checks

```powershell
npm test
node src/doctor.mjs --json
```

The doctor check may fail on a machine without Zotero and the bridge; that is an
environment result, not a reason to weaken the public unit tests.

## Pull requests

Describe the read/write surface, test evidence, and any new external dependency.
Changes that can write to Zotero must include a dry-run path and a test showing
that ambiguity fails closed. Do not rewrite another contributor's history.

By submitting a contribution, you agree that it may be distributed under the
project's [MIT License](LICENSE).
