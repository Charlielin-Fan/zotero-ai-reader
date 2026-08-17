# Zotero AI Reader v0.2.0

Zotero AI Reader is a local-first Codex skill for complete-paper evidence
annotation in Zotero.

## Highlights

- Reconstructs an evidence-grounded Paper Model before annotation planning.
- Adds separate Understanding and Annotation Coverage Gates for required
  method, result, and limitation evidence.
- Validates semantic roles, cross-section synthesis, method pipelines, and
  source-page coverage before any native write.
- Reads every usable PDF page before an apply run.
- Maps exact quotes through Zotero's installed PDF.js text and geometry semantics.
- Reports ambiguity instead of silently choosing the first repeated match.
- Uses native Zotero annotation persistence through the local bridge.
- Adds four evidence categories, Chinese comments, tags, and optional child notes.
- Keeps private plans, PDFs, database files, and credentials outside the package.

## Verified environment

- Windows
- Zotero Desktop `9.0.6`
- Zotero AI Reader skill/plugin `0.1.2`
- Node.js `24.11.1`
- `cli-anything-zotero` / `zotero-cli` `1.2.1`

## Install

Copy the repository to a user-owned Codex skill directory, install the separate
local Zotero bridge, run `node src/doctor.mjs --json`, and preview a plan before
using `--apply`. Full instructions are in [README.md](../README.md).

## Safety and limitations

This project does not edit `zotero.sqlite`, use GUI automation, upload PDFs, or
provide OCR. Native apply changes the user's Zotero library and requires human
review. OCR-only PDFs, unusual rotations, difficult font cases, and Zotero
versions other than `9.0.6` remain unsupported or `[UNVERIFIED]`.

## Downloads

- GitHub source archives for tag `v0.2.0` will contain the clean public source.
- `SHA256SUMS.txt` — checksum for the archive.

The accompanying Xiaohongshu material is a package only; no post is published by
this release process.
