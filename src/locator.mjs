import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:23119";
const DEFAULT_OMNI_JA = "C:\\Program Files\\Zotero\\app\\omni.ja";
const PDF_MJS_ENTRY = "resource/reader/pdf/build/pdf.mjs";
const PDF_WORKER_ENTRY = "resource/reader/pdf/build/pdf.worker.mjs";

/**
 * The local Zotero connector API is read-only for this module. It is used for
 * attachment resolution and for the before/after annotation-key safety check.
 */
async function getResponse(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Zotero local API ${response.status} for ${url}`);
  }
  return response;
}

async function getJSON(url) {
  return (await getResponse(url)).json();
}

function apiURL(baseURL, path) {
  const normalizedBase = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
  return `${normalizedBase}${path}`;
}

async function resolveAttachmentFile({ attachmentKey, apiBaseUrl }) {
  const url = apiURL(
    apiBaseUrl,
    `/api/users/0/items/${encodeURIComponent(attachmentKey)}/file/view/url`,
  );
  const response = await getResponse(url);
  const body = (await response.text()).trim();
  let fileURL = body;

  // The installed local endpoint currently returns a plain file: URL. Keep a
  // small compatibility branch for a JSON string/object response as well.
  try {
    const parsed = JSON.parse(body);
    fileURL = typeof parsed === "string" ? parsed : parsed.url ?? parsed.href;
  } catch {
    // Plain text is the installed response shape.
  }

  if (typeof fileURL !== "string" || !fileURL.startsWith("file:")) {
    throw new Error(`Attachment endpoint did not return a file URL: ${body}`);
  }
  return fileURLToPath(fileURL);
}

async function readAnnotationKeys({ attachmentKey, apiBaseUrl }) {
  // The local API accepts itemType=annotation but, in the installed build,
  // does not consistently apply parentItem as a server-side filter. Filter
  // parentItem locally and never request or mutate a database file.
  const url = apiURL(
    apiBaseUrl,
    "/api/users/0/items?itemType=annotation&format=json&limit=10000",
  );
  const items = await getJSON(url);
  return items
    .filter(
      (item) =>
        item?.data?.itemType === "annotation" &&
        item?.data?.parentItem === attachmentKey,
    )
    .map((item) => item.key)
    .sort();
}

function execFileAsync(file, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${file} failed: ${stderr || error.message}`));
          return;
        }
        resolvePromise({ stdout, stderr });
      },
    );
  });
}

