/**
 * Structured semantic analysis for a complete research paper.
 *
 * This module deliberately does not infer research meaning from keywords. The
 * calling model supplies a Paper Model and section observations; this module
 * checks that the synthesis is structurally complete, evidence-grounded, and
 * safe to use as the source of an annotation plan.
 */

export const PAPER_MODEL_SCHEMA_VERSION = 1;

export const ANNOTATION_PRIORITIES = Object.freeze([
  "required",
  "useful",
  "background",
]);

const ANNOTATION_PRIORITY_SET = new Set(ANNOTATION_PRIORITIES);

export const COMMON_UNDERSTANDING_FIELDS = Object.freeze([
  "core_problem",
  "research_gap",
  "objective",
  "workflow_reconstructed",
  "evaluation_understood",
  "results_connected_to_claims",
  "contribution_identified",
  "limitations_identified",
]);

const DATA_RESEARCH_TYPES = new Set([
  "empirical",
  "computational",
  "methodological",
  "remote_sensing",
  "experimental",
]);

const PIPELINE_RESEARCH_TYPES = new Set([
  ...DATA_RESEARCH_TYPES,
  "review",
]);

const CLAIM_FIELDS = Object.freeze([
  "research_context",
  "core_problem",
  "research_objective",
  "experimental_design",
  "evaluation",
  "end_to_end_story",
]);

const ARRAY_CLAIM_FIELDS = Object.freeze([
  "existing_approaches",
  "research_gap",
  "research_questions_or_hypotheses",
  "data",
  "method_pipeline",
  "key_results",
  "contributions",
  "limitations",
  "cross_section_relations",
]);

