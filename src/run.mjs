import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { annotatePlan, normalizeAnalysisPlan } from "./annotate.mjs";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:23119";
const DEFAULT_AUDIT_PATH = ".codex/zotero-annotation-audit.jsonl";
const PAGE_SIZE = 100;

function apiURL(baseURL, route) {
  const base = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${base}${route}`;
}

async function getJSON(baseURL, route) {
  const response = await fetch(apiURL(baseURL, route), {
    headers: { Accept: "application/json" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Zotero local API ${response.status} for ${route}: ${body}`);
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Zotero local API returned invalid JSON for ${route}: ${error.message}`);
  }
}

function pagedRoute(route, start, limit) {
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}format=json&limit=${limit}&start=${start}`;
}

async function listAll(baseURL, route) {
  const output = [];
  let start = 0;
  let previousLastKey = null;
  for (;;) {
    const page = await getJSON(baseURL, pagedRoute(route, start, PAGE_SIZE));
    if (!Array.isArray(page)) throw new Error(`Expected an array from ${route}`);
    if (!page.length) break;
    const lastKey = page.at(-1)?.key ?? null;
    if (start > 0 && lastKey === previousLastKey) {
      throw new Error(`Zotero local API pagination did not advance for ${route}`);
    }
    output.push(...page);
    previousLastKey = lastKey;
    if (page.length < PAGE_SIZE) break;
    start += page.length;
  }
  return output;
}

async function listCollections(apiBaseUrl) {
  return listAll(apiBaseUrl, "/api/users/0/collections");
}

export async function resolveCollection(collectionRef, { apiBaseUrl = DEFAULT_API_BASE_URL } = {}) {
  if (typeof collectionRef !== "string" || !collectionRef.length) {
    throw new Error("collection must be a non-empty collection key or exact name");
  }
  const collections = await listCollections(apiBaseUrl);
  const keyMatches = collections.filter(collection => collection.key === collectionRef);
  const nameMatches = collections.filter(collection => collection.data?.name === collectionRef);
  const matches = keyMatches.length ? keyMatches : nameMatches;
  if (!matches.length) throw new Error(`Collection not found: ${collectionRef}`);
  if (matches.length > 1) {
    throw new Error(`Collection name is not unique: ${collectionRef}`);
  }
  const collection = matches[0];
  return {
    key: collection.key,
    name: collection.data?.name ?? collectionRef,
    libraryID: collection.library?.id ?? null,
  };
}

function itemData(item) {
  return item?.data ?? {};
}

function isPDFAttachment(item) {
  const data = itemData(item);
  const enclosureType = item?.links?.enclosure?.type;
  return data.itemType === "attachment" && (
    data.contentType === "application/pdf" ||
    enclosureType === "application/pdf" ||
    String(data.filename ?? "").toLowerCase().endsWith(".pdf")
  );
}

function isPaperItem(item) {
  const type = itemData(item).itemType;
  return type && !["attachment", "annotation", "note"].includes(type);
}

async function getCollectionItems(collectionKey, { apiBaseUrl }) {
  return listAll(
    apiBaseUrl,
    `/api/users/0/collections/${encodeURIComponent(collectionKey)}/items`,
  );
}

async function getItem(itemKey, { apiBaseUrl }) {
  return getJSON(apiBaseUrl, `/api/users/0/items/${encodeURIComponent(itemKey)}`);
}

async function getChildren(itemKey, { apiBaseUrl }) {
  return listAll(
    apiBaseUrl,
    `/api/users/0/items/${encodeURIComponent(itemKey)}/children`,
  );
}

function makePaper(paperItem, attachment = null) {
  return {
    itemKey: paperItem?.key ?? null,
    attachmentKey: attachment?.key ?? null,
    title: itemData(paperItem).title ?? attachment?.data?.filename ?? null,
    item: paperItem,
    attachment,
    attachments: attachment ? [attachment] : [],
  };
}

async function collectPapers(collection, { apiBaseUrl }) {
  const records = await getCollectionItems(collection.key, { apiBaseUrl });
  const byKey = new Map(records.filter(item => item?.key).map(item => [item.key, item]));
  const papers = new Map();

  const ensurePaper = (paperKey, paperItem, attachment) => {
    const mapKey = paperKey ?? `attachment:${attachment.key}`;
    let paper = papers.get(mapKey);
    if (!paper) {
      paper = makePaper(paperItem, null);
      papers.set(mapKey, paper);
    }
    if (attachment && !paper.attachments.some(candidate => candidate.key === attachment.key)) {
      paper.attachments.push(attachment);
      if (!paper.attachmentKey) paper.attachmentKey = attachment.key;
      if (!paper.title) paper.title = attachment.data?.filename ?? attachment.key;
    }
    return paper;
  };

  for (const record of records) {
    if (!isPDFAttachment(record)) continue;
    const parentKey = itemData(record).parentItem ?? null;
    if (!parentKey) {
      ensurePaper(null, null, record);
      continue;
    }
    const parent = byKey.get(parentKey) ?? await getItem(parentKey, { apiBaseUrl });
    if (isPaperItem(parent)) ensurePaper(parentKey, parent, record);
  }

  for (const record of records) {
    if (!isPaperItem(record)) continue;
    const paper = papers.get(record.key) ?? ensurePaper(record.key, record, null);
    if (paper.attachments.length) continue;
    const children = await getChildren(record.key, { apiBaseUrl });
    for (const child of children) {
      if (isPDFAttachment(child)) ensurePaper(record.key, record, child);
    }
  }

  return [...papers.values()]
    .filter(paper => paper.attachments.length)
    .map(paper => ({ ...paper, attachment: paper.attachments[0] }));
}

