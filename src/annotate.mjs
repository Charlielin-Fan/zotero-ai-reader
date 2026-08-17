import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { extractFullText } from "./extract.mjs";
import { locateText } from "./locator.mjs";
import { evaluateCoverage, sourcePageMismatches } from "./coverage.mjs";
import { evaluateAnnotationCoverage } from "./annotation-coverage.mjs";
import { CATEGORY_CONFIG, executeZoteroJS, writeAnnotations } from "./writer.mjs";
import {
  evaluateUnderstanding,
  normalizePaperModel,
  normalizeSectionObservations,
  validateAnnotationSemanticRole,
} from "./semantic.mjs";

const CATEGORY_ORDER = [
  ["research_purpose", "研究目的"],
  ["research_gap", "研究缺口"],
  ["research_method", "研究方法"],
  ["research_result", "研究结果"],
];

function analysisSource(input) {
  if (input?.annotation_plan && typeof input.annotation_plan === "object") return input.annotation_plan;
  return input?.analysis && typeof input.analysis === "object" ? input.analysis : input;
}

function withEvidenceSourceFields(annotation, entry) {
  const sourcePage = entry.source_page ?? entry.sourcePage;
  const sourceSection = entry.source_section ?? entry.sourceSection;
  if (sourcePage !== undefined && sourcePage !== null) annotation.sourcePage = sourcePage;
  if (sourceSection !== undefined && sourceSection !== null) annotation.sourceSection = sourceSection;
  const paperModelRef = entry.paper_model_ref ?? entry.paperModelRef;
  const paperModelRefs = entry.paper_model_refs ?? entry.paperModelRefs;
  const semanticRole = entry.semantic_role ?? entry.semanticRole;
  const evidenceRefs = entry.evidence_refs ?? entry.evidenceRefs;
  if (paperModelRef !== undefined && paperModelRef !== null) annotation.paperModelRef = paperModelRef;
  if (Array.isArray(paperModelRefs)) {
    annotation.paperModelRefs = [...paperModelRefs];
    if (annotation.paperModelRef === undefined && paperModelRefs.length) {
      annotation.paperModelRef = paperModelRefs[0];
    }
  } else if (annotation.paperModelRef !== undefined && annotation.paperModelRef !== null) {
    annotation.paperModelRefs = [annotation.paperModelRef];
  }
  if (semanticRole !== undefined && semanticRole !== null) annotation.semanticRole = semanticRole;
  if (evidenceRefs !== undefined && evidenceRefs !== null) annotation.evidenceRefs = evidenceRefs;
  const annotationPriority = entry.annotation_priority ?? entry.annotationPriority;
  if (annotationPriority !== undefined && annotationPriority !== null) {
    annotation.annotationPriority = annotationPriority;
  }
  return annotation;
}

function semanticFields(input, source) {
  const containers = [source, input, input.analysis, input.annotation_plan]
    .filter(container => container && typeof container === "object");
  const firstValue = (...keys) => containers
    .map(container => keys.map(key => container[key]).find(value => value !== undefined))
    .find(value => value !== undefined);
  const paperModel = firstValue("paper_model", "paperModel") ?? null;
  const understanding = firstValue("understanding") ?? null;
  const observations = firstValue("section_observations", "sectionObservations", "observations") ?? [];
  const annotationCoverage = firstValue("annotation_coverage", "annotationCoverage") ?? null;
  return {
    paperModel: normalizePaperModel(paperModel),
    understanding,
    sectionObservations: normalizeSectionObservations({ section_observations: observations }),
    annotationCoverage,
  };
}

/**
 * Convert the public four-category analysis schema into the writer's
 * attachment-oriented internal schema. Keep the prior `annotations` form for
 * backwards compatibility with already accepted plans.
 */
