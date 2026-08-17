# Public release audit

Audit date: 2026-08-17 (Asia/Shanghai).

## Scope

The release audit covers the current worktree, the local development history,
the clean public snapshot, and generated distribution contents. It does not
inspect or change the Zotero profile or `zotero.sqlite`.

## Findings

- The current worktree contains source, tests, public documentation, MIT license,
  and synthetic visual assets only.
- No credentials, private keys, bridge tokens, API keys, PDFs, SQLite files,
  full extraction output, or private logs are included in the public snapshot.
- Historical development commits contained private test identifiers and local
  milestone material. They were classified as private-but-non-secret and are
  excluded from the clean public history; the local development repository is
  not destructively rewritten.
- The current public files do not contain a user's attachment key, annotation
  key, item ID, or private filesystem path.
- The generated XHS images use synthetic text and an abstract background; they do
  not show Zotero, a paper page, or a user library.

## Reproducible checks

```powershell
git diff --check
npm test
node src/doctor.mjs --json
```

The final distribution archive is checked for forbidden names and its SHA-256
digest is written to `dist/SHA256SUMS.txt`. Any future release must repeat this
audit after changing the source snapshot.

## External publication status

This audit authorizes preparation only. GitHub publication requires an
authenticated, user-approved GitHub route; Xiaohongshu publication was explicitly
not authorized and is not performed. See `release/xiaohongshu/PUBLISH.md` for the
package-only status.
