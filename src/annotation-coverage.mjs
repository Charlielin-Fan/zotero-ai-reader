import {
  annotationPaperModelRefs,
  enumeratePaperModelNodes,
  normalizePaperModel,
  resolvePaperModelNode,
} from "./semantic.mjs";

const ACCEPTED_EXCEPTION_STATUSES = new Set(["no_annotation_worthy_evidence"]);
const ABSTRACT_PATTERN = /\babstract\b/i;

function annotationsFromPlan(plan) {
  if (Array.isArray(plan?.annotations)) return plan.annotations;
  const source = plan?.annotation_plan && typeof plan.annotation_plan === "object"
    ? plan.annotation_plan
    : plan?.analysis && typeof plan.analysis === "object" ? plan.analysis : plan;
  return [
    "research_purpose",
    "research_gap",
    "research_method",
    "research_result",
  ].flatMap(category => (Array.isArray(source?.[category]) ? source[category] : []).map(entry => ({
    ...entry,
    category,
  })));
}

function declarationSource(value) {
  if (!value || typeof value !== "object") return null;
  return value.nodes ?? value.node_statuses ?? value.nodeStatuses ?? value;
}

function declaredNodeEntry(declaration, reference) {
  const source = declarationSource(declaration);
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const direct = source[reference];
  if (direct === undefined) return null;
  if (direct === true) return { status: "covered" };
  if (direct === false) return { status: "selection_omission" };
  if (typeof direct === "string") return { status: direct };
  return direct && typeof direct === "object" ? direct : null;
}

function normalizedQuote(annotation) {
  const quote = annotation?.exactQuote ?? annotation?.exact_quote ?? annotation?.exactText;
  return typeof quote === "string" ? quote.trim().replace(/\s+/g, " ") : "";
}

function sourceSection(annotation) {
  const section = annotation?.sourceSection ?? annotation?.source_section;
  return typeof section === "string" ? section.trim() : "";
}

function canonicalRefs(annotation, paperModel) {
  return annotationPaperModelRefs(annotation)
    .map(reference => resolvePaperModelNode(paperModel, reference)?.canonicalRef ?? null)
    .filter(Boolean);
}

function locationStatus(index, locations, invalidAnnotationIndices) {
  if (invalidAnnotationIndices?.has(index)) return "locator_failure";
  if (!Array.isArray(locations)) return "unique";
  return locations[index]?.status ?? "locator_failure";
}

function failureStatus(statuses) {
  if (statuses.includes("ambiguous")) return "ambiguous";
  if (statuses.includes("not_found")) return "not_found";
  if (statuses.includes("locator_failure")) return "locator_failure";
  return "selection_omission";
}

function nodePriorityIssue(node) {
  if (node.raw_annotation_priority === null || node.raw_annotation_priority === undefined) {
    return `${node.path}.annotation_priority_missing`;
  }
  if (!node.annotation_priority) return `${node.path}.annotation_priority_invalid`;
  return null;
}

function isSatisfied(status) {
  return status === "covered" || ACCEPTED_EXCEPTION_STATUSES.has(status);
}

function nodeDomain(node) {
  if (node.field === "method_pipeline") return "method_pipeline";
  if (node.field === "key_results") return "key_results";
  if (node.field === "data") return "data";
  if (node.field === "research_gap") return "research_gap";
  if (node.field === "limitations") return "limitations";
  if (node.field === "evaluation") return "evaluation";
  if (node.field === "core_problem") return "core_problem";
  if (node.field === "research_objective") return "research_objective";
  if (node.field === "contributions") return "contributions";
  return node.field;
}

function nodeCoverageRecord({ node, annotations, paperModel, locations, invalidAnnotationIndices, declaration }) {
  const matching = [];
  const eligible = [];
  const statuses = [];
  annotations.forEach((annotation, index) => {
    if (!canonicalRefs(annotation, paperModel).includes(node.path)) return;
    matching.push(index);
    const status = locationStatus(index, locations, invalidAnnotationIndices);
    statuses.push(status);
    if (status === "unique") eligible.push(index);
  });

  const declared = declaredNodeEntry(declaration, node.path);
  let status;
  let reason = null;
  if (eligible.length) {
    status = "covered";
  } else if (matching.length) {
    status = failureStatus(statuses);
    reason = `${status}_evidence_for_required_node`;
  } else if (declared?.status === "no_annotation_worthy_evidence" && typeof declared.reason === "string" && declared.reason.trim()) {
    status = declared.status;
    reason = declared.reason.trim();
  } else if (declared?.status && declared.status !== "covered") {
    status = String(declared.status);
    reason = typeof declared.reason === "string" && declared.reason.trim()
      ? declared.reason.trim()
      : `${status}_for_required_node`;
  } else {
    status = "selection_omission";
    reason = "required_node_uncovered";
  }

  return {
    path: node.path,
    field: node.field,
    domain: nodeDomain(node),
    annotationPriority: node.annotation_priority,
    status,
    satisfied: isSatisfied(status),
    annotationIndices: matching,
    eligibleAnnotationIndices: eligible,
    locatorStatuses: [...new Set(statuses)],
    ...(reason ? { reason } : {}),
  };
}

