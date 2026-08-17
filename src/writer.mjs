import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CATEGORY_CONFIG = Object.freeze({
  research_purpose: Object.freeze({ tag: "研究目的", color: "#ffd400" }),
  research_gap: Object.freeze({ tag: "研究缺口", color: "#2ea8e5" }),
  research_method: Object.freeze({ tag: "研究方法", color: "#ff6666" }),
  research_result: Object.freeze({ tag: "研究结果", color: "#5fb236" }),
});

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:23119/cli-bridge/eval";

function validateAnnotation(annotation, index) {
  const config = CATEGORY_CONFIG[annotation?.category];
  if (!config) throw new Error(`annotations[${index}].category is unsupported`);
  if (typeof annotation.exactText !== "string" || !annotation.exactText.length) {
    throw new Error(`annotations[${index}].exactText must be non-empty`);
  }
  if (!Number.isInteger(annotation.pageIndex) || annotation.pageIndex < 0) {
    throw new Error(`annotations[${index}].pageIndex must be a non-negative integer`);
  }
  if (
    !Array.isArray(annotation.rects) ||
    annotation.rects.length === 0 ||
    annotation.rects.some(
      (rect) =>
        !Array.isArray(rect) ||
        rect.length !== 4 ||
        rect.some((value) => typeof value !== "number" || !Number.isFinite(value)),
    )
  ) {
    throw new Error(`annotations[${index}].rects must contain numeric four-value rectangles`);
  }
  if (typeof annotation.sortIndex !== "string" || !annotation.sortIndex.length) {
    throw new Error(`annotations[${index}].sortIndex must be non-empty`);
  }
  if (typeof annotation.commentZh !== "string") {
    throw new Error(`annotations[${index}].commentZh must be a string`);
  }
  return config;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("writer input must be an object");
  if (typeof plan.attachmentKey !== "string" || !plan.attachmentKey.length) {
    throw new Error("attachmentKey must be non-empty");
  }
  if (!Array.isArray(plan.annotations)) throw new Error("annotations must be an array");
  plan.annotations.forEach(validateAnnotation);
  return plan;
}

function identityKey(pageIndex, rects, categoryTag) {
  return JSON.stringify([pageIndex, rects, categoryTag]);
}

function buildBridgeScript(plan) {
  const request = JSON.stringify(plan);
  return `
const request = ${request};
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

const categoryConfig = ${JSON.stringify(CATEGORY_CONFIG)};
const positionKey = (pageIndex, rects, tag) => JSON.stringify([pageIndex, rects, tag]);
const annotationPosition = annotation => {
  try {
    return typeof annotation.annotationPosition === 'string'
      ? JSON.parse(annotation.annotationPosition)
      : annotation.annotationPosition;
  } catch (_) {
    return null;
  }
};
const existing = attachment.getAnnotations(false);
const known = new Map();
for (const annotation of existing) {
  const position = annotationPosition(annotation);
  if (!position || !Array.isArray(position.rects)) continue;
  const tags = annotation.getTags().map(tag => tag.tag);
  for (const tag of tags) {
    known.set(positionKey(position.pageIndex, position.rects, tag), annotation.key);
  }
}

const output = {
  attachmentKey: request.attachmentKey,
  attachmentItemID: attachment.id,
  created: [],
  already_exists: [],
  failures: [],
};

for (let index = 0; index < request.annotations.length; index++) {
  const specification = request.annotations[index];
  const config = categoryConfig[specification.category];
  const key = positionKey(specification.pageIndex, specification.rects, config.tag);
  if (known.has(key)) {
    output.already_exists.push({
      index,
      category: specification.category,
      tag: config.tag,
      annotationKey: known.get(key),
      pageIndex: specification.pageIndex,
      rects: specification.rects,
    });
    continue;
  }

  try {
    let annotationKey;
    do {
      annotationKey = Zotero.Utilities.generateObjectKey();
    } while (Zotero.Items.getByLibraryAndKey(attachment.libraryID, annotationKey));

    const json = {
      key: annotationKey,
      type: 'highlight',
      text: specification.exactText,
      comment: specification.commentZh,
      color: config.color,
      pageLabel: specification.pageLabel ?? String(specification.pageIndex + 1),
      sortIndex: specification.sortIndex,
      position: {
        pageIndex: specification.pageIndex,
        rects: specification.rects,
      },
      tags: [{ name: config.tag }],
      isExternal: false,
    };
    const saved = await Zotero.Annotations.saveFromJSON(attachment, json, { skipSelect: true });
    known.set(key, saved.key);
    output.created.push({
      index,
      annotationKey: saved.key,
      category: specification.category,
      tag: config.tag,
      color: config.color,
      annotationType: saved.annotationType,
      annotationIsExternal: saved.annotationIsExternal,
      pageIndex: specification.pageIndex,
      rects: specification.rects,
    });
  } catch (error) {
    output.failures.push({
      index,
      category: specification.category,
      error: String(error?.message || error),
    });
  }
}

output.status = output.failures.length
  ? (output.created.length || output.already_exists.length ? 'partial' : 'failed')
  : 'completed';
return output;
`;
}

async function bridgeEval(code, { bridgeUrl = DEFAULT_BRIDGE_URL, timeoutMs = 30_000 } = {}) {
  const url = new URL(bridgeUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`Refusing non-local Zotero bridge URL: ${bridgeUrl}`);
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: code,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  if (!response.ok) {
    throw new Error(typeof parsed === 'object' ? parsed.error || JSON.stringify(parsed) : String(parsed));
  }
  return parsed;
}

export async function executeZoteroJS(code, options = {}) {
  return bridgeEval(code, options);
}

export async function writeAnnotations(plan, options = {}) {
  validatePlan(plan);
  const result = await bridgeEval(buildBridgeScript(plan), options);
  if (!result || typeof result !== 'object') {
    throw new Error(`Unexpected Zotero bridge result: ${JSON.stringify(result)}`);
  }
  return result;
}

function parseCLIArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--apply') {
      args.apply = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    args[argument.slice(2).replaceAll('-', '_')] = argv[++index];
  }
  return args;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const args = parseCLIArgs(process.argv.slice(2));
    if (!args.plan) throw new Error('--plan is required');
    const plan = JSON.parse(await readFile(args.plan, 'utf8'));
    validatePlan(plan);
    if (!args.apply) {
      console.log(JSON.stringify({ status: 'dry_run', attachmentKey: plan.attachmentKey, annotations: plan.annotations.length }, null, 2));
    } else {
      console.log(JSON.stringify(await writeAnnotations(plan), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
