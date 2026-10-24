import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { JSDOM } from "jsdom";
import { defaultRegistry } from "@nexus/engine";

const dom = new JSDOM("<!doctype html><html lang=\"zh-CN\"><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle,
});

dom.window.localStorage.setItem("nexus-blocks:locale", "zh-CN");

const { renderToolbox } = await import("../src/toolbox.ts");

function row(type: string): HTMLElement {
  const toolbox = renderToolbox({
    registry: defaultRegistry,
    onInsert: () => {},
    onDragStart: () => {},
  });
  document.body.append(toolbox);
  const found = toolbox.querySelector<HTMLElement>(`[data-toolbox="${type}"]`);
  assert.ok(found, `missing row ${type}`);
  return found;
}

describe("toolbox tooltip", () => {
  it("appears after hovering and hides on leave", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = row("text.join");
    target.dispatchEvent(new dom.window.Event("pointerenter"));
    assert.equal(document.querySelector(".block-tip"), null);

    t.mock.timers.tick(600);
    const tip = document.querySelector(".block-tip");
    assert.ok(tip, "tip should appear after the delay");
    assert.equal(tip.querySelector(".block-tip__type")?.textContent, "text.join");
    assert.ok(tip.querySelector(".block-tip__text")?.textContent);
    assert.equal(tip.querySelector(".block-tip__more")?.textContent, "更多");

    target.dispatchEvent(new dom.window.Event("pointerleave"));
    t.mock.timers.tick(200);
    assert.equal(document.querySelector(".block-tip"), null);
  });

  it("never appears when the pointer leaves before the delay", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = row("io.print");
    target.dispatchEvent(new dom.window.Event("pointerenter"));
    t.mock.timers.tick(300);
    target.dispatchEvent(new dom.window.Event("pointerleave"));
    t.mock.timers.tick(1000);
    assert.equal(document.querySelector(".block-tip"), null);
  });

  it("opens the detail dialog from the more link", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const target = row("control.while");
    target.dispatchEvent(new dom.window.Event("pointerenter"));
    t.mock.timers.tick(600);

    const more = document.querySelector<HTMLButtonElement>(".block-tip__more");
    assert.ok(more);
    more.click();

    const dialog = document.querySelector(".modal");
    assert.ok(dialog, "detail dialog should open");
    assert.equal(dialog.querySelector(".modal__title")?.textContent, "当……时重复");
    assert.equal(document.querySelector(".block-tip"), null);
    assert.ok(dialog.querySelector(".block-detail__params"));
    dialog.remove();
  });
});