export function normalizeAnalysisPlan(input, { attachmentKey = null } = {}) {
  if (!input || typeof input !== "object") throw new Error("annotation plan must be an object");
  const source = analysisSource(input);
  const resolvedAttachmentKey = input.attachmentKey ?? attachmentKey;
  const semantic = semanticFields(input, source);
  if (Array.isArray(source.annotations)) {
    return {
      ...input,
      ...(resolvedAttachmentKey ? { attachmentKey: resolvedAttachmentKey } : {}),
      ...semantic,
      annotations: source.annotations.map(annotation => withEvidenceSourceFields({ ...annotation }, annotation)),
    };
  }

  const annotations = [];
  for (const [category] of CATEGORY_ORDER) {
    const entries = source[category] ?? [];
    if (!Array.isArray(entries)) throw new Error(`${category} must be an array`);
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`${category}[${index}] must be an object`);
      }
      annotations.push(withEvidenceSourceFields({
        category,
        exactQuote: entry.exact_quote ?? entry.exactText,
        contextBefore: entry.context_before ?? entry.contextBefore ?? null,
        contextAfter: entry.context_after ?? entry.contextAfter ?? null,
        summaryZh: entry.summary_zh ?? entry.summaryZh,
      }, entry));
    });
  }
  return {
    ...input,
    ...(resolvedAttachmentKey ? { attachmentKey: resolvedAttachmentKey } : {}),
    ...semantic,
    annotations,
  };
}

function validatePlan(input, { requireSemantic = true } = {}) {
  const plan = normalizeAnalysisPlan(input);
  if (typeof plan.attachmentKey !== "string" || !plan.attachmentKey.length) {
    throw new Error("attachmentKey must be non-empty");
  }
  if (!Array.isArray(plan.annotations)) throw new Error("annotations must be an array");
  plan.annotations.forEach((annotation, index) => {
    if (!CATEGORY_CONFIG[annotation?.category]) {
      throw new Error(`annotations[${index}].category is unsupported`);
    }
    if (typeof annotation.exactQuote !== "string" || !annotation.exactQuote.length) {
      throw new Error(`annotations[${index}].exactQuote must be non-empty`);
    }
    if (typeof annotation.summaryZh !== "string") {
      throw new Error(`annotations[${index}].summaryZh must be a string`);
    }
    for (const contextName of ["contextBefore", "contextAfter"]) {
      if (annotation[contextName] != null && typeof annotation[contextName] !== "string") {
        throw new Error(`annotations[${index}].${contextName} must be a string or null`);
      }
    }
  });
  if (requireSemantic && plan.annotations.length) {
    if (!plan.paperModel) throw new Error("paper_model is required before annotation planning");
    if (!plan.understanding || typeof plan.understanding !== "object") {
      throw new Error("understanding is required before annotation planning");
    }
    const semanticIssues = plan.annotations.flatMap((annotation, index) =>
      validateAnnotationSemanticRole(annotation, plan.paperModel, index).issues,
    );
    if (semanticIssues.length) throw new Error(semanticIssues.join("; "));
  }
  return plan;
}

function annotationCoverageFailure(annotationCoverage) {
  return {
    reason: "annotation_coverage_gate",
    reasons: annotationCoverage?.reasons ?? [],
    diagnostics: annotationCoverage?.diagnostics ?? [],
    missingRequiredNodes: annotationCoverage?.reconstructability?.missingNodeRefs ?? [],
  };
}

function hasContext(annotation) {
  return annotation.contextBefore != null || annotation.contextAfter != null;
}