function planEntries(rawPlan) {
  if (rawPlan && typeof rawPlan === "object" && rawPlan.attachmentKey) {
    return [rawPlan];
  }
  if (Array.isArray(rawPlan)) return rawPlan;
  for (const property of ["items", "papers", "plans"]) {
    if (Array.isArray(rawPlan?.[property])) return rawPlan[property];
  }
  throw new Error("Plan must contain attachmentKey or an items/papers/plans array");
}

function hasAnalysisPayload(plan) {
  const sources = [plan?.annotation_plan, plan?.analysis, plan]
    .filter(source => source && typeof source === "object");
  return sources.some(source => Array.isArray(source.annotations) || [
    "research_purpose",
    "research_gap",
    "research_method",
    "research_result",
  ].some(category => Array.isArray(source[category])));
}

function indexPlans(rawPlan) {
  const byAttachment = new Map();
  const byItem = new Map();
  for (const entry of planEntries(rawPlan)) {
    if (!entry || typeof entry !== "object") throw new Error("Each plan entry must be an object");
    const plan = entry.plan && typeof entry.plan === "object"
      ? {
        ...entry.plan,
        itemKey: entry.itemKey ?? entry.plan.itemKey,
        attachmentKey: entry.attachmentKey ?? entry.plan.attachmentKey,
      }
      : entry;
    if (!hasAnalysisPayload(plan)) {
      throw new Error("Each plan entry must contain annotations or the four-category analysis schema");
    }
    if (plan.attachmentKey) {
      if (byAttachment.has(plan.attachmentKey)) {
        throw new Error(`Duplicate plan for attachment ${plan.attachmentKey}`);
      }
      byAttachment.set(plan.attachmentKey, plan);
    }
    if (plan.itemKey) {
      if (byItem.has(plan.itemKey)) throw new Error(`Duplicate plan for item ${plan.itemKey}`);
      byItem.set(plan.itemKey, plan);
    }
    if (!plan.attachmentKey && !plan.itemKey) {
      throw new Error("Each plan entry needs attachmentKey or itemKey");
    }
  }
  return { byAttachment, byItem };
}

function choosePlan(paper, planIndex) {
  const exact = planIndex.byAttachment.get(paper.attachmentKey);
  if (exact) return { plan: exact, attachment: paper.attachments.find(item => item.key === paper.attachmentKey) };
  const byItem = paper.itemKey ? planIndex.byItem.get(paper.itemKey) : null;
  if (!byItem) return { plan: null, attachment: null };
  if (byItem.attachmentKey) {
    const attachment = paper.attachments.find(item => item.key === byItem.attachmentKey);
    return { plan: attachment ? byItem : null, attachment };
  }
  if (paper.attachments.length !== 1) {
    return { plan: byItem, attachment: null };
  }
  return { plan: { ...byItem, attachmentKey: paper.attachments[0].key }, attachment: paper.attachments[0] };
}

async function readAudit(auditPath) {
  try {
    const content = await readFile(auditPath, "utf8");
    const latest = new Map();
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      const record = JSON.parse(line);
      const key = `${record.itemKey ?? ""}|${record.attachmentKey ?? ""}`;
      latest.set(key, record);
    }
    return latest;
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
}

async function appendAudit(auditPath, record) {
  const absolute = resolve(auditPath);
  await mkdir(dirname(absolute), { recursive: true });
  await appendFile(absolute, `${JSON.stringify(record)}\n`, "utf8");
}

function classifyOutcome(outcome) {
  if (outcome.status === "completed") return "completed";
  const skipped = outcome.skipped ?? [];
  if (skipped.some(item => item.reason === "ambiguous")) return "ambiguous";
  if (skipped.length && skipped.every(item => item.reason === "not_found")) return "no_text";
  if (outcome.writer?.status === "failed" || outcome.error) return "failed";
  if (outcome.status === "partial" || outcome.writer?.status === "partial") return "partial";
  return outcome.status ?? "failed";
}

function plannedAnnotationCount(plan) {
  try {
    return normalizeAnalysisPlan(plan).annotations.length;
  } catch {
    return null;
  }
}

