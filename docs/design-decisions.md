# Design decisions

## Full-paper coverage is a write gate

An abstract can be clear while the body contains the decisive method or result.
The apply path therefore re-extracts the PDF and checks declared page coverage,
usable-page counts, section metadata, source pages, and body evidence before it
calls the writer. This adds work but makes an accidental Abstract-only write
fail closed.

## Coverage is necessary but not sufficient

Inspecting every usable page proves coverage, not understanding. The plan must
also contain a grounded global Paper Model and an Understanding Gate record.
Native writes require `coverageComplete`, `understandingComplete`, and
`annotationCoverageComplete`; a paper with a complete page scan and a valid
Paper Model can still be skipped if required model information disappears from
the final annotation set.

## Preserve minimum sufficient evidence

Paper Model nodes are explicitly classified as `required`, `useful`, or
`background` according to their function in the reconstructed research logic.
The annotation planner covers every required node first, permits one
continuous passage to cover multiple closely related nodes, retains useful
evidence only when it materially improves reconstruction, and removes only
true semantic duplicates. It does not use fixed annotation quotas, category
completion, or a top-N cutoff. `annotationCoverageComplete` is a comparison
between required node references and final annotation references, not a count.

An explicit `no_annotation_worthy_evidence` exception remains visible in the
coverage record. Ambiguity, locator failure, not-found evidence, and selection
omission remain failures and cannot be silently counted as covered.

## Understand before categorizing

Section observations remain provisional until the full paper has been read.
The semantic layer then synthesizes cross-section relations and a substantive
method pipeline before deriving the four annotation categories. Keyword
presence is never sufficient evidence for classification, and every final
annotation points back to a Paper Model component and semantic role.

## Exact quotes stay exact

The plan schema separates `exact_quote` from `summary_zh`. The quote is the
searchable source text; the summary is annotation commentary. The locator does
not silently rewrite quotes, use OCR, or fall back to an external parser.

## Ambiguity is a first-class result

Repeated text returns all candidates. `context_before` and `context_after` are
optional disambiguators. If more than one candidate remains, the run skips that
annotation and records the candidates rather than guessing.

## Background PDF.js instead of GUI control

The public CLI reads the PDF through the PDF.js modules shipped in Zotero's
installed `omni.ja`. It does not focus Zotero, switch tabs, or simulate pointer
or keyboard input. This keeps batch work automatable and makes read-only tests
repeatable.

## No direct database writes

Zotero's item and annotation persistence is an application concern. The project
resolves attachments through the local API, reads annotation keys for integrity
checks, and delegates native writes to the installed in-process Zotero API. It
never opens or edits `zotero.sqlite`.

## Small dependency surface

The package has no npm dependencies. The only runtime PDF implementation is the
version of PDF.js already installed by Zotero; the local bridge is an explicit
user prerequisite. This reduces distribution size and avoids bundling a second
PDF parser with subtly different text geometry.

## Public repository hygiene

The working repository may contain private milestone history from development.
The public release is made from a clean, sanitized snapshot so private item keys,
paper text, local paths, logs, plans, and profile data do not become part of the
published history. This is a release-process decision; it does not alter the
user's local Zotero library.