function locationRecord(annotation, result, phase) {
  return {
    category: annotation.category,
    exactQuote: annotation.exactQuote,
    phase,
    status: result.status,
    candidateCount: result.candidateCount,
    pageIndex: result.pageIndex,
    rects: result.rects,
    sortIndex: result.sortIndex,
    matchedText: result.matchedText,
    candidates: result.candidates,
    ...(annotation.sourcePage !== undefined ? { sourcePage: annotation.sourcePage } : {}),
    ...(annotation.sourceSection !== undefined ? { sourceSection: annotation.sourceSection } : {}),
    ...(annotation.paperModelRef !== undefined ? { paperModelRef: annotation.paperModelRef } : {}),
    ...(annotation.paperModelRefs !== undefined ? { paperModelRefs: annotation.paperModelRefs } : {}),
    ...(annotation.semanticRole !== undefined ? { semanticRole: annotation.semanticRole } : {}),
    ...(annotation.annotationPriority !== undefined ? { annotationPriority: annotation.annotationPriority } : {}),
  };
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildNoteHTML(input) {
  const plan = normalizeAnalysisPlan(input);
  const model = plan.paperModel;
  const claimText = (value, fields = ["summary", "result", "contribution", "limitation", "gap", "approach", "name", "operation", "validation_strategy"]) => {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    return fields.map(field => value[field]).find(candidate => typeof candidate === "string" && candidate.trim()) ?? "";
  };
  const evidenceHTML = value => {
    const refs = value?.evidence_refs ?? value?.evidenceRefs;
    if (!Array.isArray(refs) || !refs.length) return "";
    return `<ul>${refs.map(ref => `<li>第${escapeHTML(ref.page ?? "?")}页：${escapeHTML(ref.exact_quote ?? ref.exactQuote ?? "")}</li>`).join("")}</ul>`;
  };
  const listClaims = (values, fields) => Array.isArray(values) && values.length
    ? `<ul>${values.map(value => `<li>${escapeHTML(claimText(value, fields))}${evidenceHTML(value)}</li>`).join("")}</ul>`
    : "<p>未记录。</p>";
  const collectEvidence = (value, path = "paper_model", output = []) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => collectEvidence(entry, `${path}.${index}`, output));
      return output;
    }
    if (!value || typeof value !== "object") return output;
    const refs = value.evidence_refs ?? value.evidenceRefs;
    if (Array.isArray(refs)) {
      refs.forEach(ref => output.push({ path, ...ref }));
    }
    Object.entries(value)
      .filter(([key]) => key !== "evidence_refs" && key !== "evidenceRefs")
      .forEach(([key, child]) => collectEvidence(child, `${path}.${key}`, output));
    return output;
  };
  const allEvidence = model
    ? [...new Map(collectEvidence(model).map(ref => [JSON.stringify([ref.page, ref.exact_quote ?? ref.exactQuote]), ref])).values()]
    : [];
  const evidenceListHTML = allEvidence.length
    ? `<ul>${allEvidence.map(ref => `<li>${escapeHTML(ref.path)}；第${escapeHTML(ref.page ?? "?")}页：${escapeHTML(ref.exact_quote ?? ref.exactQuote ?? "")}</li>`).join("")}</ul>`
    : "<p>未记录。</p>";
  const modelHTML = model
    ? [
      `<h2>一、研究背景与核心问题</h2><p>${escapeHTML(claimText(model.research_context))}</p><p>${escapeHTML(claimText(model.core_problem))}</p>${evidenceHTML(model.research_context)}${evidenceHTML(model.core_problem)}`,
      `<h2>二、研究缺口</h2>${listClaims(model.existing_approaches, ["approach", "limitation"])}${listClaims(model.research_gap, ["gap", "why_it_matters"])}`,
      `<h2>三、研究目标</h2><p>${escapeHTML(claimText(model.research_objective))}</p>${evidenceHTML(model.research_objective)}`,
      `<h2>四、数据与研究对象</h2>${listClaims(model.data, ["name", "source", "role", "important_properties"])}`,
      `<h2>五、完整研究流程</h2>${model.end_to_end_story ? `<p>${escapeHTML(claimText(model.end_to_end_story))}</p>${evidenceHTML(model.end_to_end_story)}` : ""}<ol>${(model.method_pipeline ?? []).map(step => `<li><strong>${escapeHTML(claimText(step, ["name"]))}</strong>：输入 ${escapeHTML(step.input ?? "")}；操作 ${escapeHTML(step.operation ?? "")}；输出 ${escapeHTML(step.output ?? "")}；必要性 ${escapeHTML(step.why_needed ?? "")}${evidenceHTML(step)}</li>`).join("")}</ol>`,
      `<h2>六、实验与评价设计</h2><p>${escapeHTML(claimText(model.experimental_design))}</p>${evidenceHTML(model.experimental_design)}${model.evaluation ? `<p>${escapeHTML(claimText(model.evaluation, ["summary", "validation_strategy"]))}</p>${evidenceHTML(model.evaluation)}` : ""}`,
      `<h2>七、主要结果</h2>${listClaims(model.key_results, ["result", "what_it_demonstrates"])} `,
      `<h2>八、核心贡献</h2>${listClaims(model.contributions, ["contribution", "summary"])} `,
      `<h2>九、研究局限</h2>${listClaims(model.limitations, ["limitation", "summary"])} `,
      `<h2>十、跨章节关系与关键原文证据</h2>${listClaims(model.cross_section_relations, ["relation", "summary", "from", "through", "to"])}${evidenceListHTML}`,
    ].join("")
    : "";
  const sections = CATEGORY_ORDER.map(([category, heading]) => {
    const entries = plan.annotations.filter(annotation => annotation.category === category);
    const body = entries.length
      ? entries.map(annotation =>
        `<p><strong>摘要：</strong>${escapeHTML(annotation.summaryZh)}</p>` +
        `<p><strong>原文：</strong>${escapeHTML(annotation.exactQuote)}</p>`,
      ).join("")
      : "<p>未提供明确证据。</p>";
    return `<h2>${heading}</h2>${body}`;
  }).join("");
  return `<h1>${model ? "AI 文献拆解" : "AI 文献阅读笔记"}</h1>${modelHTML}${sections}`;
}

