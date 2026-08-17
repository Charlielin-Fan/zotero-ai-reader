const ABSTRACT_SECTION = /\babstract\b/i;

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
    sourcePage: entry.sourcePage ?? entry.source_page ?? null,
    sourceSection: entry.sourceSection ?? entry.source_section ?? null,
  })));
}

function pageNumber(entry) {
  const value = entry?.sourcePage ?? entry?.source_page;
  return Number.isInteger(value) ? value : null;
}

function sectionName(entry) {
  const value = entry?.sourceSection ?? entry?.source_section;
  return typeof value === "string" ? value.trim() : "";
}

function pagesInspectedCount(value) {
  if (Array.isArray(value)) return new Set(value.filter(Number.isInteger)).size;
  return Number.isInteger(value) ? value : 0;
}

function pageUsable(extraction, pageIndex) {
  return extraction.pages?.some(page => page.pageIndex === pageIndex && page.text.trim().length > 0) ?? false;
}

export function getEvidenceDistribution(plan, { abstractPageIndices = [0] } = {}) {
  const annotations = annotationsFromPlan(plan);
  const abstractPages = new Set(abstractPageIndices.filter(Number.isInteger));
  const byCategory = {};
  const byPage = {};
  const bySection = {};
  let abstractEvidenceCount = 0;
  let bodyEvidenceCount = 0;

  for (const annotation of annotations) {
    const category = annotation.category ?? "unclassified";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    const sourcePage = pageNumber(annotation);
    const pageKey = sourcePage == null ? "unknown" : String(sourcePage);
    byPage[pageKey] = (byPage[pageKey] ?? 0) + 1;
    const sourceSection = sectionName(annotation);
    const sectionKey = sourceSection || "unknown";
    bySection[sectionKey] = (bySection[sectionKey] ?? 0) + 1;

    const isAbstract = sourceSection
      ? ABSTRACT_SECTION.test(sourceSection)
      : sourcePage == null || abstractPages.has(sourcePage);
    if (isAbstract) abstractEvidenceCount += 1;
    else bodyEvidenceCount += 1;
  }

  return {
    totalEvidence: annotations.length,
    byCategory,
    byPage,
    bySection,
    abstractEvidenceCount,
    bodyEvidenceCount,
    abstractPageIndices: [...abstractPages].sort((a, b) => a - b),
  };
}

function coverageRecord(extraction, declared, distribution, pagesInspected) {
  return {
    totalPages: extraction.totalPages,
    pagesWithUsableText: extraction.pagesWithUsableText,
    pagesInspected,
    coverageComplete: declared?.coverageComplete === true,
    sectionsSeen: Array.isArray(declared?.sectionsSeen) ? declared.sectionsSeen : [],
    abstractPageIndices: distribution.abstractPageIndices,
    evidenceCount: distribution.totalEvidence,
    evidenceByCategory: distribution.byCategory,
    evidenceByPage: distribution.byPage,
    evidenceBySection: distribution.bySection,
    abstractEvidenceCount: distribution.abstractEvidenceCount,
    bodyEvidenceCount: distribution.bodyEvidenceCount,
  };
}

/**
 * Validate the analysis declaration against a freshly extracted PDF summary.
 * This is a write gate: an incomplete or Abstract-only plan is never passed
 * to the native Zotero writer.
 */
export function evaluateCoverage({ extraction, plan } = {}) {
  if (!extraction || typeof extraction !== "object") {
    return { ok: false, reasons: ["missing_extraction"], coverage: null };
  }
  const declared = plan?.coverage && typeof plan.coverage === "object" ? plan.coverage : null;
  const abstractPageIndices = Array.isArray(declared?.abstractPageIndices)
    ? declared.abstractPageIndices
    : [0];
  const distribution = getEvidenceDistribution(plan, { abstractPageIndices });
  const inspected = pagesInspectedCount(declared?.pagesInspected);
  const expectedPages = Number.isInteger(extraction.totalPages) ? extraction.totalPages : 0;
  const expectedUsablePages = Number.isInteger(extraction.pagesWithUsableText)
    ? extraction.pagesWithUsableText
    : 0;
  const reasons = [];

  if (!declared) reasons.push("coverage_record_missing");
  if (declared?.totalPages !== expectedPages) reasons.push("total_pages_mismatch");
  if (declared?.pagesWithUsableText !== expectedUsablePages) {
    reasons.push("usable_page_count_mismatch");
  }
  if (inspected < expectedUsablePages) reasons.push("not_all_usable_pages_inspected");
  if (declared?.coverageComplete !== true) reasons.push("coverage_incomplete");
  if (!Array.isArray(declared?.sectionsSeen) || declared.sectionsSeen.length === 0) {
    reasons.push("sections_not_recorded");
  }

  const annotations = annotationsFromPlan(plan);
  for (const annotation of annotations) {
    const sourcePage = pageNumber(annotation);
    if (sourcePage == null) {
      reasons.push("evidence_source_metadata_missing");
      break;
    }
    if (sourcePage < 0 || sourcePage >= expectedPages) {
      reasons.push("evidence_source_page_out_of_range");
      break;
    }
    if (!pageUsable(extraction, sourcePage)) {
      reasons.push("evidence_source_page_has_no_text");
      break;
    }
  }

  const hasBodyPages = extraction.pages?.some(page =>
    page.text.trim().length > 0 && !new Set(abstractPageIndices).has(page.pageIndex),
  ) ?? false;
  if (
    hasBodyPages &&
    distribution.totalEvidence > 0 &&
    distribution.bodyEvidenceCount === 0
  ) {
    reasons.push("abstract_only_evidence");
  }

  return {
    ok: reasons.length === 0,
    reasons: [...new Set(reasons)],
    coverage: coverageRecord(extraction, declared, distribution, inspected),
    distribution,
  };
}

export function sourcePageMismatches(annotations, locations) {
  const mismatches = [];
  for (let index = 0; index < annotations.length; index++) {
    const annotation = annotations[index];
    const location = locations[index];
    const expected = pageNumber(annotation);
    if (expected == null || location?.status !== "unique") continue;
    if (location.pageIndex !== expected) {
      mismatches.push({
        index,
        exactQuote: annotation.exactQuote,
        expectedSourcePage: expected,
        locatedPageIndex: location.pageIndex,
      });
    }
  }
  return mismatches;
}
