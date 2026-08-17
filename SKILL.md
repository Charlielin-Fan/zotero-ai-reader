---
name: zotero-ai-reader
description: Read and annotate complete Zotero papers and collections with background PDF text extraction, native highlights, Chinese comments, category tags, optional child notes, duplicate protection, coverage gates, and JSONL resume/audit. Use when the user asks for Zotero AI Reader, paper evidence annotation, full-paper analysis, native Zotero highlights, or collection processing/resume.
---

# Zotero AI Reader

Use the repository directory containing this `SKILL.md` as `SKILL_ROOT`. Run
all engine commands from that root or pass absolute paths derived from it; do
not depend on the historical desktop checkout path.

## Runtime gate

Run the read-only prerequisite check before processing:

```text
node src/doctor.mjs --json
```

Require a passing result for Node.js, Zotero Desktop, Zotero local API,
`zotero-cli`/`cli-anything-zotero`, the local privileged JS bridge, and the
bundled Zotero PDF.js entries. Report the failed check instead of attempting
library writes when the gate fails. The validated target is Zotero 9.0.6;
do not claim support for another Zotero version without verification.

## Safety contract

- Use the local API for reads and the installed local JS bridge only for native
  Zotero writes.
- Do not modify the official Zotero skill/plugin or any curated Codex plugin.
- Never edit `zotero.sqlite` or use the Zotero Web API to create annotations.
- Never use Computer Use, mouse/keyboard automation, a foreground Reader tab,
  `Zotero.Reader.open()`, or the Zotero Run JavaScript dialog.
- Keep the selected Zotero tab untouched by construction.
- Do not add OCR, an external PDF parser, or a new MCP server.
- Do not overwrite manual annotations. The writer checks attachment, page,
  rectangles, and category tag before saving and returns `already_exists`.
- Treat an unresolved `ambiguous` result as a stop for that quote; use supplied
  context to disambiguate, then skip and report if it remains ambiguous.
- A failed paper should be audited and should not stop the rest of a collection
  unless the failure is systemic (for example, the bridge or local API is down).
- Keep complete extracted text in local memory or an ignored temporary file;
  never put it in Git, an audit JSONL, or a final response.

## Full-paper evidence protocol

Full-paper inspection is mandatory before any `--apply`. Abstract-only analysis
is not a valid stopping point when later usable pages exist. The implementation
for this protocol is `src/extract.mjs`, `src/coverage.mjs`, and
`src/annotate.mjs`.

For each paper, perform one sequential pass:

1. Extract every PDF page through Zotero 9.0.6's installed PDF.js worker. Use
   `extractFullText({ attachmentKey })` or the CLI below; do not open a Reader
   tab. Preserve page boundaries and do not truncate the result.
2. Inspect every page with usable text once, including the body after the
   Abstract. Record `totalPages`, `pagesWithUsableText`, `pagesInspected`,
   `coverageComplete`, and `sectionsSeen` before planning annotations.
3. Collect evidence first, then consolidate related claims and produce one
   plan. Do not reread the whole paper once per category.
4. Prefer substantive body evidence over a duplicate Abstract sentence:
   purpose from Introduction/objective, gap from Introduction/Related Work,
   method from Methods/data/model/experiments, and result from Results/
   Evaluation/Discussion/Conclusion. Use Abstract evidence only when the body
   has no clearer non-duplicate unit.
5. Do not annotate title, authors/affiliations, keywords, or bibliography.
   Appendices are optional. Do not invent evidence when a category is absent.

The plan must declare zero-based source pages and sections for every evidence
unit. `coverageComplete` is a hard write gate: `src/annotate.mjs` re-extracts
the target attachment, checks the declared page counts, requires all usable
pages to be inspected, verifies source pages contain text, and blocks native
writes when evidence is Abstract-only while body pages exist.

Use this public schema:

```json
{
  "attachmentKey": "PDF_ATTACHMENT_KEY",
  "coverage": {
    "totalPages": 10,
    "pagesWithUsableText": 10,
    "pagesInspected": 10,
    "coverageComplete": true,
    "sectionsSeen": ["Abstract", "1 Introduction", "Methods", "Results"],
    "abstractPageIndices": [0]
  },
  "research_purpose": [
    {
      "exact_quote": "direct evidence copied from the body",
      "context_before": "optional preceding searchable text",
      "context_after": "optional following searchable text",
      "summary_zh": "中文摘要",
      "source_page": 1,
      "source_section": "1 Introduction"
    }
  ],
  "research_gap": [],
  "research_method": [],
  "research_result": []
}
```

`source_page` is zero-based and must match the independently located native
position. `context_before` and `context_after` are locator-only context and
must not be highlighted unless included in `exact_quote`. Multiple useful
evidence units in one category are allowed and preferred to a forced single
quote. The child note, when requested, is generated from this same final plan;
it does not trigger a second analysis.

## Categories and native colors

| Plan category | Evidence scope | Native tag | Color |
|---|---|---|---|
| `research_purpose` | research object and objective | `研究目的` | yellow `#ffd400` |
| `research_gap` | data, method, problem-awareness, or research gap | `研究缺口` | blue `#2ea8e5` |
| `research_method` | theory, method, variables, or workflow | `研究方法` | red `#ff6666` |
| `research_result` | conclusions, findings, or limitations | `研究结果` | green `#5fb236` |

## Select the engine command

For one paper, first extract and inspect the complete paper, then run the
single-attachment orchestrator:

```text
node src/extract.mjs --attachment-key KEY --out ignored-full-text.json
node src/annotate.mjs --plan analysis.json --apply
```

Add `--note` only when the user asks for a structured child note. Omit
`--apply` for a read-only preview. The apply path rechecks coverage before
calling the native writer.

For a collection, analyze each paper independently with full coverage, then
use the resume/audit runner:

```text
node src/run.mjs --collection "Collection name or key" --plan analysis-set.json --apply --audit .codex/audit.jsonl
```

Add `--note` for child notes and `--force` to retry completed item/attachment
pairs. Audit records include coverage counts, planned/created/already-existing
annotation counts, and skipped-ambiguous counts; they do not include full text.
A paper-level failure or incomplete coverage is audited and skipped without
stopping unrelated papers unless the failure is systemic.

For a locator-only request, use:

```text
node src/locator.mjs --attachment-key KEY --exact-text "quote"
```

`unique` is eligible for writing; `not_found` is reported and skipped;
`ambiguous` is retried with context and skipped if still unresolved. The engine
never silently selects the first match.

## Development and compatibility

Run public unit tests with:

```text
npm test
```

The Zotero integration test is opt-in and requires a user-supplied private
JSON config via `ZOTERO_INTEGRATION_CONFIG` with
`ZOTERO_INTEGRATION=1`; do not commit that config or a private PDF.

Known unsupported or unverified cases are OCR-only PDFs, PDFs without usable
text layers, unusual rotation, dedicated ligature edge cases, and Zotero
versions other than 9.0.6. No external parser or GUI fallback is permitted.
