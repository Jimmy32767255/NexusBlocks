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
const { renderVariableItems } = await import("../src/variables.ts");

describe("variables panel", () => {
  it("lists live variables with their current values", () => {
    const root = renderVariableItems({ score: 3, name: "Ada", done: true });
    const names = [...root.querySelectorAll(".variables__name")].map((node) => node.textContent);
    const values = [...root.querySelectorAll(".variables__value")].map((node) => node.textContent);
    assert.deepEqual(names, ["score", "name", "done"]);
    assert.deepEqual(values, ["3", '"Ada"', "true"]);
  });

  it("shows an empty hint before the program declares anything", () => {
    const root = renderVariableItems(null);
    assert.equal(root.querySelectorAll(".variables__item").length, 0);
    assert.ok(root.querySelector(".variables__empty"));
  });

  it("offers no editing controls", () => {
    const root = renderVariableItems({ score: 1 });
    assert.equal(root.querySelector("input"), null);
    assert.equal(root.querySelector("button"), null);
  });
});
