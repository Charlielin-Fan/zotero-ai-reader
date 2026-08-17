import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getSearchableTextFromChars,
  loadPDFPages,
  makeUIState,
} from "./locator.mjs";

/**
 * Convert the installed Zotero PDF.js structured page objects into a complete
 * page-preserving text result. Text is the Reader-compatible searchable stream
 * (including synthetic spacing); it is never truncated or joined across page
 * boundaries.
 */
export function buildFullTextResult({
  attachmentKey,
  pdfPages,
  annotationIntegrity = null,
  uiState = makeUIState(),
} = {}) {
  if (!Array.isArray(pdfPages)) throw new Error("pdfPages must be an array");
  const pages = pdfPages.map((page, pageIndex) => ({
    pageIndex,
    text: getSearchableTextFromChars(page?.chars ?? []),
  }));
  return {
    attachmentKey,
    totalPages: pages.length,
    pagesWithUsableText: pages.filter(page => page.text.trim().length > 0).length,
    pages,
    ...(annotationIntegrity ? { annotationIntegrity } : {}),
    uiState,
  };
}

/**
 * Extract every usable page through Zotero 9.0.6's bundled PDF.js runtime.
 * This is read-only and does not open a visible Reader tab.
 */
export async function extractFullText({
  attachmentKey,
  apiBaseUrl,
  omniPath,
  runtimeDir,
} = {}) {
  const loaded = await loadPDFPages({
    attachmentKey,
    apiBaseUrl,
    omniPath,
    runtimeDir,
  });
  return buildFullTextResult({
    attachmentKey,
    pdfPages: loaded.pdfPages,
    annotationIntegrity: loaded.annotationIntegrity,
  });
}

function parseCLIArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2).replaceAll("-", "_");
    if (key === "help" || key === "summary") {
      args[key] = true;
      continue;
    }
    args[key] = argv[++index];
  }
  return args;
}

function printCLIHelp() {
  console.log([
    "Usage:",
    "  node src/extract.mjs --attachment-key KEY [--out PATH] [--summary]",
    "",
    "The command is read-only: it uses Zotero's local API and installed PDF.js worker, never a Reader tab.",
    "--out stores the complete page-preserving JSON outside the repository when desired.",
  ].join("\n"));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const args = parseCLIArgs(process.argv.slice(2));
    if (args.help) {
      printCLIHelp();
    } else {
      const result = await extractFullText({
        attachmentKey: args.attachment_key,
        apiBaseUrl: args.api_base_url,
        omniPath: args.omni_path,
      });
      const serialized = JSON.stringify(result, null, 2);
      if (args.out) {
        await writeFile(resolve(args.out), `${serialized}\n`, "utf8");
        console.log(JSON.stringify({
          attachmentKey: result.attachmentKey,
          totalPages: result.totalPages,
          pagesWithUsableText: result.pagesWithUsableText,
          outputPath: resolve(args.out),
          annotationIntegrity: result.annotationIntegrity,
          uiState: result.uiState,
        }, null, 2));
      } else if (args.summary) {
        console.log(JSON.stringify({
          attachmentKey: result.attachmentKey,
          totalPages: result.totalPages,
          pagesWithUsableText: result.pagesWithUsableText,
          annotationIntegrity: result.annotationIntegrity,
          uiState: result.uiState,
        }, null, 2));
      } else {
        console.log(serialized);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}
