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
- Never use keyword presence as sufficient evidence for a category. Words such
  as `aim`, `purpose`, `method`, `propose`, `result`, or `limitation` are
  rhetorical signposts until their functional role in the Paper Model is
  established.
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
3. For each page or section chunk, record temporary structured observations
   (`section_observations`). Observations are provisional; they are not yet
   four-category annotations and must not lock the interpretation early.
4. After the complete pass, synthesize all observations into one global Paper
   Model. Connect the introduction's gap, the method's design choice, the
   evaluation, and the results before selecting any annotation evidence.
5. Build an Understanding Gate record. `coverageComplete` is necessary but
   not sufficient: native writes also require
   `understandingComplete === true`.
6. Assign every substantive Paper Model node an explicit
   `annotation_priority`: `required`, `useful`, or `background`. Assign this
   from the node's function in the reconstructed research logic, never from a
   keyword. Required nodes are information whose omission would materially
   impair reconstruction; useful nodes improve understanding without being
   indispensable; background nodes support comprehension but normally remain
   unhighlighted.
7. Ground each Paper Model claim in one or more original page/evidence
   references, then select the minimum sufficient evidence set. Cover every
   required node first, allow one continuous passage to reference multiple
   closely related nodes, add useful evidence only when it materially improves
   reconstruction, remove true semantic duplicates, and run the annotation
   coverage/reconstructability check. Do not reread the whole paper once per
   category.
8. Prefer substantive body evidence over a duplicate Abstract sentence:
   purpose from Introduction/objective, gap from Introduction/Related Work,
   method from Methods/data/model/experiments, and result from Results/
   Evaluation/Discussion/Conclusion. Use Abstract evidence only when the body
   has no clearer non-duplicate unit.
9. Do not annotate title, authors/affiliations, keywords, or bibliography.
   Appendices are optional. Do not invent evidence when a category is absent.

The plan must declare zero-based source pages and sections for every evidence
unit. `src/annotate.mjs` re-extracts the target attachment, checks the declared
page counts, requires all usable pages to be inspected, verifies source pages
and Paper Model evidence against the text layer, computes required-node
annotation coverage, and blocks native writes unless
`coverageComplete === true`, `understandingComplete === true`, and
`annotationCoverageComplete === true`.

## Paper Model and semantic understanding

Do not search the paper for four categories. Understand the paper first. Only
after reconstructing the paper's research logic should you decide which
original passages deserve the four annotation labels.

The internal model is a concise synthesis, not hidden chain-of-thought. It must
answer, with evidence references, what problem is being solved, why existing
approaches are insufficient, what the paper proposes or investigates, what data
or input it uses, how the research process works end to end, how it is
evaluated, what the results demonstrate, what the contribution is, and what
limitations are acknowledged. The model adapts to review, theoretical, and
empirical papers rather than forcing every paper into a machine-learning
pipeline.

Use the schema below (additional `research_type` and
`cross_section_relations` fields are supported):

```json
{
  "section_observations": [
    {
      "section": "Methods",
      "page_indices": [5, 6],
      "observations": [
        {
          "type": "method_step_candidate",
          "summary": "The input is segmented before vectorization.",
          "exact_quote": "direct source text",
          "page": 5
        }
      ]
    }
  ],
  "paper_model": {
    "research_type": "methodological",
    "research_context": {"summary": "...", "annotation_priority": "background", "evidence_refs": []},
    "core_problem": {"summary": "...", "annotation_priority": "required", "evidence_refs": []},
    "existing_approaches": [
      {"approach": "...", "limitation": "...", "annotation_priority": "useful", "evidence_refs": []}
    ],
    "research_gap": [
      {"gap": "...", "why_it_matters": "...", "annotation_priority": "required", "evidence_refs": []}
    ],
    "research_objective": {"summary": "...", "annotation_priority": "required", "evidence_refs": []},
    "research_questions_or_hypotheses": [],
    "data": [
      {"name": "...", "source": "...", "role": "...", "important_properties": "...", "annotation_priority": "required", "evidence_refs": []}
    ],
    "method_pipeline": [
      {
        "step": 1,
        "name": "...",
        "input": "...",
        "operation": "...",
        "output": "...",
        "why_needed": "...",
        "annotation_priority": "required",
        "depends_on": [],
        "evidence_refs": []
      }
    ],
    "experimental_design": {"summary": "...", "annotation_priority": "required", "evidence_refs": []},
    "evaluation": {"metrics": [], "baselines_or_comparisons": [], "validation_strategy": "...", "annotation_priority": "required", "evidence_refs": []},
    "key_results": [
      {"result": "...", "what_it_demonstrates": "...", "annotation_priority": "required", "evidence_refs": []}
    ],
    "contributions": [{"contribution": "...", "annotation_priority": "required", "evidence_refs": []}],
    "limitations": [{"limitation": "...", "annotation_priority": "required", "evidence_refs": []}],
    "cross_section_relations": [
      {"relation": "gap → design → evaluation → result", "annotation_priority": "useful", "evidence_refs": []}
    ],
    "end_to_end_story": {"summary": "...", "annotation_priority": "useful", "evidence_refs": []}
  },
  "understanding": {
    "paperModelBuilt": true,
    "core_problem": true,
    "research_gap": true,
    "objective": true,
    "data_or_input": true,
    "workflow_reconstructed": true,
    "evaluation_understood": true,
    "results_connected_to_claims": true,
    "contribution_identified": true,
    "limitations_identified": true,
    "understandingComplete": true
  }
}
```

