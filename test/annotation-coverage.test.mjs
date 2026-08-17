import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateAnnotationCandidates,
  evaluateAnnotationCoverage,
  selectMinimumSufficientEvidence,
} from "../src/annotation-coverage.mjs";

function claim(summary, annotation_priority = "required") {
  return { summary, annotation_priority };
}

function coverageModel({ methodCount = 0, resultCount = 0, complex = false } = {}) {
  return {
    research_context: claim("Broad domain context", "background"),
    core_problem: claim("The central problem", "required"),
    research_gap: [claim("The primary gap", "required")],
    research_objective: claim("The concrete objective", "required"),
    data: [claim("The study input", "required")],
    method_pipeline: Array.from({ length: methodCount }, (_, index) => ({
      step: index + 1,
      name: `Stage ${String.fromCharCode(65 + index)}`,
      input: `Input ${index}`,
      operation: `Operation ${index}`,
      output: `Output ${index}`,
      why_needed: `Reason ${index}`,
      annotation_priority: "required",
    })),
    experimental_design: complex ? claim("The experiment", "required") : claim("The experiment", "useful"),
    evaluation: claim("The evaluation", complex ? "required" : "useful"),
    key_results: Array.from({ length: resultCount }, (_, index) => claim(`Finding ${index}`, "required")),
    contributions: [claim("The contribution", complex ? "required" : "useful")],
    limitations: complex ? [claim("The limitation", "required")] : [claim("The limitation", "background")],
    end_to_end_story: claim("The workflow story", "useful"),
  };
}

function annotation(exactQuote, refs, extra = {}) {
  return {
    category: "research_method",
    exactQuote,
    summaryZh: "该证据保留了研究逻辑中的关键环节。",
    paperModelRefs: refs,
    semanticRole: "required_evidence",
    ...extra,
  };
}

test("A: missing required method stages fails annotation coverage", () => {
  const result = evaluateAnnotationCoverage({
    paperModel: coverageModel({ methodCount: 5 }),
    annotations: [
      annotation("Stage A and B", ["method_pipeline.0", "method_pipeline.1"]),
    ],
  });
  assert.equal(result.annotationCoverageComplete, false);
  assert.ok(result.reasons.includes("required_nodes_uncovered"));
  assert.ok(result.diagnostics.includes("insufficient_method_annotation_coverage"));
  for (const ref of ["method_pipeline.2", "method_pipeline.3", "method_pipeline.4"]) {
    assert.ok(result.reconstructability.missingNodeRefs.includes(ref));
  }
});

test("B: one continuous passage can cover two related method nodes", () => {
  const result = evaluateAnnotationCoverage({
    paperModel: coverageModel({ methodCount: 4 }),
    annotations: [
      annotation("Stages C and D in one paragraph", ["method_pipeline.2", "method_pipeline.3"]),
    ],
    annotationCoverage: {
      nodes: {
        "method_pipeline.2": { status: "covered", annotation_indices: [0] },
        "method_pipeline.3": { status: "covered", annotation_indices: [0] },
      },
    },
  });
  assert.equal(result.nodeCoverage["method_pipeline.2"].annotationIndices[0], 0);
  assert.equal(result.nodeCoverage["method_pipeline.3"].annotationIndices[0], 0);
  assert.equal(result.annotationCoverageComplete, false);
  assert.ok(result.reconstructability.missingNodeRefs.includes("method_pipeline.0"));
  assert.ok(result.reconstructability.missingNodeRefs.includes("method_pipeline.1"));
});

test("C: materially distinct required results cannot collapse into one generic result", () => {
  const result = evaluateAnnotationCoverage({
    paperModel: coverageModel({ resultCount: 3 }),
    annotations: [annotation("The results are effective", ["key_results.0"])],
  });
  assert.equal(result.annotationCoverageComplete, false);
  assert.ok(result.diagnostics.includes("insufficient_result_annotation_coverage"));
  assert.deepEqual(result.reconstructability.missingNodeRefs.filter(ref => ref.startsWith("key_results.")), [
    "key_results.1",
    "key_results.2",
  ]);
});

