import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
});

dom.window.localStorage.setItem("nexus-blocks:locale", "en");
const { renderDebugPanel } = await import("../src/debug-panel.ts");

describe("debug panel", () => {
  it("shows variables by default and switches tabs", () => {
    let active = "";
    const root = renderDebugPanel({
      tab: "variables",
      values: { score: 3 },
      stack: [],
      onTabChange: (tab) => {
        active = tab;
      },
    });
    assert.equal(root.querySelectorAll(".side-tabs__tab").length, 2);
    assert.equal(root.querySelector(".variables__name")?.textContent, "score");
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".side-tabs__tab")];
    assert.equal(buttons[0]?.getAttribute("aria-selected"), "true");
    buttons[1]?.click();
    assert.equal(active, "stack");
  });

  it("lists frames innermost first and ends with the top level", () => {
    const root = renderDebugPanel({
      tab: "stack",
      values: null,
      stack: [
        { name: "outer", blockId: "f1" },
        { name: "inner", blockId: "f2" },
      ],
      onTabChange: () => {},
    });
    const names = [...root.querySelectorAll(".stack__name")].map((node) => node.textContent);
    assert.deepEqual(names, ["inner", "outer", "Top-level scripts"]);
    assert.equal(root.querySelectorAll(".stack__item")[0]?.className.includes("is-current"), true);
  });

  it("explains an empty stack", () => {
    const root = renderDebugPanel({
      tab: "stack",
      values: null,
      stack: [],
      onTabChange: () => {},
    });
    assert.ok(root.querySelector(".variables__empty"));
    assert.equal(root.querySelectorAll(".stack__item").length, 1);
  });
});
