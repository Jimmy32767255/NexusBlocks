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
const { renderVariables } = await import("../src/variables.ts");

function panel(onRename: (id: string, name: string) => string | null): HTMLElement {
  return renderVariables({
    variables: [{ id: "v1", name: "score" }],
    usage: new Map([["v1", 2]]),
    onAdd: () => {},
    onDelete: () => {},
    onSelectVariable: () => {},
    onRename,
  });
}

function startEditing(panel: HTMLElement): HTMLInputElement {
  const name = panel.querySelector<HTMLButtonElement>(".variables__name")!;
  name.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
  const input = panel.querySelector<HTMLInputElement>("input.variables__rename");
  assert.ok(input, "rename input should appear");
  return input;
}

describe("variables panel", () => {
  it("renames a variable through the inline input", () => {
    const calls: [string, string][] = [];
    const root = panel((id, name) => {
      calls.push([id, name]);
      return null;
    });
    const input = startEditing(root);

    input.value = "points";
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    assert.deepEqual(calls, [["v1", "points"]]);
    assert.equal(root.querySelector("input.variables__rename"), null);
  });

  it("keeps editing and shows the error when a rename is rejected", () => {
    const root = panel(() => "That name is taken");
    const input = startEditing(root);

    input.value = "score2";
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    assert.equal(root.querySelector<HTMLInputElement>("input.variables__rename"), input);
    const error = root.querySelector<HTMLElement>(".variables__error")!;
    assert.equal(error.hidden, false);
    assert.equal(error.textContent, "That name is taken");

    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(root.querySelector("input.variables__rename"), null);
    assert.equal(root.querySelector(".variables__error"), null);
  });
});