test("D: a more specific Results passage wins over an Abstract duplicate", () => {
  const candidates = [
    annotation("The method is effective overall.", ["key_results.0"], {
      sourceSection: "Abstract",
      semantic_duplicate_key: "finding-0",
      specificity: 1,
    }),
    annotation("The method reaches 0.91 F1 on the held-out test set.", ["key_results.0"], {
      sourceSection: "Results",
      semantic_duplicate_key: "finding-0",
      specificity: 3,
    }),
  ];
  const deduplicated = deduplicateAnnotationCandidates(candidates, { paperModel: coverageModel({ resultCount: 1 }) });
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].sourceSection, "Results");
});

test("E: background nodes do not force annotations; useful evidence is opt-in", () => {
  const model = coverageModel({ resultCount: 0 });
  const requiredOnly = [annotation("The central problem", ["core_problem"])];
  const result = evaluateAnnotationCoverage({ paperModel: model, annotations: requiredOnly });
  assert.equal(result.annotationCoverageComplete, false);
  assert.ok(result.reconstructability.missingNodeRefs.includes("research_gap.0"));
  assert.ok(!result.reconstructability.missingNodeRefs.includes("research_context"));

  const candidates = [
    annotation("The central problem", ["core_problem"]),
    annotation("Useful parameter detail", ["end_to_end_story"], {
      annotation_priority: "useful",
      materially_improves_reconstruction: true,
    }),
  ];
  const selected = selectMinimumSufficientEvidence({ paperModel: model, candidates });
  assert.equal(selected.annotations.length, 2);
  assert.equal(selected.annotations[1].exactQuote, "Useful parameter detail");
});

test("F: complex five-annotation compression reports loss and overcompression", () => {
  const model = coverageModel({ methodCount: 4, resultCount: 3, complex: true });
  const annotations = [
    annotation("Problem", ["core_problem"]),
    annotation("Gap", ["research_gap.0"]),
    annotation("Objective", ["research_objective"]),
    annotation("Method A", ["method_pipeline.0"]),
    annotation("Result 0", ["key_results.0"]),
  ];
  const result = evaluateAnnotationCoverage({ paperModel: model, annotations });
  assert.equal(result.plannedAnnotations, 5);
  assert.equal(result.annotationCoverageComplete, false);
  assert.ok(result.diagnostics.includes("possible_overcompression"));
  assert.ok(result.diagnostics.includes("insufficient_method_annotation_coverage"));
  assert.ok(result.diagnostics.includes("insufficient_result_annotation_coverage"));
});

test("G: a genuinely simple paper can pass with five or fewer annotations", () => {
  const model = coverageModel({ resultCount: 1 });
  const annotations = [
    annotation("Problem and objective", ["core_problem", "research_objective"]),
    annotation("Gap", ["research_gap.0"]),
    annotation("Input", ["data.0"]),
    annotation("Result", ["key_results.0"]),
  ];
  const result = evaluateAnnotationCoverage({ paperModel: model, annotations });
  assert.equal(result.annotationCoverageComplete, true);
  assert.equal(result.plannedAnnotations, 4);
  assert.deepEqual(result.diagnostics, []);
});

test("an explicit no-annotation-worthy exception is visible and can satisfy the gate", () => {
  const model = coverageModel({ resultCount: 1 });
  model.evaluation.annotation_priority = "required";
  const result = evaluateAnnotationCoverage({
    paperModel: model,
    annotations: [
      annotation("Problem", ["core_problem"]),
      annotation("Gap", ["research_gap.0"]),
      annotation("Objective", ["research_objective"]),
      annotation("Input", ["data.0"]),
      annotation("Result", ["key_results.0"]),
    ],
    annotationCoverage: {
      nodes: {
        evaluation: {
          status: "no_annotation_worthy_evidence",
          reason: "The paper reports no separate evaluation passage beyond the cited method paragraph.",
        },
      },
    },
  });
  assert.equal(result.annotationCoverageComplete, true);
  assert.equal(result.nodeCoverage.evaluation.status, "no_annotation_worthy_evidence");
});