function summaryStatus(results) {
  const statuses = results.map(result => result.status).filter(status => status !== "skipped_completed");
  if (!statuses.length || statuses.every(status => status === "completed")) return "completed";
  if (statuses.some(status => status === "failed")) return "failed";
  if (statuses.some(status => status === "partial")) return "partial";
  if (statuses.some(status => status === "ambiguous")) return "ambiguous";
  if (statuses.every(status => status === "no_text")) return "no_text";
  if (statuses.some(status => status === "no_pdf")) return "no_pdf";
  return "partial";
}

export async function runCollection({
  collection,
  plan,
  apply = false,
  createNote = false,
  force = false,
  auditPath = DEFAULT_AUDIT_PATH,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  ...options
} = {}) {
  if (!plan) throw new Error("plan is required; analysis is supplied once as JSON");
  const collectionInfo = await resolveCollection(collection, { apiBaseUrl });
  const rawPlan = typeof plan === "string"
    ? JSON.parse(await readFile(plan, "utf8"))
    : plan;
  const planIndex = indexPlans(rawPlan);
  const papers = await collectPapers(collectionInfo, { apiBaseUrl });
  const latestAudit = await readAudit(auditPath);
  const results = [];

  for (const paper of papers) {
    const auditKey = `${paper.itemKey ?? ""}|${paper.attachmentKey ?? ""}`;
    const previous = latestAudit.get(auditKey);
    if (!force && previous?.status === "completed") {
      results.push({
        itemKey: paper.itemKey,
        attachmentKey: paper.attachmentKey,
        status: "skipped_completed",
        previous,
      });
      continue;
    }

    const selected = choosePlan(paper, planIndex);
    let result;
    if (paper.attachments.length > 1 && !selected.attachment) {
      result = { status: "ambiguous", reason: "multiple_pdf_attachments", attachmentKeys: paper.attachments.map(item => item.key) };
    } else if (!selected.plan || !selected.attachment) {
      result = { status: "failed", reason: "missing_or_mismatched_analysis_plan" };
    } else {
      try {
        const outcome = await annotatePlan(
          { ...selected.plan, attachmentKey: selected.attachment.key },
          { apply, createNote, ...options },
        );
        result = { status: classifyOutcome(outcome), outcome };
      } catch (error) {
        result = { status: "failed", error: String(error?.message || error) };
      }
    }

    const auditRecord = {
      timestamp: new Date().toISOString(),
      collectionKey: collectionInfo.key,
      collectionName: collectionInfo.name,
      itemKey: paper.itemKey,
      attachmentKey: paper.attachmentKey,
      title: paper.title,
      status: result.status,
      apply,
      totalPages: result.outcome?.coverage?.totalPages ?? null,
      pagesInspected: result.outcome?.coverage?.pagesInspected ?? null,
      coverageComplete: result.outcome?.coverage?.coverageComplete ?? false,
      understandingComplete: result.outcome?.semantic?.understandingComplete ?? false,
      annotationCoverageComplete: result.outcome?.annotationCoverage?.annotationCoverageComplete ?? false,
      paperModelBuilt: result.outcome?.semantic?.paperModelBuilt ?? false,
      methodSteps: result.outcome?.semantic?.methodSteps ?? 0,
      methodStepsCovered: result.outcome?.annotationCoverage?.methodStepsCovered ?? 0,
      keyResults: result.outcome?.annotationCoverage?.keyResults ?? 0,
      keyResultsCovered: result.outcome?.annotationCoverage?.keyResultsCovered ?? 0,
      requiredModelNodes: result.outcome?.annotationCoverage?.requiredNodeCount ?? 0,
      requiredNodesCovered: result.outcome?.annotationCoverage?.requiredNodesCovered ?? 0,
      requiredNodesSatisfied: result.outcome?.annotationCoverage?.requiredNodesSatisfied ?? 0,
      usefulNodesAnnotated: result.outcome?.annotationCoverage?.usefulNodesAnnotated ?? 0,
      annotationDiagnostics: result.outcome?.annotationCoverage?.diagnostics ?? [],
      plannedAnnotations: plannedAnnotationCount(selected.plan),
      created: result.outcome?.writer?.created?.length ?? 0,
      alreadyExists: result.outcome?.writer?.already_exists?.length ?? 0,
      skippedAmbiguous: result.outcome?.skipped?.filter(item => item.reason === "ambiguous").length ?? 0,
      result,
    };
    await appendAudit(auditPath, auditRecord);
    results.push(auditRecord);
  }

  return {
    collection: collectionInfo,
    auditPath: resolve(auditPath),
    apply,
    createNote,
    paperCount: papers.length,
    status: summaryStatus(results),
    results,
  };
}

function parseCLIArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (["--apply", "--note", "--force"].includes(argument)) {
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
    if (!args.collection) throw new Error("--collection is required");
    if (!args.plan) throw new Error("--plan is required; provide the single analysis JSON or a plan set");
    const result = await runCollection({
      collection: args.collection,
      plan: args.plan,
      apply: !!args.apply,
      createNote: !!args.note,
      force: !!args.force,
      auditPath: args.audit ?? DEFAULT_AUDIT_PATH,
      apiBaseUrl: args.api_base_url ?? DEFAULT_API_BASE_URL,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
