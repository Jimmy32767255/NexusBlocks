import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { createProjectRegistry, defaultRegistry } from "@nexus/engine";
import { createBlock, createDocument, createProject } from "@nexus/ir";

const dom = new JSDOM("<!doctype html><html lang=\"en\"><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
});

dom.window.localStorage.setItem("nexus-blocks:locale", "zh-CN");

const { renderHatList } = await import("../src/hat-list.ts");

function sampleDocument() {
  const project = createProject({ name: "hats" });
  project.scripts.push(
    createBlock("control.start", {
      inputs: { body: [createBlock("io.print", { fields: { text: "hi" } })] },
    }),
    createBlock("func.define_value", { fields: { name: "greet", params: "who: text" } }),
    createBlock("import.all", { fields: { file: "lib.nblk" } }),
  );
  return createDocument(project);
}

describe("hat list", () => {
  it("lists every top-level hat with a readable title", () => {
    const document = sampleDocument();
    const list = renderHatList({
      document,
      registry: defaultRegistry,
      selectedId: null,
      onSelect: () => {},
    });
    const rows = [...list.querySelectorAll<HTMLElement>(".hat-row")];
    assert.equal(rows.length, 3);
    assert.match(rows[0]!.textContent ?? "", /当程序启动/);
    assert.match(rows[1]!.textContent ?? "", /greet/);
    assert.match(rows[1]!.textContent ?? "", /who: text/);
    assert.match(rows[2]!.textContent ?? "", /lib\.nblk/);
    assert.match(rows[0]!.textContent ?? "", /第 1 条 · 2 块/);
  });

  it("marks the script that owns the selection and forwards clicks", () => {
    const document = sampleDocument();
    const hats = document.project.scripts;
    const selected = hats[0]!.inputs!.body as { id: string }[];
    const picked: string[] = [];
    const list = renderHatList({
      document,
      registry: createProjectRegistry(document.project),
      selectedId: selected[0]!.id,
      onSelect: (id) => picked.push(id),
    });
    const rows = [...list.querySelectorAll<HTMLElement>(".hat-row")];
    assert.equal(rows[0]!.classList.contains("hat-row--active"), true);
    assert.equal(rows[1]!.classList.contains("hat-row--active"), false);
    rows[1]!.click();
    assert.deepEqual(picked, [hats[1]!.id]);
  });

  it("explains the empty state", () => {
    const document = createDocument(createProject({ name: "empty" }));
    const list = renderHatList({
      document,
      registry: defaultRegistry,
      selectedId: null,
      onSelect: () => {},
    });
    assert.equal(list.querySelectorAll(".hat-row").length, 0);
    assert.match(list.textContent ?? "", /还没有顶级帽子/);
  });
});