function diagnosticCounts(nodeRecords, domain) {
  const relevant = nodeRecords.filter(node => node.domain === domain);
  return {
    required: relevant.length,
    covered: relevant.filter(node => node.status === "covered").length,
    satisfied: relevant.filter(node => node.satisfied).length,
    missing: relevant.filter(node => !node.satisfied).map(node => node.path),
  };
}

function overcompressionDiagnostic({ annotations, requiredNodes, requiredNodeRecords }) {
  const missing = requiredNodeRecords.filter(node => !node.satisfied);
  if (!missing.length) return false;
  // The count is only a soft signal after semantic coverage has shown loss.
  // It is never sufficient by itself to raise this diagnostic.
  return annotations.length <= 5 && requiredNodes.length > annotations.length;
}

/**
 * Compare the final plan against every explicitly required Paper Model node.
 * This is semantic coverage, not a category-count or annotation-quota check.
 */
export function evaluateAnnotationCoverage({
  paperModel,
  annotations,
  annotationCoverage = null,
  locations = null,
  invalidAnnotationIndices = null,
} = {}) {
  const model = normalizePaperModel(paperModel);
  const normalizedAnnotations = Array.isArray(annotations)
    ? annotations
    : annotationsFromPlan({ annotations });
  if (!model) {
    return {
      ok: false,
      annotationCoverageComplete: false,
      reasons: ["paper_model_missing"],
      diagnostics: [],
      requiredNodeCount: 0,
      requiredNodesCovered: 0,
      requiredNodesSatisfied: 0,
      usefulNodesAnnotated: 0,
      backgroundNodesAnnotated: 0,
      plannedAnnotations: normalizedAnnotations.length,
      nodeCoverage: {},
      reconstructability: { sufficient: false, requiredNodeRefs: [], coveredNodeRefs: [], missingNodeRefs: [] },
    };
  }

  const allNodes = enumeratePaperModelNodes(model);
  const priorityIssues = allNodes.map(nodePriorityIssue).filter(Boolean);
  const requiredNodes = allNodes.filter(node => node.annotation_priority === "required");
  const requiredRecords = requiredNodes.map(node => nodeCoverageRecord({
    node,
    annotations: normalizedAnnotations,
    paperModel: model,
    locations,
    invalidAnnotationIndices,
    declaration: annotationCoverage,
  }));
  const allRecords = allNodes.map(node => {
    const requiredRecord = requiredRecords.find(record => record.path === node.path);
    if (requiredRecord) return requiredRecord;
    const matching = [];
    normalizedAnnotations.forEach((annotation, index) => {
      if (canonicalRefs(annotation, model).includes(node.path) && locationStatus(index, locations, invalidAnnotationIndices) === "unique") {
        matching.push(index);
      }
    });
    const isBackground = node.annotation_priority === "background";
    return {
      path: node.path,
      field: node.field,
      domain: nodeDomain(node),
      annotationPriority: node.annotation_priority,
      status: isBackground ? (matching.length ? "covered" : "background") : matching.length ? "covered" : "not_required",
      satisfied: !isBackground && matching.length > 0,
      annotationIndices: matching,
      eligibleAnnotationIndices: matching,
    };
  });

  const method = diagnosticCounts(requiredRecords, "method_pipeline");
  const results = diagnosticCounts(requiredRecords, "key_results");
  const diagnostics = [];
  if (method.required >= 3 && method.covered < method.required) {
    diagnostics.push("insufficient_method_annotation_coverage");
  }
  if (results.required >= 3 && results.covered < results.required) {
    diagnostics.push("insufficient_result_annotation_coverage");
  }
  if (overcompressionDiagnostic({
    annotations: normalizedAnnotations,
    requiredNodes,
    requiredNodeRecords: requiredRecords,
  })) {
    diagnostics.push("possible_overcompression");
  }

  const requiredNodesCovered = requiredRecords.filter(node => node.status === "covered").length;
  const requiredNodesSatisfied = requiredRecords.filter(node => node.satisfied).length;
  const uncoveredRequiredNodes = requiredRecords.filter(node => !node.satisfied).map(node => node.path);
  const annotationCoverageComplete = priorityIssues.length === 0 && uncoveredRequiredNodes.length === 0;
  const reasons = [...priorityIssues];
  if (uncoveredRequiredNodes.length) reasons.push("required_nodes_uncovered");
  if (annotationCoverage?.annotationCoverageComplete === true && !annotationCoverageComplete) {
    reasons.push("declared_annotation_coverage_mismatch");
  }

  const nodeCoverage = Object.fromEntries(allRecords.map(record => [record.path, record]));
  const coveredNodeRefs = requiredRecords.filter(node => node.satisfied).map(node => node.path);
  return {
    ok: annotationCoverageComplete,
    annotationCoverageComplete,
    reasons: [...new Set(reasons)],
    diagnostics: [...new Set(diagnostics)],
    requiredNodeCount: requiredNodes.length,
    requiredNodesCovered,
    requiredNodesSatisfied,
    requiredNodeCoverageRatio: requiredNodes.length
      ? requiredNodesCovered / requiredNodes.length
      : 1,
    usefulNodesAnnotated: allRecords.filter(node => node.annotationPriority === "useful" && node.status === "covered").length,
    backgroundNodesAnnotated: allRecords.filter(node => node.annotationPriority === "background" && node.status === "covered").length,
    plannedAnnotations: normalizedAnnotations.length,
    methodSteps: method.required,
    methodStepsCovered: method.covered,
    keyResults: results.required,
    keyResultsCovered: results.covered,
    nodeCoverage,
    reconstructability: {
      sufficient: annotationCoverageComplete,
      requiredNodeRefs: requiredNodes.map(node => node.path),
      coveredNodeRefs,
      missingNodeRefs: uncoveredRequiredNodes,
    },
  };
}