For empirical, computational, methodological, or remote-sensing papers, each
major method stage must state what goes in, what operation occurs, what comes
out, why the step is needed, and how it connects to the next stage. A model
that says only “use deep learning” is not an acceptable pipeline when the
paper describes multiple transformations. If the paper is theoretical or a
review, represent its actual assumptions/derivation or search/screening/
synthesis workflow instead.

Every final annotation entry must carry one or more resolvable
`paper_model_refs` (for example `method_pipeline.step_3` and `key_results.0`)
and a `semantic_role`. `paper_model_ref` remains accepted as the one-node
compatibility form. An entry without a resolvable model reference is rejected.
Understanding evidence may be used to build the model without becoming a
highlight; the final four categories retain only evidence useful for later
literature review.

### Annotation information coverage

The four colors are organizational labels, not annotation quotas. A category
is not complete merely because it has one or two entries. Before a plan is
finalized, compare the required Paper Model nodes with the nodes referenced by
the proposed annotations:

```text
all grounded comprehension evidence
  → required/useful/background classification
  → best annotation-worthy evidence for required nodes
  → required-node coverage and reconstructability check
  → useful evidence only when it materially improves reconstruction
  → true semantic deduplication
  → Annotation Coverage Gate
```

`annotationCoverageComplete` is true only when every required node is covered
by at least one final annotation, or has an explicit
`no_annotation_worthy_evidence` status and reason. `ambiguous`,
`locator_failure`, `not_found`, and `selection_omission` remain visible
failures; they are never silently counted as coverage. One continuous source
passage may list multiple closely related `paper_model_refs`; non-contiguous
passages must not be combined. Useful nodes may be annotated when they
materially improve reconstruction, while background nodes do not force a
highlight.

Do not optimize for the smallest possible annotation count. The target is the
minimum sufficient, non-redundant evidence set that lets a researcher who has
not read the paper reconstruct the central research logic from the highlights
and Chinese comments. This is not a mathematically lossless compression claim
and does not make semantic interpretation infallible.

The implementation enforces this contract in `src/semantic.mjs`. It does not
perform a keyword classifier and does not claim infallible semantic
understanding. If a central connection cannot be grounded or explained,
set `understandingComplete` to `false` and do not apply annotations.

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
  "section_observations": [],
  "paper_model": {},
  "understanding": {},
  "annotation_coverage": {
    "nodes": {
      "core_problem": {"status": "covered", "annotation_indices": [0]},
      "method_pipeline.2": {"status": "covered", "annotation_indices": [1]}
    }
  },
  "research_purpose": [
    {
      "exact_quote": "direct evidence copied from the body",
      "context_before": "optional preceding searchable text",
      "context_after": "optional following searchable text",
      "summary_zh": "中文摘要",
      "source_page": 1,
      "source_section": "1 Introduction",
      "paper_model_refs": ["research_objective"],
      "semantic_role": "objective_evidence"
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

These labels are selected from the completed Paper Model, never from a word
match. Use `research_purpose` for the research object, concrete objective,
question, hypothesis, or directly objective-defining contribution. Use
`research_gap` for a verified limitation or missing capability that motivates
the paper. Use `research_method` for the data/input, preprocessing, model or
theory component, substantive workflow stage, experimental design, or
validation procedure that lets a future reader reconstruct how the study was
conducted. Use `research_result` for specific findings, comparisons,
quantitative outcomes, supported conclusions, or meaningful limitations.

Reject generic rhetorical signposts when a more specific body passage exists:
“we propose a novel method” is weaker than the actual workflow, and “the
results show that the method works” is weaker than the reported metric or
comparison. Each retained passage must still have one or more resolvable
`paper_model_refs`, a functional `semantic_role`, and an exact quote that can
be located in the PDF. Coverage is necessary but not sufficient: the Chinese
comment must also explain the evidence's role in the paper's research logic
without adding unsupported claims.

## Select the engine command

For one paper, first extract and inspect the complete paper, then run the
single-attachment orchestrator:

```text
node src/extract.mjs --attachment-key KEY --out ignored-full-text.json
node src/annotate.mjs --plan analysis.json --apply
```

Add `--note` only when the user asks for a structured child note. Omit
`--apply` for a read-only preview. The apply path rechecks page coverage,
understanding, required-node annotation coverage, and exact locations before
calling the native writer.

For a collection, analyze each paper independently with full coverage, then
use the resume/audit runner:

```text
node src/run.mjs --collection "Collection name or key" --plan analysis-set.json --apply --audit .codex/audit.jsonl
```

Add `--note` for child notes and `--force` to retry completed item/attachment
pairs. Audit records include page/understanding/annotation-coverage counts,
planned/created/already-existing annotation counts, diagnostics, and
skipped-ambiguous counts; they do not include full text.
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
