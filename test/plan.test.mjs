import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteHTML, normalizeAnalysisPlan } from "../src/annotate.mjs";

test("public four-category analysis schema normalizes to the internal plan", () => {
  const plan = normalizeAnalysisPlan({
    attachmentKey: "ATTACHMENT",
    research_purpose: [{
      exact_quote: "A direct quote",
      context_before: "before",
      context_after: "after",
      summary_zh: "中文摘要",
    }],
    research_gap: [],
    research_method: [],
    research_result: [],
  });
  assert.deepEqual(plan.annotations, [{
    category: "research_purpose",
    exactQuote: "A direct quote",
    contextBefore: "before",
    contextAfter: "after",
    summaryZh: "中文摘要",
  }]);
});

test("empty categories remain empty and note output keeps all four headings", () => {
  const html = buildNoteHTML({
    research_purpose: [],
    research_gap: [],
    research_method: [],
    research_result: [],
  });
  for (const heading of ["研究目的", "研究缺口", "研究方法", "研究结果"]) {
    assert.ok(html.includes(`<h2>${heading}</h2>`));
  }
});

test("multiple evidence units in one category preserve source metadata", () => {
  const plan = normalizeAnalysisPlan({
    attachmentKey: "ATTACHMENT",
    research_purpose: [
      {
        exact_quote: "Purpose one",
        summary_zh: "一",
        source_page: 1,
        source_section: "1 Introduction",
      },
      {
        exact_quote: "Purpose two",
        summary_zh: "二",
        source_page: 2,
        source_section: "2 Method",
      },
    ],
    research_gap: [],
    research_method: [],
    research_result: [],
  });
  assert.equal(plan.annotations.length, 2);
  assert.deepEqual(
    plan.annotations.map(annotation => [annotation.exactQuote, annotation.sourcePage, annotation.sourceSection]),
    [
      ["Purpose one", 1, "1 Introduction"],
      ["Purpose two", 2, "2 Method"],
    ],
  );
});