async function ensurePDFRuntime({ omniPath = DEFAULT_OMNI_JA, runtimeDir = null }) {
  const absoluteOmniPath = resolve(omniPath);
  const omniStat = await stat(absoluteOmniPath);
  const cacheKey = createHash("sha256")
    .update(`${absoluteOmniPath}|${omniStat.size}|${omniStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 20);
  const outputDir = runtimeDir
    ? resolve(runtimeDir)
    : join(tmpdir(), `codex-zotero-pdf-runtime-${cacheKey}`);
  const pdfPath = join(outputDir, "pdf.mjs");
  const workerPath = join(outputDir, "pdf.worker.mjs");

  try {
    await Promise.all([
      access(pdfPath, fsConstants.R_OK),
      access(workerPath, fsConstants.R_OK),
    ]);
    return { outputDir, pdfPath, workerPath };
  } catch {
    // Extract only the two installed Zotero PDF.js modules into a temporary
    // cache. This is not a project-file write and installs no dependency.
  }

  await mkdir(outputDir, { recursive: true });
  const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const extractionScript = String.raw`
Add-Type -AssemblyName System.IO.Compression.FileSystem
$OmniPath = ${quotePowerShell(absoluteOmniPath)}
$OutputPath = ${quotePowerShell(outputDir)}
$archive = [System.IO.Compression.ZipFile]::OpenRead($OmniPath)
try {
  foreach ($entryName in @('${PDF_MJS_ENTRY}', '${PDF_WORKER_ENTRY}')) {
    $entry = $archive.GetEntry($entryName)
    if ($null -eq $entry) { throw "Missing omni.ja entry: $entryName" }
    $target = Join-Path $OutputPath ([System.IO.Path]::GetFileName($entryName))
    $sourceStream = $entry.Open()
    $targetStream = [System.IO.File]::Open($target, [System.IO.FileMode]::Create)
    try { $sourceStream.CopyTo($targetStream) } finally { $targetStream.Dispose(); $sourceStream.Dispose() }
  }
} finally {
  $archive.Dispose()
}
`;
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
  "-Command",
  extractionScript,
  ]);
  await Promise.all([
    access(pdfPath, fsConstants.R_OK),
    access(workerPath, fsConstants.R_OK),
  ]);
  return { outputDir, pdfPath, workerPath };
}

function installMinimalDOMMatrix() {
  if (globalThis.DOMMatrix) return;

  // The installed browser PDF.js build only needs a small DOMMatrix surface
  // for import and text-page processing in Node. No canvas or PDF library is
  // introduced here.
  class DOMMatrix {
    constructor(init = undefined) {
      const values = Array.isArray(init) ? init : null;
      this.a = values?.[0] ?? init?.a ?? 1;
      this.b = values?.[1] ?? init?.b ?? 0;
      this.c = values?.[2] ?? init?.c ?? 0;
      this.d = values?.[3] ?? init?.d ?? 1;
      this.e = values?.[4] ?? init?.e ?? 0;
      this.f = values?.[5] ?? init?.f ?? 0;
    }

    multiplySelf(other) {
      const a = this.a * other.a + this.c * other.b;
      const b = this.b * other.a + this.d * other.b;
      const c = this.a * other.c + this.c * other.d;
      const d = this.b * other.c + this.d * other.d;
      const e = this.a * other.e + this.c * other.f + this.e;
      const f = this.b * other.e + this.d * other.f + this.f;
      Object.assign(this, { a, b, c, d, e, f });
      return this;
    }

    preMultiplySelf(other) {
      return new DOMMatrix(other).multiplySelf(this).copyTo(this);
    }

    translate(tx, ty) {
      return new DOMMatrix(this).multiplySelf(new DOMMatrix([1, 0, 0, 1, tx, ty]));
    }

    scale(sx, sy = sx) {
      return new DOMMatrix(this).multiplySelf(new DOMMatrix([sx, 0, 0, sy, 0, 0]));
    }

    invertSelf() {
      const determinant = this.a * this.d - this.b * this.c;
      if (!determinant) throw new Error("DOMMatrix is not invertible");
      const { a, b, c, d, e, f } = this;
      Object.assign(this, {
        a: d / determinant,
        b: -b / determinant,
        c: -c / determinant,
        d: a / determinant,
        e: (c * f - d * e) / determinant,
        f: (b * e - a * f) / determinant,
      });
      return this;
    }

    copyTo(target) {
      Object.assign(target, this);
      return target;
    }
  }
  globalThis.DOMMatrix = DOMMatrix;
}

let pdfjsPromise;
async function loadPDFJS(runtime) {
  installMinimalDOMMatrix();
  pdfjsPromise ??= import(pathToFileURL(runtime.pdfPath).href);
  const pdfjs = await pdfjsPromise;
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(runtime.workerPath).href;
  return pdfjs;
}

function rectsDist(rectA, rectB) {
  const [a1, b1, a2, b2] = rectA;
  const [c1, d1, c2, d2] = rectB;
  if (a1 <= c2 && c1 <= a2 && b1 <= d2 && d1 <= b2) return 0;
  const dx = Math.max(c1 - a2, a1 - c2, 0);
  const dy = Math.max(d1 - b2, b1 - d2, 0);
  return Math.sqrt(dx ** 2 + dy ** 2);
}

function getClosestOffset(chars, rect) {
  let closestOffset = 0;
  let minDistance = Infinity;
  for (let i = 0; i < chars.length; i++) {
    const distance = rectsDist(chars[i].rect, rect);
    if (distance < minDistance) {
      // Installed reader.js returns the array index, not char.offset.
      closestOffset = i;
      minDistance = distance;
    }
  }
  return closestOffset;
}

function getRectsFromChars(chars) {
  const lineRects = [];
  let currentLineRect = null;
  for (const char of chars) {
    if (!currentLineRect) {
      currentLineRect = char.inlineRect.slice();
    }
    currentLineRect = [
      Math.min(currentLineRect[0], char.inlineRect[0]),
      Math.min(currentLineRect[1], char.inlineRect[1]),
      Math.max(currentLineRect[2], char.inlineRect[2]),
      Math.max(currentLineRect[3], char.inlineRect[3]),
    ];
    if (char.lineBreakAfter) {
      lineRects.push(currentLineRect);
      currentLineRect = null;
    }
  }
  if (currentLineRect) lineRects.push(currentLineRect);
  return lineRects.map((rect) =>
    rect.map((value) => parseFloat(value.toFixed(3))),
  );
}

export function getTextFromChars(chars) {
  const text = [];
  for (const char of chars) {
    if (!char.ignorable) {
      text.push(char.c);
      if (char.spaceAfter || char.lineBreakAfter) text.push(" ");
    }
    if (!char.ignorable && char.paragraphBreakAfter) text.push(" ");
  }
  return text.join("").trim();
}

function getTopMostRectFromPosition(position) {
  return position?.rects?.slice().sort((a, b) => b[2] - a[2])[0];
}

function getSortIndex(pdfPages, position) {
  const pageIndex = position.pageIndex;
  let offset = 0;
  let top = 0;
  if (pdfPages[pageIndex]) {
    const page = pdfPages[pageIndex];
    const rect = getTopMostRectFromPosition(position);
    offset = page.chars.length && getClosestOffset(page.chars, rect);
    const pageHeight = page.viewBox[3] - page.viewBox[1];
    top = pageHeight - rect[3];
    if (top < 0) top = 0;
  }
  return [
    String(pageIndex).slice(0, 5).padStart(5, "0"),
    String(offset).slice(0, 6).padStart(6, "0"),
    String(Math.floor(top)).slice(0, 5).padStart(5, "0"),
  ].join("|");
}

function normalizeWithMap(text, sourceMap = null) {
  let normalized = "";
  const normalizedMap = [];
  for (let index = 0; index < text.length; ) {
    const codePoint = String.fromCodePoint(text.codePointAt(index));
    const replacement = codePoint.normalize("NFD");
    normalized += replacement;
    if (sourceMap) {
      for (let offset = 0; offset < replacement.length; offset++) {
        normalizedMap.push(sourceMap[index]);
      }
    }
    index += codePoint.length;
  }
  return sourceMap ? { text: normalized, map: normalizedMap } : normalized;
}

function buildSearchStream(chars) {
  let text = "";
  const map = [];
  for (let charIndex = 0; charIndex < chars.length; charIndex++) {
    const char = chars[charIndex];
    // PDFFindController._extractText uses char.u and maps every UTF-16 code
    // unit back to the underlying structured character.
    const searchable = String(char.u ?? "");
    text += searchable;
    for (let offset = 0; offset < searchable.length; offset++) {
      map.push(charIndex);
    }
    if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) {
      text += " ";
      map.push(charIndex);
    }
  }
  return normalizeWithMap(text, map);
}

/**
 * Return the same searchable page text used by the installed Reader search
 * path. The returned text is intentionally not trimmed: page boundaries and
 * the Reader's synthetic spacing are part of the extraction contract.
 */
export function getSearchableTextFromChars(chars) {
  return buildSearchStream(chars).text;
}

function findAllOccurrences(haystack, needle) {
  const occurrences = [];
  if (!needle.length) return occurrences;
  for (let start = 0; ; ) {
    start = haystack.indexOf(needle, start);
    if (start === -1) break;
    occurrences.push({ start, end: start + needle.length });
    start += 1;
  }
  return occurrences;
}

function candidateFromOccurrence({ pageIndex, pageData, stream, occurrence, pdfPages }) {
  const firstCharIndex = stream.map[occurrence.start];
  const lastCharIndex = stream.map[occurrence.end - 1];
  if (firstCharIndex === undefined || lastCharIndex === undefined) return null;
  const selectedChars = pageData.chars.slice(firstCharIndex, lastCharIndex + 1);
  if (!selectedChars.length) return null;
  const position = { pageIndex, rects: getRectsFromChars(selectedChars) };
  return {
    pageIndex,
    rects: position.rects,
    sortIndex: getSortIndex(pdfPages, position),
    matchedText: getTextFromChars(selectedChars),
    _searchStart: occurrence.start,
    _searchEnd: occurrence.end,
  };
}

function stripInternalCandidateFields(candidate) {
  const { _searchStart, _searchEnd, _stream, ...publicCandidate } = candidate;
  return publicCandidate;
}

function filterByContext(candidates, stream, contextBefore, contextAfter) {
  const before = contextBefore == null ? null : normalizeWithMap(String(contextBefore));
  const after = contextAfter == null ? null : normalizeWithMap(String(contextAfter));
  return candidates.filter((candidate) => {
    const prefix = stream.text.slice(0, candidate._searchStart);
    const suffix = stream.text.slice(candidate._searchEnd);
    return (
      (before == null || prefix.endsWith(before)) &&
      (after == null || suffix.startsWith(after))
    );
  });
}

export function makeUIState() {
  return {
    // The local Zotero API does not expose private tab-selection state. This
    // locator makes zero tab calls, so these values are deliberately explicit
    // rather than invented identifiers.
    selectedTabBefore: "[UNVERIFIED] not-observable-via-local-api",
    selectedTabDuring: "[UNVERIFIED] not-observable-via-local-api",
    selectedTabAfter: "[UNVERIFIED] not-observable-via-local-api",
    selectedTabPreserved: true,
    temporaryReaderCreated: false,
    temporaryReaderSelected: false,
    foregroundFocusRequested: false,
    computerUse: false,
    visibleUINavigation: false,
    note: "No Zotero.Reader tab was opened; the installed PDF.js worker was used directly.",
  };
}

/**
 * Load every PDF page through the PDF.js modules bundled in the installed
 * Zotero 9.0.6 omni.ja. This creates a PDF.js document in the background; it
 * does not create or select a Zotero Reader tab and it performs no library
 * writes. The returned page objects are the structured page data consumed by
 * the locator's geometry and sort-index functions.
 */
export async function loadPDFPages({
  attachmentKey,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  omniPath = DEFAULT_OMNI_JA,
  runtimeDir = null,
} = {}) {
  if (!attachmentKey) throw new Error("attachmentKey is required");

  const annotationKeysBefore = await readAnnotationKeys({ attachmentKey, apiBaseUrl });
  const filePath = await resolveAttachmentFile({ attachmentKey, apiBaseUrl });
  const runtime = await ensurePDFRuntime({ omniPath, runtimeDir });
  const pdfjs = await loadPDFJS(runtime);
  const pdfDocument = await pdfjs
    .getDocument({
      data: new Uint8Array(await readFile(filePath)),
      useWorkerFetch: false,
      isEvalSupported: false,
    })
    .promise;

  try {
    const pdfPages = [];
    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex++) {
      const pageData = await pdfDocument.getPageData({ pageIndex });
      pdfPages.push({
        chars: pageData.chars,
        viewBox: pageData.viewBox,
      });
    }

    const annotationKeysAfter = await readAnnotationKeys({ attachmentKey, apiBaseUrl });
    const annotationIntegrity = {
      annotationKeysBefore,
      annotationKeysAfter,
      annotationKeysUnchanged:
        JSON.stringify(annotationKeysBefore) === JSON.stringify(annotationKeysAfter),
    };
    if (!annotationIntegrity.annotationKeysUnchanged) {
      throw new Error(
        `Annotation key set changed during read-only PDF load: ${JSON.stringify(annotationIntegrity)}`,
      );
    }

    return {
      pdfPages,
      totalPages: pdfPages.length,
      annotationIntegrity,
    };
  } finally {
    // This is a PDF.js document, not a Zotero Reader tab. Destroy only the
    // background document created by this function.
    await pdfDocument.destroy();
  }
}

/**
 * Locate every exact searchable-text occurrence in an attachment without
 * opening a Zotero Reader tab or writing to the Zotero library.
 */
export async function locateText({
  attachmentKey,
  exactText,
  contextBefore = null,
  contextAfter = null,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  omniPath = DEFAULT_OMNI_JA,
  runtimeDir = null,
} = {}) {
  if (!attachmentKey) throw new Error("attachmentKey is required");
  if (typeof exactText !== "string" || !exactText.length) {
    throw new Error("exactText must be a non-empty string");
  }

  const { pdfPages, annotationIntegrity } = await loadPDFPages({
    attachmentKey,
    apiBaseUrl,
    omniPath,
    runtimeDir,
  });

  const normalizedExactText = normalizeWithMap(exactText);
  const candidates = [];
  for (let pageIndex = 0; pageIndex < pdfPages.length; pageIndex++) {
    const pageData = pdfPages[pageIndex];
    const stream = buildSearchStream(pageData.chars);
    for (const occurrence of findAllOccurrences(stream.text, normalizedExactText)) {
      const candidate = candidateFromOccurrence({
        pageIndex,
        pageData,
        stream,
        occurrence,
        pdfPages,
      });
      if (candidate) candidates.push({ ...candidate, _stream: stream });
    }
  }

  const filteredCandidates = candidates.filter((candidate) => {
    const { _stream: stream } = candidate;
    return filterByContext([candidate], stream, contextBefore, contextAfter).length === 1;
  });
  const publicCandidates = filteredCandidates.map(stripInternalCandidateFields);

  const uiState = makeUIState();
  const common = { annotationIntegrity, uiState };
  if (publicCandidates.length === 0) {
    return { status: "not_found", candidateCount: 0, ...common };
  }
  if (publicCandidates.length > 1) {
    return {
      status: "ambiguous",
      candidateCount: publicCandidates.length,
      candidates: publicCandidates,
      ...common,
    };
  }
  return {
    status: "unique",
    ...publicCandidates[0],
    candidateCount: 1,
    ...common,
  };
}

function parseCLIArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replaceAll("-", "_");
    if (key === "help") return { help: true };
    args[key] = argv[++index];
  }
  return args;
}

function printCLIHelp() {
  console.log(
    [
      "Usage:",
      "  node src/locator.mjs --attachment-key KEY --exact-text TEXT [--context-before TEXT] [--context-after TEXT]",
      "",
      "The command is read-only: it uses Zotero's local API and installed PDF.js worker, never a Reader tab.",
    ].join("\\n"),
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const args = parseCLIArgs(process.argv.slice(2));
    if (args.help) {
      printCLIHelp();
    } else {
      const result = await locateText({
        attachmentKey: args.attachment_key,
        exactText: args.exact_text,
        contextBefore: args.context_before ?? null,
        contextAfter: args.context_after ?? null,
        apiBaseUrl: args.api_base_url ?? DEFAULT_API_BASE_URL,
        omniPath: args.omni_path ?? DEFAULT_OMNI_JA,
      });
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
