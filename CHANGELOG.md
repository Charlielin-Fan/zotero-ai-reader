# Changelog

All notable public changes are recorded here. The format follows the spirit of
Keep a Changelog; releases use semantic version labels.

## [Unreleased]

### Added

- Evidence-grounded Paper Model reconstruction and provisional section observations.
- Separate Understanding Gate alongside the existing full-paper coverage gate.
- Cross-section synthesis checks, substantive method-pipeline validation, and
  semantic roles for every planned annotation.
- Structured child notes generated from the Paper Model and semantic-workflow
  tests for shallow keyword false positives.

## [0.1.0] - 2026-08-17

### Added

- Full-paper extraction and coverage gate before native annotation writes.
- Background exact-text locator with Reader-compatible text/geometry semantics.
- Context disambiguation and fail-closed handling for repeated quotes.
- Native four-category annotation plan with Chinese comments, tags, and colors.
- Optional child-note creation and resumable collection audit records.
- Public documentation, MIT license, community policy, security guidance, and
  synthetic release visuals.

### Verified

- Zotero Desktop `9.0.6` on Windows.
- Zotero AI Reader skill/plugin `0.1.2`.
- Node.js `24.11.1`.
- `cli-anything-zotero` / `zotero-cli` `1.2.1`.

### Limitations

- OCR-only files, unsupported Zotero versions, and several difficult PDF font or
  rotation cases remain unsupported or `[UNVERIFIED]`.
- GitHub publication and the Xiaohongshu post are external release actions, not
  performed by the local test suite.