function buildNoteBridgeScript({ attachmentKey, html }) {
  return `
const request = ${JSON.stringify({ attachmentKey, html, marker: "AI 文献阅读笔记" })};
const libraryIDs = [
  Zotero.Libraries.userLibraryID,
  ...Zotero.Libraries.getAll().map(library => library.libraryID),
].filter((id, index, all) => id && all.indexOf(id) === index);
let attachment = null;
for (const libraryID of libraryIDs) {
  attachment = Zotero.Items.getByLibraryAndKey(libraryID, request.attachmentKey);
  if (attachment) break;
}
if (!attachment || !attachment.isFileAttachment()) {
  throw new Error('PDF attachment not found: ' + request.attachmentKey);
}
const parent = attachment.parentID ? Zotero.Items.get(attachment.parentID) : attachment;
const notes = Zotero.Items.get(parent.getNotes(false));
const existing = notes.find(note => note.getNote().includes('<h1>' + request.marker + '</h1>'));
if (existing) {
  return { status: 'already_exists', noteKey: existing.key, parentItemID: parent.id };
}
const note = new Zotero.Item('note');
note.libraryID = parent.libraryID;
note.parentID = parent.id;
note.setNote(request.html);
await note.saveTx({ skipSelect: true });
return { status: 'created', noteKey: note.key, parentItemID: parent.id };
`;
}

export async function createChildNote(plan, options = {}) {
  const canonicalPlan = validatePlan(plan);
  const semantic = evaluateUnderstanding({
    paperModel: canonicalPlan.paperModel,
    understanding: canonicalPlan.understanding,
    sectionObservations: canonicalPlan.sectionObservations,
    coverageComplete: canonicalPlan.coverage?.coverageComplete ?? null,
  });
  const annotationCoverage = evaluateAnnotationCoverage({
    paperModel: canonicalPlan.paperModel,
    annotations: canonicalPlan.annotations,
    annotationCoverage: canonicalPlan.annotationCoverage,
  });
  if (!semantic.ok || !annotationCoverage.ok) {
    const reasons = [...semantic.reasons, ...annotationCoverage.reasons];
    throw new Error(`coverage and understanding gates failed: ${reasons.join(", ")}`);
  }
  return executeZoteroJS(buildNoteBridgeScript({
    attachmentKey: canonicalPlan.attachmentKey,
    html: buildNoteHTML(canonicalPlan),
  }), options);
}