const TEXT_FIELDS = Object.freeze([
  "summary",
  "approach",
  "limitation",
  "gap",
  "why_it_matters",
  "name",
  "source",
  "role",
  "important_properties",
  "input",
  "operation",
  "output",
  "why_needed",
  "result",
  "what_it_demonstrates",
  "contribution",
  "relation",
  "from",
  "through",
  "to",
  "validation_strategy",
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalField(value, snakeCase, camelCase) {
  return value?.[snakeCase] ?? value?.[camelCase];
}

export function normalizeAnnotationPriority(value) {
  if (typeof value !== "string") return value ?? null;
  return value.trim().toLowerCase();
}

export function annotationPriority(value) {
  const raw = canonicalField(value, "annotation_priority", "annotationPriority");
  const normalized = normalizeAnnotationPriority(raw);
  return ANNOTATION_PRIORITY_SET.has(normalized) ? normalized : null;
}

function rawAnnotationPriority(value) {
  return canonicalField(value, "annotation_priority", "annotationPriority");
}

function normalizeEvidenceRefs(value) {
  if (!isObject(value)) return value;
  const refs = canonicalField(value, "evidence_refs", "evidenceRefs");
  return {
    ...value,
    ...(Array.isArray(refs) ? { evidence_refs: refs } : {}),
  };
}

function normalizeClaim(value) {
  const claim = typeof value === "string"
    ? { summary: value }
    : isObject(value) ? normalizeEvidenceRefs(value) : value;
  if (!isObject(claim)) return claim;
  const priority = rawAnnotationPriority(claim);
  return priority === undefined
    ? claim
    : { ...claim, annotation_priority: normalizeAnnotationPriority(priority) };
}

function normalizeClaimArray(value) {
  return Array.isArray(value) ? value.map(normalizeClaim) : value;
}

function normalizeStory(value) {
  if (typeof value === "string") return { summary: value, evidence_refs: [] };
  return normalizeClaim(value);
}

/**
 * Normalize the public snake_case Paper Model while accepting camelCase
 * aliases for programmatic callers. No semantic conclusions are invented.
 */
export function normalizePaperModel(input) {
  if (!isObject(input)) return null;
  const model = { ...input };
  const aliases = [
    ["research_context", "researchContext"],
    ["core_problem", "coreProblem"],
    ["existing_approaches", "existingApproaches"],
    ["research_gap", "researchGap"],
    ["research_objective", "researchObjective"],
    ["research_questions_or_hypotheses", "researchQuestionsOrHypotheses"],
    ["method_pipeline", "methodPipeline"],
    ["experimental_design", "experimentalDesign"],
    ["key_results", "keyResults"],
    ["cross_section_relations", "crossSectionRelations"],
    ["end_to_end_story", "endToEndStory"],
  ];
  for (const [snakeCase, camelCase] of aliases) {
    if (model[snakeCase] === undefined && model[camelCase] !== undefined) {
      model[snakeCase] = model[camelCase];
    }
  }

  for (const field of CLAIM_FIELDS) {
    if (model[field] !== undefined) model[field] = normalizeClaim(model[field]);
  }
  for (const field of ARRAY_CLAIM_FIELDS) {
    if (model[field] !== undefined) model[field] = normalizeClaimArray(model[field]);
  }
  if (model.end_to_end_story !== undefined) {
    model.end_to_end_story = normalizeStory(model.end_to_end_story);
  }

  const researchType = model.research_type ?? model.researchType ?? model.paper_type ?? model.paperType;
  if (typeof researchType === "string" && researchType.trim()) {
    model.research_type = researchType.trim().toLowerCase();
  }
  model.schema_version ??= PAPER_MODEL_SCHEMA_VERSION;
  return model;
}

function normalizeObservation(observation) {
  if (!isObject(observation)) return observation;
  const page = observation.page ?? observation.source_page ?? observation.sourcePage;
  return {
    ...observation,
    ...(Number.isInteger(page) ? { page } : {}),
    ...(observation.exact_quote === undefined && observation.exactQuote !== undefined
      ? { exact_quote: observation.exactQuote }
      : {}),
    ...(observation.source_section === undefined && observation.sourceSection !== undefined
      ? { source_section: observation.sourceSection }
      : {}),
  };
}

/**
 * Normalize temporary section observations. A section batch is the preferred
 * form; a flat observation list is also accepted for test and tooling use.
 */
export function normalizeSectionObservations(input) {
  const raw = input?.section_observations
    ?? input?.sectionObservations
    ?? input?.observations
    ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((batch, index) => {
    if (!isObject(batch)) {
      return { section: `section-${index + 1}`, observations: [] };
    }
    const observations = Array.isArray(batch.observations)
      ? batch.observations.map(normalizeObservation)
      : [normalizeObservation(batch)];
    const pageIndices = batch.page_indices
      ?? batch.pageIndices
      ?? observations.map(item => item?.page).filter(Number.isInteger);
    return {
      ...batch,
      section: batch.section ?? batch.source_section ?? batch.sourceSection ?? `section-${index + 1}`,
      page_indices: [...new Set((Array.isArray(pageIndices) ? pageIndices : []).filter(Number.isInteger))],
      observations,
    };
  });
}

export function flattenSectionObservations(input) {
  return normalizeSectionObservations(input).flatMap(batch => batch.observations.map(observation => ({
    ...observation,
    section: observation.source_section ?? observation.sourceSection ?? batch.section,
  })));
}

function evidenceRefs(value) {
  const refs = canonicalField(value, "evidence_refs", "evidenceRefs");
  return Array.isArray(refs) ? refs : [];
}

function claimText(value) {
  if (nonEmptyText(value)) return value.trim();
  if (!isObject(value)) return "";
  for (const key of TEXT_FIELDS) {
    if (nonEmptyText(value[key])) return value[key].trim();
  }
  return "";
}

function isNotApplicable(value) {
  return isObject(value) && (value.not_applicable === true || value.notApplicable === true);
}

function claimEntries(model) {
  const entries = [];
  for (const field of CLAIM_FIELDS) {
    if (model[field] !== undefined && model[field] !== null) {
      entries.push({ path: field, value: model[field] });
    }
  }
  for (const field of ARRAY_CLAIM_FIELDS) {
    const values = model[field];
    if (!Array.isArray(values)) continue;
    values.forEach((value, index) => entries.push({ path: `${field}.${index}`, value }));
  }
  return entries.filter(entry => claimText(entry.value) || isNotApplicable(entry.value));
}

/**
 * Enumerate substantive Paper Model nodes using stable public references.
 * Array members are addressed by field.index; method_pipeline.step_N aliases
 * are resolved separately for compatibility with earlier plans.
 */
export function enumeratePaperModelNodes(input) {
  const model = normalizePaperModel(input);
  if (!model) return [];
  const nodes = [];
  const add = (path, field, value, index = null) => {
    if (!(claimText(value) || isNotApplicable(value))) return;
    const rawPriority = rawAnnotationPriority(value);
    nodes.push({
      path,
      field,
      index,
      value,
      annotation_priority: annotationPriority(value),
      raw_annotation_priority: rawPriority ?? null,
      evidence_refs: evidenceRefs(value),
    });
  };

  for (const field of CLAIM_FIELDS) {
    if (model[field] !== undefined && model[field] !== null) add(field, field, model[field]);
  }
  for (const field of ARRAY_CLAIM_FIELDS) {
    if (!Array.isArray(model[field])) continue;
    model[field].forEach((value, index) => add(`${field}.${index}`, field, value, index));
  }
  return nodes;
}

function normalizeEvidenceRef(ref) {
  if (!isObject(ref)) return null;
  const page = ref.page ?? ref.page_index ?? ref.pageIndex ?? ref.source_page ?? ref.sourcePage;
  const exactQuote = ref.exact_quote ?? ref.exactQuote ?? ref.quote;
  const section = ref.section ?? ref.source_section ?? ref.sourceSection;
  return {
    ...ref,
    ...(Number.isInteger(page) ? { page } : {}),
    ...(nonEmptyText(exactQuote) ? { exact_quote: exactQuote } : {}),
    ...(nonEmptyText(section) ? { section } : {}),
  };
}

function validateEvidenceRefs(entries, extraction) {
  const issues = [];
  let count = 0;
  for (const entry of entries) {
    if (isNotApplicable(entry.value)) continue;
    const refs = evidenceRefs(entry.value).map(normalizeEvidenceRef).filter(Boolean);
    if (!refs.length) {
      issues.push(`${entry.path}.evidence_refs_missing`);
      continue;
    }
    refs.forEach((ref, index) => {
      count += 1;
      if (!Number.isInteger(ref.page) || ref.page < 0) {
        issues.push(`${entry.path}.evidence_refs[${index}].page_invalid`);
        return;
      }
      if (!nonEmptyText(ref.exact_quote)) {
        issues.push(`${entry.path}.evidence_refs[${index}].exact_quote_missing`);
        return;
      }
      if (!extraction) return;
      const page = extraction.pages?.find(candidate => candidate.pageIndex === ref.page);
      if (!page) {
        issues.push(`${entry.path}.evidence_refs[${index}].page_not_in_extraction`);
      } else if (!page.text.includes(ref.exact_quote)) {
        issues.push(`${entry.path}.evidence_refs[${index}].quote_not_found`);
      }
    });
  }
  return { issues, count };
}

function requiredModelField(model, field) {
  const value = model[field];
  return claimText(value) || isNotApplicable(value);
}

function researchType(model) {
  return typeof model.research_type === "string" && model.research_type
    ? model.research_type
    : "methodological";
}

/**
 * Validate that the Paper Model is a grounded whole-paper synthesis rather
 * than a collection of category-compatible snippets.
 */
export function validatePaperModel(input, { extraction = null } = {}) {
  const model = normalizePaperModel(input);
  const issues = [];
  if (!model) return { ok: false, model: null, issues: ["paper_model_missing"], evidenceRefCount: 0, methodSteps: 0 };

  for (const field of ["research_context", "core_problem", "research_objective", "end_to_end_story"]) {
    if (!requiredModelField(model, field)) issues.push(`${field}_missing`);
  }

  for (const field of ["existing_approaches", "research_gap", "data", "method_pipeline", "key_results", "contributions", "limitations"]) {
    if (model[field] !== undefined && !Array.isArray(model[field])) {
      issues.push(`${field}_must_be_array`);
    }
  }

  const type = researchType(model);
  if (DATA_RESEARCH_TYPES.has(type) && (!Array.isArray(model.data) || model.data.length === 0)) {
    issues.push("data_missing_for_data_research");
  }
  if (PIPELINE_RESEARCH_TYPES.has(type) && (!Array.isArray(model.method_pipeline) || model.method_pipeline.length === 0)) {
    issues.push("method_pipeline_missing");
  }
  if (!Array.isArray(model.research_gap) || model.research_gap.length === 0) issues.push("research_gap_missing");
  if (!Array.isArray(model.key_results) || model.key_results.length === 0) issues.push("key_results_missing");
  if (!Array.isArray(model.contributions) || model.contributions.length === 0) issues.push("contributions_missing");

  const entries = claimEntries(model);
  const evidence = validateEvidenceRefs(entries, extraction);
  issues.push(...evidence.issues);

  const modelNodes = enumeratePaperModelNodes(model);
  for (const node of modelNodes) {
    if (node.raw_annotation_priority === null || node.raw_annotation_priority === undefined) {
      issues.push(`${node.path}.annotation_priority_missing`);
    } else if (!ANNOTATION_PRIORITY_SET.has(node.annotation_priority)) {
      issues.push(`${node.path}.annotation_priority_invalid`);
    }
  }

  const methodSteps = Array.isArray(model.method_pipeline)
    ? model.method_pipeline.filter(step => isObject(step) && claimText(step)).length
    : 0;
  if (Array.isArray(model.method_pipeline)) {
    model.method_pipeline.forEach((step, index) => {
      if (!isObject(step)) {
        issues.push(`method_pipeline.${index}_must_be_object`);
        return;
      }
      for (const field of ["name", "input", "operation", "output", "why_needed"]) {
        if (!nonEmptyText(step[field])) issues.push(`method_pipeline.${index}.${field}_missing`);
      }
    });
  }

  return {
    ok: issues.length === 0,
    model,
    issues: [...new Set(issues)],
    evidenceRefCount: evidence.count,
    methodSteps,
    modelNodes,
    requiredNodeCount: modelNodes.filter(node => node.annotation_priority === "required").length,
    researchType: type,
  };
}

function understandingFieldSatisfied(understanding, field) {
  const notApplicable = Array.isArray(understanding?.not_applicable)
    ? understanding.not_applicable
    : Array.isArray(understanding?.notApplicable) ? understanding.notApplicable : [];
  if (notApplicable.includes(field)) return { satisfied: true, notApplicable: true };
  return { satisfied: understanding?.[field] === true, notApplicable: false };
}

function requiredUnderstandingFields(model) {
  const fields = [...COMMON_UNDERSTANDING_FIELDS];
  const type = researchType(model ?? {});
  if (type === "theoretical") {
    fields.splice(fields.indexOf("workflow_reconstructed"), 1, "workflow_reconstructed");
    fields.splice(fields.indexOf("evaluation_understood"), 1, "evaluation_understood");
  } else if (type === "review") {
    fields.push("data_or_input");
  } else if (DATA_RESEARCH_TYPES.has(type)) {
    fields.push("data_or_input");
  }
  return [...new Set(fields)];
}

function candidateMethodSteps(observations) {
  return observations.filter(observation => [
    "method_step_candidate",
    "data_candidate",
    "preprocessing_candidate",
    "evaluation_candidate",
  ].includes(observation?.type));
}

function validateObservationEvidence(observations, extraction) {
  const issues = [];
  for (const [index, observation] of observations.entries()) {
    const exactQuote = observation?.exact_quote ?? observation?.exactQuote;
    if (!nonEmptyText(exactQuote)) continue;
    if (!Number.isInteger(observation?.page)) {
      issues.push(`section_observations.${index}.page_missing`);
      continue;
    }
    if (!extraction) continue;
    const page = extraction.pages?.find(candidate => candidate.pageIndex === observation.page);
    if (!page) {
      issues.push(`section_observations.${index}.page_not_in_extraction`);
    } else if (!page.text.includes(exactQuote)) {
      issues.push(`section_observations.${index}.quote_not_found`);
    }
  }
  return issues;
}

function sectionCount(observations) {
  return new Set(observations.map(observation => observation?.section).filter(nonEmptyText)).size;
}

function crossSectionRelations(model) {
  const relations = model?.cross_section_relations ?? model?.crossSectionRelations;
  return Array.isArray(relations) ? relations : [];
}

/**
 * Evaluate the second write gate. `coverageComplete` is intentionally passed
 * separately: complete page inspection is necessary, but it cannot make a
 * shallow or ungrounded synthesis acceptable.
 */
export function evaluateUnderstanding({
  paperModel,
  understanding,
  sectionObservations = [],
  extraction = null,
  coverageComplete = null,
} = {}) {
  const observations = flattenSectionObservations({ section_observations: sectionObservations });
  const modelCheck = validatePaperModel(paperModel, { extraction });
  const model = modelCheck.model;
  const reasons = [...modelCheck.issues];
  if (observations.length === 0) reasons.push("section_observations_missing");
  reasons.push(...validateObservationEvidence(observations, extraction));
  const fields = requiredUnderstandingFields(model ?? {});
  const fieldStatus = {};
  for (const field of fields) {
    const status = understandingFieldSatisfied(understanding, field);
    fieldStatus[field] = status;
    if (!status.satisfied) reasons.push(`understanding_${field}_incomplete`);
  }
  if (understanding?.paperModelBuilt === false) reasons.push("paper_model_declared_not_built");
  if (understanding?.understandingComplete !== true) reasons.push("understanding_not_declared_complete");

  const methodCandidates = candidateMethodSteps(observations);
  const steps = model?.method_pipeline?.length ?? 0;
  if (methodCandidates.length >= 2 && steps < 2) reasons.push("method_pipeline_shallow");
  if (steps > 0 && methodCandidates.length > 0) {
    const candidateNames = methodCandidates
      .map(item => item.summary ?? item.exact_quote ?? item.name)
      .filter(nonEmptyText);
    if (candidateNames.length >= 2 && steps < 2) reasons.push("method_pipeline_does_not_cover_observations");
  }

  const relations = crossSectionRelations(model ?? {});
  if (sectionCount(observations) >= 3 && relations.length === 0) {
    reasons.push("cross_section_synthesis_missing");
  }
  const relationEvidence = validateEvidenceRefs(
    relations.map((value, index) => ({ path: `cross_section_relations.${index}`, value })),
    extraction,
  );
  reasons.push(...relationEvidence.issues);

  const understandingComplete = Boolean(
    modelCheck.ok &&
    understanding?.understandingComplete === true &&
    fields.every(field => fieldStatus[field]?.satisfied) &&
    reasons.length === 0,
  );
  const coverage = coverageComplete === true;
  return {
    ok: coverage && understandingComplete,
    coverageComplete: coverageComplete === null ? null : coverage,
    understandingComplete,
    paperModelBuilt: modelCheck.ok,
    methodSteps: steps,
    observationCount: observations.length,
    methodCandidateCount: methodCandidates.length,
    crossSectionRelationCount: relations.length,
    requiredFields: fields,
    fieldStatus,
    evidenceRefCount: modelCheck.evidenceRefCount + relationEvidence.count,
    reasons: [...new Set(reasons)],
    modelIssues: modelCheck.issues,
    researchType: modelCheck.researchType ?? null,
  };
}

function pathValue(model, parts) {
  let value = model;
  for (const part of parts) {
    if (value === null || value === undefined) return null;
    if (/^\d+$/.test(part)) {
      value = Array.isArray(value) ? value[Number(part)] : null;
    } else {
      value = value[part];
    }
  }
  return value ?? null;
}

export function resolvePaperModelNode(input, reference) {
  const model = normalizePaperModel(input);
  if (!model || !nonEmptyText(reference)) return null;
  const ref = reference.trim();
  const match = ref.match(/^method_pipeline\.step_(\d+)$/);
  if (match) {
    const stepNumber = Number(match[1]);
    const index = model.method_pipeline?.findIndex(step => Number(step?.step) === stepNumber) ?? -1;
    if (index < 0) return null;
    return {
      reference: ref,
      canonicalRef: `method_pipeline.${index}`,
      value: model.method_pipeline[index],
    };
  }
  const value = pathValue(model, ref.split("."));
  if (value === null || value === undefined) return null;
  return { reference: ref, canonicalRef: ref, value };
}

/** Resolve `method_pipeline.step_3`, `key_results.0`, or a model field. */
export function resolvePaperModelRef(input, reference) {
  return resolvePaperModelNode(input, reference)?.value ?? null;
}

export function annotationPaperModelRefs(annotation) {
  const plural = annotation?.paperModelRefs ?? annotation?.paper_model_refs;
  const singular = annotation?.paperModelRef ?? annotation?.paper_model_ref;
  const values = Array.isArray(plural)
    ? plural
    : nonEmptyText(plural) ? [plural] : nonEmptyText(singular) ? [singular] : [];
  return [...new Set(values.filter(nonEmptyText).map(value => value.trim()))];
}

export function validateAnnotationSemanticRole(annotation, paperModel, index = 0) {
  const references = annotationPaperModelRefs(annotation);
  const reference = references[0] ?? null;
  const role = annotation?.semanticRole ?? annotation?.semantic_role;
  const issues = [];
  if (!references.length) issues.push(`annotations[${index}].paper_model_ref_missing`);
  if (!nonEmptyText(role)) issues.push(`annotations[${index}].semantic_role_missing`);
  const unresolved = references.filter(ref => !resolvePaperModelNode(paperModel, ref));
  if (unresolved.length) {
    issues.push(`annotations[${index}].paper_model_ref_unresolved`);
    unresolved.forEach(ref => issues.push(`annotations[${index}].paper_model_ref_unresolved.${ref}`));
  }
  return {
    ok: issues.length === 0,
    issues,
    paperModelRef: reference,
    paperModelRefs: references,
    semanticRole: role ?? null,
  };
}

export function summarizePaperModel(modelInput) {
  const model = normalizePaperModel(modelInput);
  if (!model) return null;
  const nodes = enumeratePaperModelNodes(model);
  return {
    researchType: researchType(model),
    coreProblem: claimText(model.core_problem),
    researchGapCount: Array.isArray(model.research_gap) ? model.research_gap.length : 0,
    dataCount: Array.isArray(model.data) ? model.data.length : 0,
    methodSteps: Array.isArray(model.method_pipeline) ? model.method_pipeline.length : 0,
    keyResultCount: Array.isArray(model.key_results) ? model.key_results.length : 0,
    contributionCount: Array.isArray(model.contributions) ? model.contributions.length : 0,
    limitationCount: Array.isArray(model.limitations) ? model.limitations.length : 0,
    requiredNodeCount: nodes.filter(node => node.annotation_priority === "required").length,
    usefulNodeCount: nodes.filter(node => node.annotation_priority === "useful").length,
    backgroundNodeCount: nodes.filter(node => node.annotation_priority === "background").length,
    crossSectionRelationCount: crossSectionRelations(model).length,
    endToEndStory: claimText(model.end_to_end_story),
  };
}
