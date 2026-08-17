import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { locateText } from "../src/locator.mjs";

// Local/integration-only tests. Supply a private JSON config through
// ZOTERO_INTEGRATION_CONFIG; the public repository contains no Zotero key,
// paper text, or private attachment geometry.
const integrationConfig = process.env.ZOTERO_INTEGRATION === "1" && process.env.ZOTERO_INTEGRATION_CONFIG
  ? JSON.parse(readFileSync(process.env.ZOTERO_INTEGRATION_CONFIG, "utf8"))
  : null;

function assertReadOnly(result, requiredKeys = []) {
  for (const key of requiredKeys) {
    assert.ok(result.annotationIntegrity.annotationKeysBefore.includes(key));
  }
  assert.deepEqual(
    result.annotationIntegrity.annotationKeysAfter,
    result.annotationIntegrity.annotationKeysBefore,
  );
  assert.equal(result.annotationIntegrity.annotationKeysUnchanged, true);
  assert.equal(result.uiState.temporaryReaderCreated, false);
  assert.equal(result.uiState.temporaryReaderSelected, false);
  assert.equal(result.uiState.foregroundFocusRequested, false);
  assert.equal(result.uiState.computerUse, false);
  assert.equal(result.uiState.visibleUINavigation, false);
  assert.equal(result.uiState.selectedTabPreserved, true);
}

function assertExpected(result, expected = {}) {
  for (const field of ["status", "candidateCount", "pageIndex", "sortIndex", "matchedText"]) {
    if (expected[field] !== undefined) assert.deepEqual(result[field], expected[field]);
  }
  if (expected.rects !== undefined) assert.deepEqual(result.rects, expected.rects);
  if (expected.candidates !== undefined) assert.deepEqual(result.candidates, expected.candidates);
}

if (!integrationConfig) {
  test("local Zotero locator integration tests (set ZOTERO_INTEGRATION=1 and ZOTERO_INTEGRATION_CONFIG)", {
    skip: "requires a user-supplied local Zotero integration config",
  }, () => {});
} else {
  for (const testCase of integrationConfig.cases ?? []) {
    test(testCase.name ?? "configured locator case", async () => {
      const result = await locateText({
        attachmentKey: integrationConfig.attachmentKey,
        exactText: testCase.exactText,
        contextBefore: testCase.contextBefore ?? null,
        contextAfter: testCase.contextAfter ?? null,
      });
      assertExpected(result, testCase.expected);
      assertReadOnly(result, integrationConfig.requiredAnnotationKeys ?? []);
    });
  }
}
