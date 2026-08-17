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

test("decomposition artifact can keep semantic model beside a nested annotation plan", () => {
  const paperModel = { core_problem: { summary: "A problem", evidence_refs: [] } };
  const plan = normalizeAnalysisPlan({
    attachmentKey: "ATTACHMENT",
    paper_model: paperModel,
    understanding: { understandingComplete: false },
    annotation_plan: {
      research_purpose: [{
        exact_quote: "Objective evidence",
        summary_zh: "目标",
        paper_model_ref: "core_problem",
        semantic_role: "objective_evidence",
      }],
      research_gap: [],
      research_method: [],
      research_result: [],
    },
  });
  assert.equal(plan.annotations.length, 1);
  assert.equal(plan.paperModel.core_problem.summary, "A problem");
  assert.equal(plan.annotations[0].paperModelRef, "core_problem");
  assert.equal(plan.annotations[0].semanticRole, "objective_evidence");
});

test("normalized plans preserve multi-node coverage references and gate metadata", () => {
  const plan = normalizeAnalysisPlan({
    attachmentKey: "ATTACHMENT",
    paper_model: {
      method_pipeline: [{
        step: 1,
        name: "Stage",
        input: "input",
        operation: "operation",
        output: "output",
        why_needed: "reason",
        annotation_priority: "required",
      }],
    },
    annotation_coverage: {
      nodes: {
        "method_pipeline.0": { status: "covered", annotation_indices: [0] },
      },
    },
    annotations: [{
      category: "research_method",
      exact_quote: "One continuous passage",
      summary_zh: "一个连续段落覆盖两个相关阶段。",
      paper_model_refs: ["method_pipeline.0", "method_pipeline.step_1"],
      semantic_role: "major_method_stage",
    }],
  });
  assert.deepEqual(plan.annotations[0].paperModelRefs, ["method_pipeline.0", "method_pipeline.step_1"]);
  assert.equal(plan.annotations[0].paperModelRef, "method_pipeline.0");
  assert.equal(plan.annotationCoverage.nodes["method_pipeline.0"].status, "covered");
});