export async function annotatePlan(
  plan,
  { apply = false, createNote = false, ...options } = {},
) {
  const canonicalPlan = validatePlan(plan);

  const declaredSemantic = evaluateUnderstanding({
    paperModel: canonicalPlan.paperModel,
    understanding: canonicalPlan.understanding,
    sectionObservations: canonicalPlan.sectionObservations,
    coverageComplete: canonicalPlan.coverage?.coverageComplete ?? null,
  });
  const declaredAnnotationCoverage = evaluateAnnotationCoverage({
    paperModel: canonicalPlan.paperModel,
    annotations: canonicalPlan.annotations,
    annotationCoverage: canonicalPlan.annotationCoverage,
  });

  let coverageCheck = null;
  let extraction = null;
  if (apply) {
    try {
      extraction = await extractFullText({
        attachmentKey: canonicalPlan.attachmentKey,
        ...options,
      });
      coverageCheck = evaluateCoverage({ extraction, plan: canonicalPlan });
    } catch (error) {
      return {
        attachmentKey: canonicalPlan.attachmentKey,
        status: "failed",
        coverage: {
          coverageComplete: false,
          error: String(error?.message || error),
        },
        locations: [],
        skipped: [{ reason: "coverage_unavailable" }],
        writer: { status: "coverage_blocked", created: [], already_exists: [], failures: [] },
        note: { status: createNote ? "not_created" : "not_requested" },
        semantic: { status: "not_evaluated", ...declaredSemantic },
        annotationCoverage: declaredAnnotationCoverage,
      };
    }
    if (!coverageCheck.ok) {
      return {
        attachmentKey: canonicalPlan.attachmentKey,
        status: "partial",
        coverage: coverageCheck.coverage,
        coverageReasons: coverageCheck.reasons,
        evidenceDistribution: coverageCheck.distribution,
        locations: [],
        skipped: [{ reason: "coverage_gate", reasons: coverageCheck.reasons }],
        writer: { status: "coverage_blocked", created: [], already_exists: [], failures: [] },
        note: { status: createNote ? "not_created" : "not_requested" },
        semantic: { status: "blocked_by_coverage", ...declaredSemantic },
        annotationCoverage: declaredAnnotationCoverage,
      };
    }
  }

  const semanticCheck = evaluateUnderstanding({
    paperModel: canonicalPlan.paperModel,
    understanding: canonicalPlan.understanding,
    sectionObservations: canonicalPlan.sectionObservations,
    extraction,
    coverageComplete: coverageCheck?.coverage?.coverageComplete ?? canonicalPlan.coverage?.coverageComplete ?? null,
  });
  if (apply && !semanticCheck.ok) {
    return {
      attachmentKey: canonicalPlan.attachmentKey,
      status: "partial",
      ...(coverageCheck ? {
        coverage: coverageCheck.coverage,
        evidenceDistribution: coverageCheck.distribution,
      } : {}),
      semantic: { status: "understanding_blocked", ...semanticCheck },
      locations: [],
      skipped: [{ reason: "understanding_gate", reasons: semanticCheck.reasons }],
      writer: { status: "semantic_blocked", created: [], already_exists: [], failures: [] },
      note: { status: createNote ? "not_created" : "not_requested" },
      annotationCoverage: declaredAnnotationCoverage,
    };
  }

  const locations = [];
  const resolved = [];

  for (const annotation of canonicalPlan.annotations) {
    const first = await locateText({
      attachmentKey: canonicalPlan.attachmentKey,
      exactText: annotation.exactQuote,
    });
    let result = first;
    let phase = "exactText";
    if (first.status === "ambiguous" && hasContext(annotation)) {
      result = await locateText({
        attachmentKey: canonicalPlan.attachmentKey,
        exactText: annotation.exactQuote,
        contextBefore: annotation.contextBefore,
        contextAfter: annotation.contextAfter,
      });
      phase = "context";
    }

    locations.push(locationRecord(annotation, result, phase));
    if (result.status === "unique") {
      resolved.push({
        category: annotation.category,
        exactText: annotation.exactQuote,
        pageIndex: result.pageIndex,
        rects: result.rects,
        sortIndex: result.sortIndex,
        commentZh: annotation.summaryZh,
        paperModelRef: annotation.paperModelRef,
        semanticRole: annotation.semanticRole,
      });
    }
  }

  const skipped = locations
    .filter(location => location.status !== "unique")
    .map(location => ({
      category: location.category,
      exactQuote: location.exactQuote,
      reason: location.status,
      candidateCount: location.candidateCount,
      candidates: location.candidates,
    }));

  const pageMismatches = sourcePageMismatches(canonicalPlan.annotations, locations);
  if (pageMismatches.length) {
    skipped.push({ reason: "source_page_mismatch", mismatches: pageMismatches });
  }

  const invalidAnnotationIndices = new Set(
    pageMismatches.map(mismatch => mismatch.index).filter(Number.isInteger),
  );
  const annotationCoverage = evaluateAnnotationCoverage({
    paperModel: canonicalPlan.paperModel,
    annotations: canonicalPlan.annotations,
    annotationCoverage: canonicalPlan.annotationCoverage,
    locations,
    invalidAnnotationIndices,
  });

  if (apply && !annotationCoverage.ok) {
    return {
      attachmentKey: canonicalPlan.attachmentKey,
      status: "partial",
      ...(coverageCheck ? {
        coverage: coverageCheck.coverage,
        evidenceDistribution: coverageCheck.distribution,
      } : {}),
      semantic: { status: "annotation_coverage_blocked", ...semanticCheck },
      annotationCoverage,
      locations,
      skipped: [...skipped, annotationCoverageFailure(annotationCoverage)],
      writer: { status: "annotation_coverage_blocked", created: [], already_exists: [], failures: [] },
      note: { status: createNote ? "not_created" : "not_requested" },
    };
  }

  let writer = { status: apply ? "no_resolved_annotations" : "dry_run", created: [], already_exists: [], failures: [] };
  if (apply && resolved.length && pageMismatches.length === 0) {
    writer = await writeAnnotations({ attachmentKey: canonicalPlan.attachmentKey, annotations: resolved }, options);
  }

  let note = { status: createNote ? (apply ? "pending" : "dry_run") : "not_requested" };
  if (apply && createNote && pageMismatches.length === 0) {
    note = await createChildNote(canonicalPlan, options);
  }

  const hasFailures = skipped.length > 0 || writer.failures?.length > 0;
  return {
    attachmentKey: canonicalPlan.attachmentKey,
    status: apply ? (hasFailures ? "partial" : "completed") : "preview",
    ...(coverageCheck ? {
      coverage: coverageCheck.coverage,
      evidenceDistribution: coverageCheck.distribution,
    } : {}),
    semantic: { status: "evaluated", ...semanticCheck },
    annotationCoverage,
    locations,
    skipped,
    writer,
    note,
  };
}

function parseCLIArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--apply" || argument === "--note") {
      args[argument.slice(2)] = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    args[argument.slice(2).replaceAll("-", "_")] = argv[++index];
  }
  return args;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const args = parseCLIArgs(process.argv.slice(2));
    if (!args.plan) throw new Error("--plan is required");
    const plan = JSON.parse(await (await import("node:fs/promises")).readFile(args.plan, "utf8"));
    if (args.attachment_key) plan.attachmentKey ??= args.attachment_key;
    console.log(JSON.stringify(await annotatePlan(plan, { apply: !!args.apply, createNote: !!args.note }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
