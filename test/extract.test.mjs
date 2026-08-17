import assert from "node:assert/strict";
import test from "node:test";
import { buildFullTextResult } from "../src/extract.mjs";

function char(u, flags = {}) {
  return {
    u,
    c: u,
    ignorable: false,
    spaceAfter: false,
    lineBreakAfter: false,
    paragraphBreakAfter: false,
    ...flags,
  };
}

test("full-text result preserves every page and Reader spacing semantics", () => {
  const result = buildFullTextResult({
    attachmentKey: "ATTACHMENT",
    pdfPages: [
      { chars: [char("Page", { spaceAfter: true }), char("one", { lineBreakAfter: true })] },
      { chars: [] },
      { chars: [char("Page"), char("three", { paragraphBreakAfter: true })] },
    ],
  });

  assert.equal(result.totalPages, 3);
  assert.equal(result.pagesWithUsableText, 2);
  assert.deepEqual(result.pages.map(page => page.pageIndex), [0, 1, 2]);
  assert.equal(result.pages[0].text, "Page one ");
  assert.equal(result.pages[1].text, "");
  assert.equal(result.pages[2].text, "Pagethree ");
});
