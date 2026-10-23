import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { createProjectRegistry, createStarterDocument, defaultRegistry } from "@nexus/engine";
import { createBlock, createDocument, createProject, findBlock } from "@nexus/ir";

const dom = new JSDOM("<!doctype html><html lang=\"en\"><body></body></html>", {
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
const { renderCanvas } = await import("../src/canvas.ts");
const { renderInspector } = await import("../src/inspector.ts");
const { renderConsole } = await import("../src/console.ts");

function starterPrint() {
  const document = createStarterDocument("en");
  const start = document.project.scripts[0]!;
  const body = start.inputs?.body;
  assert.ok(Array.isArray(body));
  const print = body[0]!;
  return { document, print };
}

describe("editor rendering", () => {
  it("renders every registered block and filters by label", () => {
    const toolbox = renderToolbox({
      registry: defaultRegistry,
      onInsert: () => {},
      onDragStart: () => {},
    });

    const items = toolbox.querySelectorAll<HTMLElement>(".toolbox__item");
    assert.equal(items.length, defaultRegistry.all().length);
    assert.ok(toolbox.querySelectorAll(".toolbox__group").length >= 4);

    const search = toolbox.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "输出";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const visible = [...items].filter((item) => !item.hidden);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.dataset.toolbox, "io.print");
  });

  it("shows an empty state for a query that matches nothing", () => {
    const toolbox = renderToolbox({
      registry: defaultRegistry,
      onInsert: () => {},
      onDragStart: () => {},
    });
    const search = toolbox.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "qqqqqq";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    assert.equal(toolbox.querySelector<HTMLElement>(".toolbox__empty")?.hidden, false);
    assert.equal(
      [...toolbox.querySelectorAll<HTMLElement>(".toolbox__item")].filter((item) => !item.hidden).length,
      0,
    );
  });

  it("renders a starter script as hat plus body", () => {
    const { document: doc } = starterPrint();
    const view = renderCanvas(doc, {
      registry: defaultRegistry,
      selectedId: null,
      variables: doc.project.variables,
      zoom: 1,
      interactive: true,
    });

    assert.equal(view.root.querySelectorAll(".script").length, 1);
    assert.equal(view.root.querySelectorAll(".block").length, 2);
    assert.equal(view.root.querySelector(".canvas__empty"), null);

    // Hat blocks render one flat bar plus a C-shaped mouth, never a wrapping box.
    const hat = view.root.querySelector(".block--hat")!;
    assert.equal(hat.querySelectorAll(":scope > .block__mouth").length, 1);
    assert.equal(hat.querySelectorAll(":scope > .block__foot").length, 1);
    const statement = view.root.querySelector(".block--statement")!;
    assert.equal(statement.querySelectorAll(":scope > .block__mouth").length, 0);
    assert.equal(statement.querySelectorAll(":scope > .block__foot").length, 0);
  });

  it("renders the empty canvas state", () => {
    const view = renderCanvas(createDocument(createProject()), {
      registry: defaultRegistry,
      selectedId: null,
      variables: [],
      zoom: 1,
      interactive: true,
    });
    assert.ok(view.root.querySelector(".canvas__empty"));
  });

  it("edits the inline literal through the inspector", () => {
    const { document: doc, print } = starterPrint();
    const changes: [string, string, string | number | boolean][] = [];

    const panel = renderInspector({
      registry: defaultRegistry,
      selected: findBlock(doc.project, print.id) ?? null,
      variables: doc.project.variables,
      onFieldChange: () => {},
      onLiteralChange: (blockId, field, value) => changes.push([blockId, field, value]),
      onUnplug: () => {},
      onDelete: () => {},
    });

    const input = panel.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.value, "Hello, world!");

    input.value = "Hi";
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    assert.deepEqual(changes, [[print.id, "text", "Hi"]]);
  });

  it("renders console lines and follows block links", () => {
    const { print } = starterPrint();
    const selected: string[] = [];

    const consolePanel = renderConsole({
      logs: [
        { id: 1, time: Date.now(), level: "info", text: "Hello, world!", blockId: print.id },
        { id: 2, time: Date.now(), level: "error", text: "boom" },
      ],
      onClear: () => {},
      onSelectBlock: (blockId) => selected.push(blockId),
    });

    const lines = consolePanel.querySelectorAll(".console__line");
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.querySelector(".console__text")?.textContent, "Hello, world!");

    lines[0]?.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    assert.deepEqual(selected, [print.id]);
  });

  it("adds a dynamic call block for every function definition", () => {
    const document = createDocument(createProject());
    const definition = createBlock("func.define", {
      fields: { name: "twice", params: "x: number", returnType: "number" },
      inputs: { body: [] },
    });
    document.project.scripts.push(definition);
    const callType = `func.call:${definition.id}`;
    const call = createBlock(callType, {
      inputs: { x: createBlock("math.number", { fields: { value: 2 } }) },
    });
    document.project.scripts.push(createBlock("control.start", { inputs: { body: [call] } }));

    const registry = createProjectRegistry(document.project);
    const toolbox = renderToolbox({ registry, onInsert: () => {}, onDragStart: () => {} });
    const types = [...toolbox.querySelectorAll<HTMLElement>("[data-toolbox]")].map(
      (row) => row.dataset.toolbox,
    );
    assert.ok(types.includes("func.define"));
    assert.ok(types.includes(callType));

    const canvas = renderCanvas(document, {
      registry,
      selectedId: null,
      variables: document.project.variables,
      zoom: 1,
      interactive: false,
    });
    assert.match(canvas.root.textContent ?? "", /twice/);
  });
});

describe("inline control sizing", () => {
  it("fits control widths to their content within the limits", async () => {
    const { autoSizeControl } = await import("../src/block-view.ts");

    const text = document.createElement("input");
    text.type = "text";
    text.value = "abc";
    autoSizeControl(text);
    assert.equal(text.style.width, "54px");

    text.value = "x".repeat(100);
    autoSizeControl(text);
    assert.equal(text.style.width, "320px");

    const number = document.createElement("input");
    number.type = "number";
    number.value = "1234567890";
    autoSizeControl(number);
    assert.equal(number.style.width, "94px");

    const select = document.createElement("select");
    const option = document.createElement("option");
    option.textContent = "hello world";
    option.value = "x";
    select.append(option);
    select.value = "x";
    autoSizeControl(select);
    assert.equal(select.style.width, "119px");
  });
});
