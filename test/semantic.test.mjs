import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteHTML, createChildNote } from "../src/annotate.mjs";
import {
  evaluateUnderstanding,
  validateAnnotationSemanticRole,
  validatePaperModel,
} from "../src/semantic.mjs";

function ref(page, exactQuote, section = "Methods") {
  return { page, exact_quote: exactQuote, section };
}

function completeModel({ methodSteps = 4, withCrossSectionRelation = true } = {}) {
  const pipeline = Array.from({ length: methodSteps }, (_, index) => ({
    step: index + 1,
    name: ["Input preparation", "Segmentation", "Vectorization", "Classification"][index] ?? `Stage ${index + 1}`,
    input: `stage ${index} output`,
    operation: `operation ${index + 1}`,
    output: `stage ${index + 1} output`,
    why_needed: `reason for stage ${index + 1}`,
    annotation_priority: "required",
    depends_on: index ? [index] : [],
    evidence_refs: [ref(index + 1, `Stage ${index + 1} evidence`)],
  }));
  return {
    research_type: "methodological",
    research_context: {
    summary: "The paper addresses automated road mapping from historical maps.",
      annotation_priority: "background",
      evidence_refs: [ref(0, "Context evidence", "Introduction")],
    },
    core_problem: {
      summary: "Historical maps lack consistent machine-readable road data.",
      annotation_priority: "required",
      evidence_refs: [ref(0, "Problem evidence", "Introduction")],
    },
    existing_approaches: [{
      approach: "Existing studies use manually prepared training data.",
    limitation: "Manual preparation is costly and hard to scale.",
      annotation_priority: "useful",
      evidence_refs: [ref(0, "Existing approach evidence", "Related Work")],
    }],
    research_gap: [{
    gap: "A scalable way to create training data is missing.",
    why_it_matters: "Without it, the proposed extraction model cannot be trained broadly.",
      annotation_priority: "required",
      evidence_refs: [ref(1, "Gap evidence", "Introduction")],
    }],
    research_objective: {
      summary: "The study develops a reproducible workflow for road extraction.",
      annotation_priority: "required",
      evidence_refs: [ref(1, "Objective evidence", "Introduction")],
    },
    research_questions_or_hypotheses: [],
    data: [{
      name: "Historical map tiles",
      source: "Historical map archive",
      role: "Input for model training and evaluation",
      important_properties: "Raster maps with reconstructed symbols",
      annotation_priority: "required",
      evidence_refs: [ref(2, "Data evidence", "Data")],
    }],
    method_pipeline: pipeline,
    experimental_design: {
      summary: "The workflow is evaluated on held-out map regions.",
      annotation_priority: "required",
      evidence_refs: [ref(4, "Experiment evidence", "Experiments")],
    },
    evaluation: {
      summary: "Performance is compared with a baseline using completeness and correctness.",
      metrics: ["completeness", "correctness"],
      baselines_or_comparisons: ["baseline"],
      validation_strategy: "held-out regions",
      annotation_priority: "required",
      evidence_refs: [ref(5, "Evaluation evidence", "Results")],
    },
    key_results: [{
      result: "The proposed workflow improves completeness over the baseline.",
      what_it_demonstrates: "The training-data reconstruction supports the extraction objective.",
      annotation_priority: "required",
      evidence_refs: [ref(6, "Specific quantitative result", "Results")],
    }],
    contributions: [{
      contribution: "A reproducible data-generation and road-extraction workflow.",
      annotation_priority: "required",
      evidence_refs: [ref(7, "Contribution evidence", "Conclusion")],
    }],
    limitations: [{
      limitation: "Performance depends on map quality and symbol visibility.",
      annotation_priority: "required",
      evidence_refs: [ref(8, "Limitation evidence", "Discussion")],
    }],
    end_to_end_story: {
      summary: "Historical map input is prepared, segmented, vectorized, classified, and evaluated against held-out regions.",
      annotation_priority: "useful",
      evidence_refs: [ref(2, "Workflow evidence", "Methods")],
    },
    cross_section_relations: withCrossSectionRelation ? [{
      relation: "The introduction's data-generation gap motivates the multi-stage method, whose result is tested in the evaluation.",
      from: "gap X",
      through: "design Y",
      to: "result Z",
      annotation_priority: "useful",
      evidence_refs: [ref(1, "Gap evidence", "Introduction"), ref(5, "Evaluation evidence", "Results")],
    }] : [],
  };
}

function completeUnderstanding(overrides = {}) {
  return {
    paperModelBuilt: true,
    core_problem: true,
    research_gap: true,
    objective: true,
    data_or_input: true,
    workflow_reconstructed: true,
    evaluation_understood: true,
    results_connected_to_claims: true,
    contribution_identified: true,
    limitations_identified: true,
    understandingComplete: true,
    ...overrides,
  };
}

function observations({ sections = 2, methodCandidates = 4 } = {}) {
  return Array.from({ length: sections }, (_, sectionIndex) => ({
    section: ["Introduction", "Methods", "Results", "Discussion"][sectionIndex] ?? `Section ${sectionIndex + 1}`,
    page_indices: [sectionIndex],
    observations: Array.from({ length: sectionIndex === 1 ? methodCandidates : 1 }, (_, index) => ({
      type: sectionIndex === 1 ? "method_step_candidate" : "gap_candidate",
      summary: `${sectionIndex === 1 ? "Method" : "Gap"} observation ${index + 1}`,
      exact_quote: `${sectionIndex === 1 ? "Stage" : "Gap"} ${index + 1} evidence`,
      page: sectionIndex + index,
    })),
  }));
}

