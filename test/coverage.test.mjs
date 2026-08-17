import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCoverage, getEvidenceDistribution } from "../src/coverage.mjs";

const extraction = {
  totalPages: 3,
  pagesWithUsableText: 3,
  pages: [
    { pageIndex: 0, text: "Abstract" },
    { pageIndex: 1, text: "Introduction and method" },
    { pageIndex: 2, text: "Results" },
  ],
};

function planWithCoverage(annotations, overrides = {}) {
  return {
    annotations,
    coverage: {
      totalPages: 3,
      pagesWithUsableText: 3,
      pagesInspected: 3,
      coverageComplete: true,
      sectionsSeen: ["Abstract", "Introduction", "Results"],
      abstractPageIndices: [0],
      ...overrides,
    },
  };
}

test("coverage gate rejects an Abstract-only analysis after an incomplete pass", () => {
  const plan = planWithCoverage([{
    category: "research_purpose",
    exactQuote: "Abstract evidence",
    summaryZh: "摘要证据",
    sourcePage: 0,
    sourceSection: "Abstract",
  }], {
    pagesInspected: 1,
    coverageComplete: false,
  });
  const result = evaluateCoverage({ extraction, plan });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("not_all_usable_pages_inspected"));
  assert.ok(result.reasons.includes("coverage_incomplete"));
  assert.ok(result.reasons.includes("abstract_only_evidence"));
});

test("body evidence clears the concentration guard and preserves category distribution", () => {
  const plan = planWithCoverage([
    {
      category: "research_purpose",
      exactQuote: "Introduction objective",
      summaryZh: "研究目的",
      sourcePage: 1,
      sourceSection: "1 Introduction",
    },
    {
      category: "research_result",
      exactQuote: "Results evidence",
      summaryZh: "研究结果",
      sourcePage: 2,
      sourceSection: "Results",
    },
  ]);
  const result = evaluateCoverage({ extraction, plan });
  assert.equal(result.ok, true);
  assert.equal(result.distribution.bodyEvidenceCount, 2);
  assert.deepEqual(result.distribution.byCategory, {
    research_purpose: 1,
    research_result: 1,
  });
  assert.deepEqual(result.coverage.evidenceByPage, { "1": 1, "2": 1 });
});

test("coverage counts inspected page arrays without treating duplicates as progress", () => {
  const plan = planWithCoverage([{
    category: "research_method",
    exactQuote: "Method evidence",
    summaryZh: "方法",
    sourcePage: 1,
    sourceSection: "Methods",
  }], { pagesInspected: [0, 0, 1] });
  const result = evaluateCoverage({ extraction, plan });
  assert.equal(result.ok, false);
  assert.equal(result.coverage.pagesInspected, 2);
  assert.ok(result.reasons.includes("not_all_usable_pages_inspected"));
});

test("best-effort section metadata may be absent when the source page is verified", () => {
  const plan = planWithCoverage([{
    category: "research_result",
    exactQuote: "Body result",
    summaryZh: "结果",
    sourcePage: 2,
    sourceSection: null,
  }]);
  const result = evaluateCoverage({ extraction, plan });
  assert.equal(result.ok, true);
  assert.equal(result.distribution.bodyEvidenceCount, 1);
});

test("distribution keeps Abstract and body counts explicit", () => {
  const distribution = getEvidenceDistribution({
    annotations: [
      { category: "research_gap", sourcePage: 0, sourceSection: "Abstract" },
      { category: "research_gap", sourcePage: 1, sourceSection: "Related Work" },
    ],
  });
  assert.equal(distribution.abstractEvidenceCount, 1);
  assert.equal(distribution.bodyEvidenceCount, 1);
});
