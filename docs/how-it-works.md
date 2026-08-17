# How it works

This document describes the public implementation at release `v0.2.0`. The
project deliberately keeps the PDF reader and native writer as separate stages
so a read-only preview can be inspected before a library mutation.

## Read path

```text
attachment key
  → Zotero local API resolves a file URL
  → installed omni.ja provides pdf.mjs and pdf.worker.mjs
  → PDF.js loads the file in Node
  → page.getPageData({ pageIndex }) returns chars + viewBox
  → Reader-compatible search stream and source map
  → section observations
  → global Paper Model
  → Understanding Gate
  → required/useful/background classification
  → Paper Model node coverage + Annotation Coverage Gate
  → exact occurrences → native rects + sortIndex
```

The main functions are:

| Stage | Location | Responsibility |
| --- | --- | --- |
| Attachment resolution | `src/locator.mjs` | Read a local file URL from the Zotero local API. |
| Runtime extraction | `src/locator.mjs` | Extract only Zotero's installed `pdf.mjs` and `pdf.worker.mjs` into a temporary cache. |
| Page loading | `src/locator.mjs` | Use PDF.js `getDocument`, then `getPageData` for each page. |
| Search semantics | `src/locator.mjs` | Build text from `char.u`, preserve UTF-16 code-unit mapping, and add Reader spacing flags. |
| Geometry | `src/locator.mjs` | Map an occurrence back to structured chars and union their `inlineRect` values by line. |
| Sort order | `src/locator.mjs` | Find the closest source-character array index and compute Zotero-compatible page/top fields. |
| Coverage | `src/extract.mjs`, `src/coverage.mjs` | Require all usable pages and source metadata before an apply run. |
| Semantic synthesis | `src/semantic.mjs` | Validate section observations, evidence-grounded Paper Model claims, cross-section relations, method-pipeline quality, node priorities, and the Understanding Gate. |
| Annotation coverage | `src/annotation-coverage.mjs` | Compare required Paper Model nodes with final annotation references, preserve multi-node passages, deduplicate true repeats, and report reconstructability/overcompression diagnostics. |
| Native write | `src/writer.mjs` | Build the installed bridge script and call Zotero's native annotation transaction path. |
| Orchestration | `src/annotate.mjs`, `src/run.mjs` | Resolve plans, retry with context, gate writes, and record compact audit state. |

## Search-to-geometry mapping

Each structured character contributes `char.u` to a page search stream. Every
UTF-16 code unit in that value maps back to the character index. `spaceAfter`,
`lineBreakAfter`, and `paragraphBreakAfter` add a searchable space mapped to the
preceding character. The text is normalized with NFD in the same stream-building
step used by the locator.

When an occurrence is found, the source map identifies the first and last
structured character. The source characters are sliced from the page and their
`inlineRect` values are unioned until `lineBreakAfter`; each resulting rectangle
is rounded to three decimal places. A selected occurrence is therefore
represented by `{ pageIndex, rects }`, rather than by an approximate visual
coordinate.

`sortIndex` is computed from that position and the same page data: the locator
uses the closest structured-character array index to the top-most rectangle,
then combines the zero-padded page index, character offset, and page-top field.
The implementation intentionally keeps this logic in one module so tests can
exercise it without a live write.

## Semantic path

The four categories are derived only after a complete-paper synthesis. Each
section or page chunk produces provisional observations; these observations are
then consolidated into one Paper Model containing the problem, gap, objective,
data, method stages, evaluation, results, contribution, limitations, and
end-to-end story. Every substantive model claim carries a page and exact-text
evidence reference and an explicit `required`, `useful`, or `background`
annotation priority. Cross-section relations connect why the method exists to
how it is evaluated and what the results demonstrate.

The Understanding Gate checks that the model is structurally grounded, that
the required research questions are answered, that a substantive method
pipeline is not collapsed into a generic label, and that enough observations
support the synthesis. A plan can have complete page coverage and still fail
this gate. The separate Annotation Coverage Gate checks that every required
node is referenced by a final, locatable annotation (or has an explicit
no-annotation-worthy reason). One continuous passage may reference multiple
closely related nodes; a category is not complete because it has one or two
entries. Annotation entries must resolve one or more `paper_model_refs` and
carry a `semantic_role`; a keyword alone cannot create an annotation.

## Write path

The writer receives only resolved, unique locations after all three gates pass.
It validates category, quote, summary, and context fields before constructing a small in-process
JavaScript request. The native save call is the only library write in the
annotation path. Duplicate detection is performed before creating a new native
highlight. The optional child note is a separate, explicit operation.

The project never opens a visible Reader tab for extraction or locating. The
temporary object is a PDF.js document and is destroyed in a `finally` block.
Child notes, when requested, are rendered from the same Paper Model rather
than triggering a second independent analysis.

## What is not promised

The local implementation is verified against Zotero `9.0.6` and the installed
bundled PDF.js build. Internal Zotero structures can change between releases;
other versions, OCR-only files, and difficult font/rotation cases remain
unsupported or `[UNVERIFIED]` until tested.