test("keyword-only purpose language cannot satisfy the semantic-role requirement", () => {
  const result = validateAnnotationSemanticRole({
    category: "research_purpose",
    exactText: "The purpose of normalization is to reduce noise.",
  }, completeModel(), 0);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("annotations[0].paper_model_ref_missing"));
});

test("a previous-work method sentence cannot become the current method without a model reference", () => {
  const result = validateAnnotationSemanticRole({
    category: "research_method",
    exactText: "This method has been widely used in previous studies.",
  }, completeModel(), 0);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("annotations[0].paper_model_ref_missing"));
});

test("a substantive synthetic method pipeline is reconstructed before annotation", () => {
  const model = completeModel();
  const result = evaluateUnderstanding({
    paperModel: model,
    understanding: completeUnderstanding(),
    sectionObservations: observations(),
    coverageComplete: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.methodSteps, 4);
  assert.equal(result.methodCandidateCount, 4);
  assert.equal(result.understandingComplete, true);
});

test("cross-section observations are synthesized into one gap-to-design-to-result relation", () => {
  const model = completeModel({ withCrossSectionRelation: true });
  const result = evaluateUnderstanding({
    paperModel: model,
    understanding: completeUnderstanding(),
    sectionObservations: observations({ sections: 3 }),
    coverageComplete: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.crossSectionRelationCount, 1);

  const missing = evaluateUnderstanding({
    paperModel: completeModel({ withCrossSectionRelation: false }),
    understanding: completeUnderstanding(),
    sectionObservations: observations({ sections: 3 }),
    coverageComplete: true,
  });
  assert.equal(missing.ok, false);
  assert.ok(missing.reasons.includes("cross_section_synthesis_missing"));
});

test("specific result evidence can be tied to a key result while a generic signpost cannot", () => {
  const model = completeModel();
  const specific = validateAnnotationSemanticRole({
    category: "research_result",
    exactText: "Specific quantitative result",
    paperModelRef: "key_results.0",
    semanticRole: "specific_result_supporting_objective",
  }, model, 0);
  assert.equal(specific.ok, true);

  const generic = validateAnnotationSemanticRole({
    category: "research_result",
    exactText: "The results show that our method performs well.",
  }, model, 1);
  assert.equal(generic.ok, false);
});

test("complete page coverage does not authorize a write when understanding is incomplete", () => {
  const result = evaluateUnderstanding({
    paperModel: completeModel(),
    understanding: completeUnderstanding({
      workflow_reconstructed: false,
      understandingComplete: false,
    }),
    sectionObservations: observations(),
    coverageComplete: true,
  });
  assert.equal(result.coverageComplete, true);
  assert.equal(result.understandingComplete, false);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("understanding_workflow_reconstructed_incomplete"));
});

test("model claims require original evidence references", () => {
  const model = completeModel();
  delete model.core_problem.evidence_refs;
  const result = validatePaperModel(model);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("core_problem.evidence_refs_missing"));
});

test("a shallow one-step model is rejected when section observations identify multiple method stages", () => {
  const result = evaluateUnderstanding({
    paperModel: completeModel({ methodSteps: 1 }),
    understanding: completeUnderstanding(),
    sectionObservations: observations({ methodCandidates: 3 }),
    coverageComplete: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("method_pipeline_shallow"));
});

test("child-note rendering uses the Paper Model workflow instead of only four category lists", () => {
  const html = buildNoteHTML({
    paper_model: completeModel(),
    research_purpose: [],
    research_gap: [],
    research_method: [],
    research_result: [],
  });
  assert.ok(html.includes("AI 文献拆解"));
  assert.ok(html.includes("完整研究流程"));
  assert.ok(html.includes("Segmentation"));
  assert.ok(html.includes("关键原文证据"));
});

test("direct child-note creation cannot bypass the coverage gate", async () => {
  await assert.rejects(
    () => createChildNote({
      attachmentKey: "ATTACHMENT",
      coverage: { coverageComplete: false },
      paper_model: completeModel(),
      understanding: completeUnderstanding(),
      research_purpose: [{
        exact_quote: "Objective evidence",
        summary_zh: "目标",
        paper_model_ref: "research_objective",
        semantic_role: "objective_evidence",
      }],
      research_gap: [],
      research_method: [],
      research_result: [],
    }),
    /coverage and understanding gates failed/,
  );
});

test("child-note creation cannot bypass annotation information coverage", async () => {
  await assert.rejects(
    () => createChildNote({
      attachmentKey: "ATTACHMENT",
      coverage: { coverageComplete: true },
      paper_model: completeModel(),
      understanding: completeUnderstanding(),
      research_purpose: [{
        exact_quote: "Objective evidence",
        summary_zh: "目标",
        paper_model_ref: "research_objective",
        semantic_role: "objective_evidence",
      }],
      research_gap: [],
      research_method: [],
      research_result: [],
    }),
    /coverage and understanding gates failed/,
  );
});
