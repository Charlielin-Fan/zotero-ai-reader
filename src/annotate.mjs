import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { extractFullText } from "./extract.mjs";
import { locateText } from "./locator.mjs";
import { evaluateCoverage, sourcePageMismatches } from "./coverage.mjs";
import { CATEGORY_CONFIG, executeZoteroJS, writeAnnotations } from "./writer.mjs";

const CATEGORY_ORDER = [
  ["research_purpose", "研究目的"],
  ["research_gap", "研究缺口"],
  ["research_method", "研究方法"],
  ["research_result", "研究结果"],
];

function analysisSource(input) {
  return input?.analysis && typeof input.analysis === "object" ? input.analysis : input;
}

function withEvidenceSourceFields(annotation, entry) {
  const sourcePage = entry.source_page ?? entry.sourcePage;
  const sourceSection = entry.source_section ?? entry.sourceSection;
  if (sourcePage !== undefined && sourcePage !== null) annotation.sourcePage = sourcePage;
  if (sourceSection !== undefined && sourceSection !== null) annotation.sourceSection = sourceSection;
  return annotation;
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
  if (Array.isArray(source.annotations)) {
    return {
      ...input,
      ...(resolvedAttachmentKey ? { attachmentKey: resolvedAttachmentKey } : {}),
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
    annotations,
  };
}

function validatePlan(input) {
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
  return plan;
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
  return `<h1>AI 文献阅读笔记</h1>${sections}`;
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

  let coverageCheck = null;
  if (apply) {
    try {
      const extraction = await extractFullText({
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
      };
    }
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
