import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fromSkillRoot } from "./project-root.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_API_BASE_URL = "http://127.0.0.1:23119";
const SUPPORTED_ZOTERO_VERSION = "9.0.6";
const REQUIRED_PDF_ENTRIES = [
  "resource/reader/pdf/build/pdf.mjs",
  "resource/reader/pdf/build/pdf.worker.mjs",
];

function check(id, ok, detail, value = undefined) {
  return { id, ok: Boolean(ok), detail, ...(value === undefined ? {} : { value }) };
}

async function commandPath(command) {
  try {
    const resolver = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(resolver, [command], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

async function existingPath(path) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findZoteroExecutable() {
  const onPath = await commandPath(process.platform === "win32" ? "zotero.exe" : "zotero");
  if (onPath) return onPath;
  const candidates = process.platform === "win32"
    ? [
      process.env.ProgramFiles && join(process.env.ProgramFiles, "Zotero", "zotero.exe"),
      process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Zotero", "zotero.exe"),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Zotero", "zotero.exe"),
    ]
    : ["/usr/bin/zotero", "/opt/zotero/zotero"];
  for (const candidate of candidates.filter(Boolean)) {
    if (await existingPath(candidate)) return candidate;
  }
  return null;
}

async function findOmniPath(zoteroExecutable) {
  const candidates = [
    process.env.ZOTERO_OMNI_PATH,
    zoteroExecutable ? join(dirname(zoteroExecutable), "app", "omni.ja") : null,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Zotero", "app", "omni.ja"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Zotero", "app", "omni.ja"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Zotero", "app", "omni.ja"),
    "/usr/lib/zotero/omni.ja",
    "/opt/zotero/omni.ja",
  ];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (await existingPath(candidate)) return candidate;
  }
  return null;
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function inspectOmniEntries(omniPath) {
  if (!omniPath) return { ok: false, detail: "Zotero omni.ja was not found" };
  if (process.platform !== "win32") {
    return {
      ok: true,
      detail: "omni.ja is present; archive-entry inspection is not implemented on this platform [UNVERIFIED]",
    };
  }
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShell(omniPath)})
try {
  $required = @(${REQUIRED_PDF_ENTRIES.map(quotePowerShell).join(",")})
  $result = @{}
  foreach ($name in $required) { $result[$name] = $null -ne $archive.GetEntry($name) }
  $result | ConvertTo-Json -Compress
} finally {
  $archive.Dispose()
}
`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout.trim());
    const missing = REQUIRED_PDF_ENTRIES.filter(entry => result[entry] !== true);
    return missing.length
      ? { ok: false, detail: `omni.ja is missing: ${missing.join(", ")}` }
      : { ok: true, detail: "Zotero bundled PDF.js entries are present" };
  } catch (error) {
    return { ok: false, detail: `omni.ja inspection failed: ${error.message}` };
  }
}

async function checkLocalAPI(apiBaseUrl) {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok
      ? check("local_api", true, "Zotero local API responded")
      : check("local_api", false, `Zotero local API returned HTTP ${response.status}`);
  } catch (error) {
    return check("local_api", false, `Zotero local API unreachable: ${error.message}`);
  }
}

async function checkBridge(apiBaseUrl) {
  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/cli-bridge/eval`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "return { version: Zotero.version, server: !!Zotero.Server, endpoint: !!Zotero.Server?.Endpoints?.['/cli-bridge/eval'] };",
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    if (!response.ok) return check("bridge", false, `Bridge returned HTTP ${response.status}`);
    const result = JSON.parse(body);
    const value = result?.value ?? result;
    const ok = Boolean(value?.version && value?.server && value?.endpoint);
    return check(
      "bridge",
      ok,
      ok ? "Local JS bridge and privileged Zotero JS are active" : "Bridge responded but did not confirm privileged JS",
      value,
    );
  } catch (error) {
    return check("bridge", false, `Local JS bridge unavailable: ${error.message}`);
  }
}

export async function runDoctor({ apiBaseUrl = DEFAULT_API_BASE_URL } = {}) {
  const nodeOK = typeof process.versions.node === "string" && typeof fetch === "function";
  const nodeCheck = check(
    "node",
    nodeOK,
    nodeOK ? `Node.js ${process.versions.node} with fetch is available` : "Node.js fetch runtime is unavailable",
    process.versions.node,
  );

  const zoteroExecutable = await findZoteroExecutable();
  const zoteroCheck = check(
    "zotero_install",
    Boolean(zoteroExecutable),
    zoteroExecutable ? `Zotero executable found at ${zoteroExecutable}` : "Zotero executable was not found",
    zoteroExecutable,
  );
  const omniPath = await findOmniPath(zoteroExecutable);
  const omniCheck = check(
    "zotero_pdf_runtime",
    Boolean(omniPath),
    omniPath ? `Zotero omni.ja found at ${omniPath}` : "Zotero omni.ja was not found",
    omniPath,
  );
  const entryInspection = await inspectOmniEntries(omniPath);
  const pdfCheck = check("bundled_pdfjs", entryInspection.ok, entryInspection.detail);

  const cliPath = await commandPath(process.platform === "win32" ? "zotero-cli.exe" : "zotero-cli");
  const cliCheck = check(
    "cli_anything_zotero",
    Boolean(cliPath),
    cliPath ? `zotero-cli is available at ${cliPath}` : "zotero-cli was not found on PATH",
    cliPath,
  );
  const apiCheck = await checkLocalAPI(apiBaseUrl);
  const bridgeCheck = await checkBridge(apiBaseUrl);
  const detectedVersion = bridgeCheck.value?.version ?? null;
  const versionCheck = check(
    "zotero_version",
    detectedVersion === SUPPORTED_ZOTERO_VERSION,
    detectedVersion
      ? detectedVersion === SUPPORTED_ZOTERO_VERSION
        ? `Zotero ${detectedVersion} detected and validated`
        : `Zotero ${detectedVersion} detected; only ${SUPPORTED_ZOTERO_VERSION} is validated`
      : "Zotero version could not be detected",
    detectedVersion,
  );
  const checks = [nodeCheck, zoteroCheck, versionCheck, apiCheck, cliCheck, bridgeCheck, omniCheck, pdfCheck];
  const ok = checks.every(item => item.ok);
  return {
    status: ok ? "ok" : "failed",
    summary: ok
      ? "Zotero AI Reader prerequisites are ready."
      : "Zotero AI Reader prerequisites are incomplete; inspect failed checks.",
    skillRoot: fromSkillRoot(),
    checks,
  };
}

function printHuman(result) {
  console.log(`Zotero AI Reader doctor: ${result.status.toUpperCase()}`);
  for (const item of result.checks) {
    console.log(`${item.ok ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`);
  }
  console.log(result.summary);
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).pathname : null;
if (invokedPath && decodeURIComponent(invokedPath).endsWith("/src/doctor.mjs")) {
  try {
    const result = await runDoctor({ apiBaseUrl: process.env.ZOTERO_API_BASE_URL ?? DEFAULT_API_BASE_URL });
    if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    if (result.status !== "ok") process.exitCode = 1;
  } catch (error) {
    const result = { status: "failed", summary: error.message, checks: [] };
    if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else console.error(`Zotero AI Reader doctor: FAILED\n${error.message}`);
    process.exitCode = 1;
  }
}