function candidateDeduplicationKey(candidate) {
  return candidate?.semantic_duplicate_key
    ?? candidate?.semanticDuplicateKey
    ?? candidate?.deduplication_key
    ?? candidate?.deduplicationKey
    ?? null;
}

function candidateScore(candidate, refs) {
  const section = sourceSection(candidate);
  const bodyScore = section && !ABSTRACT_PATTERN.test(section) ? 100000 : 0;
  const specificity = Number(candidate?.specificity ?? candidate?.evidence_specificity ?? 0);
  const exactLength = normalizedQuote(candidate).length;
  return bodyScore + specificity * 1000 + refs.length * 100 + exactLength;
}

function betterCandidate(left, right, leftRefs, rightRefs) {
  const scoreDifference = candidateScore(left, leftRefs) - candidateScore(right, rightRefs);
  return scoreDifference >= 0 ? left : right;
}

/**
 * Remove only explicitly identified semantic duplicates. Complementary
 * passages with different duplicate keys or different exact text remain.
 */
export function deduplicateAnnotationCandidates(candidates, { paperModel } = {}) {
  if (!Array.isArray(candidates)) return [];
  const model = normalizePaperModel(paperModel);
  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const quote = normalizedQuote(candidate);
    const refs = model ? canonicalRefs(candidate, model) : annotationPaperModelRefs(candidate);
    const duplicateKey = candidateDeduplicationKey(candidate);
    const key = duplicateKey
      ? `semantic:${duplicateKey}`
      : `exact:${quote}|${refs.join(",")}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { candidate, refs, index });
      return;
    }
    const preferred = betterCandidate(current.candidate, candidate, current.refs, refs);
    groups.set(key, preferred === current.candidate
      ? current
      : { candidate, refs, index });
  });
  return [...groups.values()]
    .sort((left, right) => left.index - right.index)
    .map(entry => entry.candidate);
}

/**
 * Greedy minimum-sufficient selection. It covers required nodes first, then
 * retains useful evidence only when the planner marks it as materially
 * improving reconstruction. There is no global top-N or category quota.
 */
export function selectMinimumSufficientEvidence({ paperModel, candidates = [] } = {}) {
  const model = normalizePaperModel(paperModel);
  const requiredNodes = enumeratePaperModelNodes(model).filter(node => node.annotation_priority === "required");
  const deduplicated = deduplicateAnnotationCandidates(candidates, { paperModel: model });
  const candidateRecords = deduplicated.map((candidate, index) => ({
    candidate,
    index,
    refs: canonicalRefs(candidate, model),
  }));
  const selected = [];
  const selectedIndices = new Set();
  const uncovered = new Set(requiredNodes.map(node => node.path));

  while (uncovered.size) {
    const available = candidateRecords
      .filter(record => !selectedIndices.has(record.index))
      .map(record => ({
        ...record,
        newlyCovered: record.refs.filter(reference => uncovered.has(reference)),
      }))
      .filter(record => record.newlyCovered.length);
    if (!available.length) break;
    available.sort((left, right) => {
      if (right.newlyCovered.length !== left.newlyCovered.length) {
        return right.newlyCovered.length - left.newlyCovered.length;
      }
      return candidateScore(right.candidate, right.refs) - candidateScore(left.candidate, left.refs);
    });
    const chosen = available[0];
    selected.push(chosen.candidate);
    selectedIndices.add(chosen.index);
    chosen.newlyCovered.forEach(reference => uncovered.delete(reference));
  }

  for (const record of candidateRecords) {
    if (selectedIndices.has(record.index)) continue;
    const priority = record.candidate?.annotation_priority ?? record.candidate?.annotationPriority;
    const materiallyImproves = record.candidate?.materially_improves_reconstruction === true
      || record.candidate?.materiallyImprovesReconstruction === true
      || record.candidate?.retain_when_useful === true
      || record.candidate?.retainWhenUseful === true;
    if (priority === "useful" && materiallyImproves) selected.push(record.candidate);
  }

  const annotationCoverage = evaluateAnnotationCoverage({
    paperModel: model,
    annotations: selected,
  });
  return {
    annotations: selected,
    missingRequiredRefs: [...uncovered],
    annotationCoverage,
  };
}
