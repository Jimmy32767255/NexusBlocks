import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { createDocument, createProject, serializeDocument } from "@nexus/ir";

const dom = new JSDOM("<!doctype html><html lang=\"en\"><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
});

const { downloadDocument, projectFileName, readDocument } = await import("../src/persist.ts");

function demo() {
  const doc = createDocument(createProject({ name: "demo" }));
  doc.project.name = "demo";
  return doc;
}

describe("project files", () => {
  it("derives a safe file name from the project name", () => {
    const doc = demo();
    assert.equal(projectFileName(doc), "demo.nblk");
    doc.project.name = "a/b:c";
    assert.equal(projectFileName(doc), "a-b-c.nblk");
    doc.project.name = "   ";
    assert.equal(projectFileName(doc), "nexus-blocks.nblk");
  });

  it("round-trips through readDocument", () => {
    const doc = demo();
    const result = readDocument(serializeDocument(doc));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.document.project.name, "demo");
    assert.deepEqual(result.warnings, []);
  });

  it("reads nblk source and still accepts legacy JSON", () => {
    const nblk = readDocument('project "Text"\n\nstart:\n  print "hi"\n');
    assert.equal(nblk.ok, true);
    if (nblk.ok) {
      assert.equal(nblk.document.project.name, "Text");
      assert.equal(nblk.document.project.scripts.length, 1);
    }
    const legacy = readDocument(serializeDocument(demo()));
    assert.equal(legacy.ok, true);
  });

  it("reports invalid files with a line number instead of throwing", () => {
    const json = readDocument("{ not json");
    assert.equal(json.ok, false);
    const nblk = readDocument('project "Bad"\n\nstart:\n  nope 1\n');
    assert.equal(nblk.ok, false);
    if (!nblk.ok) assert.match(nblk.error, /Line 4/);
  });

  it("clicking save produces a download with the project payload", () => {
    const doc = demo();
    const clicks: Array<{ download: string; href: string }> = [];
    const original = dom.window.HTMLAnchorElement.prototype.click;
    dom.window.HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    };
    const urls: string[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (() => {
      const url = "blob:demo";
      urls.push(url);
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    try {
      downloadDocument(doc);
    } finally {
      dom.window.HTMLAnchorElement.prototype.click = original;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
    assert.deepEqual(clicks, [{ download: "demo.nblk", href: "blob:demo" }]);
    assert.deepEqual(urls, ["blob:demo"]);
    // The anchor must not linger in the document after the click.
    assert.equal(dom.window.document.querySelectorAll("a").length, 0);
  });
});
