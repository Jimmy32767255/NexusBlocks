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
  it("shows a breakpoint switch for statements and hides it for hats", () => {
    const statement = createBlock("io.print", { id: "bp-print", fields: { text: "x" } });
    const base = {
      registry: defaultRegistry,
      variables: [],
      onFieldChange: () => {},
      onLiteralChange: () => {},
      onUnplug: () => {},
      onDelete: () => {},
    };
    const withSwitch = renderInspector({
      ...base,
      selected: statement,
      breakpoint: true,
      onToggleBreakpoint: () => {},
    });
    assert.ok(withSwitch.querySelector(".inspector__switch"));
    assert.equal(
      withSwitch.querySelector<HTMLInputElement>(".switch__input")?.checked,
      true,
    );

    const hat = createBlock("control.start", { id: "bp-hat", inputs: { body: [] } });
    const withoutSwitch = renderInspector({
      ...base,
      selected: hat,
      breakpoint: true,
      onToggleBreakpoint: () => {},
    });
    assert.equal(withoutSwitch.querySelector(".inspector__switch"), null);
  });

  it("renders every registered block and filters by label", () => {
    const toolbox = renderToolbox({
      registry: defaultRegistry,
      onInsert: () => {},
      onDragStart: () => {},
    });

    const items = toolbox.querySelectorAll<HTMLElement>(".toolbox__item");
    assert.equal(items.length, defaultRegistry.all().filter((definition) => !definition.hidden).length);
    assert.ok(toolbox.querySelectorAll(".toolbox__group").length >= 4);

    const search = toolbox.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "输出";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    const visible = [...items].filter((item) => !item.hidden);
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.dataset.toolbox, "io.print");
  });

  it("hints block type with the toolbox swatch shape", () => {
    const toolbox = renderToolbox({
      registry: defaultRegistry,
      onInsert: () => {},
      onDragStart: () => {},
    });
    const swatch = (type: string) =>
      toolbox.querySelector<HTMLElement>(`[data-toolbox="${type}"] .toolbox__swatch`)?.className ?? "";
    assert.match(swatch("control.start"), /toolbox__swatch--hat/);
    assert.match(swatch("io.print"), /toolbox__swatch--statement/);
    assert.match(swatch("text.literal"), /toolbox__swatch--expression/);
    assert.match(swatch("sys.exit"), /toolbox__swatch--terminal/);
  });

  it("collapses and expands toolbox groups, and a search reveals matches", () => {
    window.localStorage.removeItem("nexus-blocks:toolbox-collapsed");
    const toolbox = renderToolbox({
      registry: defaultRegistry,
      onInsert: () => {},
      onDragStart: () => {},
    });
    const group = toolbox.querySelector<HTMLElement>(".toolbox__group")!;
    const toggle = group.querySelector<HTMLButtonElement>(".toolbox__group-title")!;
    const body = group.querySelector<HTMLElement>(".toolbox__group-body")!;

    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(body.hidden, false);

    toggle.click();
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(body.hidden, true);
    assert.ok(group.classList.contains("toolbox__group--collapsed"));

    // Collapsed state survives a re-render (it is persisted in localStorage).
    const again = renderToolbox({ registry: defaultRegistry, onInsert: () => {}, onDragStart: () => {} });
    const second = again.querySelector<HTMLElement>(".toolbox__group")!;
    assert.equal(second.querySelector<HTMLElement>(".toolbox__group-body")?.hidden, true);

    // Searching still surfaces matches from the collapsed group.
    const search = again.querySelector<HTMLInputElement>("input[type=search]")!;
    search.value = "当程序启动";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.equal(second.querySelector<HTMLElement>(".toolbox__group-body")?.hidden, false);

    window.localStorage.removeItem("nexus-blocks:toolbox-collapsed");
  });

  it("shows script order arrows for a selected hat", () => {
    const { document: doc } = starterPrint();
    const start = doc.project.scripts[0]!;
    const second = createBlock("control.start", { inputs: { body: [] } });
    doc.project.scripts.push(second);

    const moves: number[] = [];
    const panel = renderInspector({
      registry: defaultRegistry,
      selected: findBlock(doc.project, second.id) ?? null,
      variables: doc.project.variables,
      onFieldChange: () => {},
      onLiteralChange: () => {},
      onUnplug: () => {},
      onDelete: () => {},
      scriptPosition: { index: 1, total: 2 },
      onMoveScript: (delta) => moves.push(delta),
    });

    const position = panel.querySelector(".inspector__order-position")?.textContent ?? "";
    assert.match(position, /2/);
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>(".button--order")];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0]?.disabled, false);
    assert.equal(buttons[1]?.disabled, true);

    buttons[0]!.click();
    assert.deepEqual(moves, [-1]);

    const first = renderInspector({
      registry: defaultRegistry,
      selected: findBlock(doc.project, start.id) ?? null,
      variables: doc.project.variables,
      onFieldChange: () => {},
      onLiteralChange: () => {},
      onUnplug: () => {},
      onDelete: () => {},
      scriptPosition: { index: 0, total: 2 },
      onMoveScript: () => {},
    });
    const firstButtons = [...first.querySelectorAll<HTMLButtonElement>(".button--order")];
    assert.equal(firstButtons[0]?.disabled, true);
    assert.equal(firstButtons[1]?.disabled, false);
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
      viewport: { x: 0, y: 0 },
      interactive: true,
    });

    assert.equal(view.root.querySelectorAll(".script").length, 1);
    assert.equal(view.root.querySelectorAll(".block").length, 2);
    assert.equal(view.root.querySelector(".canvas__empty"), null);

    // Hat blocks render one flat bar plus a C-shaped mouth, never a wrapping box.
    const hat = view.root.querySelector(".block--hat")!;
    assert.equal(hat.querySelectorAll(":scope > .block__mouth").length, 1);
    assert.equal(hat.querySelectorAll(":scope > .block__foot").length, 1);
    // Width comes from the layout (head, mouth and foot share one column),
    // never from per-frame JavaScript measurements.
    assert.equal(hat.querySelector<HTMLElement>(":scope > .block__foot")!.style.width, "");
    const statement = view.root.querySelector(".block--statement")!;
    assert.equal(statement.querySelectorAll(":scope > .block__mouth").length, 0);
    assert.equal(statement.querySelectorAll(":scope > .block__foot").length, 0);
  });

  it("marks breakpointed and currently executing blocks", () => {
    const { document, print } = starterPrint();
    const view = renderCanvas(document, {
      registry: defaultRegistry,
      selectedId: null,
      variables: document.project.variables,
      zoom: 1,
      viewport: { x: 0, y: 0 },
      interactive: false,
      breakpoints: new Set([print.id]),
      debugCurrentId: print.id,
    });
    const block = view.root.querySelector<HTMLElement>(`[data-block-id="${print.id}"]`);
    assert.ok(block?.classList.contains("block--breakpoint"));
    assert.ok(block?.classList.contains("block--debug-current"));
  });

  it("renders scripts in document order without stored coordinates", () => {
    const doc = createDocument(createProject());
    const hats = [0, 1, 2].map(() => createBlock("control.start", { inputs: { body: [] } }));
    doc.project.scripts = hats;

    const view = renderCanvas(doc, {
      registry: defaultRegistry,
      selectedId: null,
      variables: [],
      zoom: 1,
      viewport: { x: 0, y: 0 },
      interactive: true,
    });

    const wrappers = [...view.root.querySelectorAll<HTMLElement>(".script")];
    assert.deepEqual(wrappers.map((wrapper) => wrapper.dataset.script), hats.map((hat) => hat.id));
    for (const wrapper of wrappers) assert.equal(wrapper.getAttribute("style"), null);
  });

  it("renders comments as notes with a dashed, italic head", () => {
    const doc = createDocument(createProject());
    const note = createBlock("comment.note", { fields: { text: "remember to test" } });
    doc.project.scripts.push(createBlock("control.start", { inputs: { body: [note] } }));

    const view = renderCanvas(doc, {
      registry: defaultRegistry,
      selectedId: null,
      variables: [],
      zoom: 1,
      viewport: { x: 0, y: 0 },
      interactive: true,
    });

    const block = view.root.querySelector<HTMLElement>("[data-block-id='" + note.id + "']")!;
    assert.ok(block.classList.contains("block--comment"));
    const input = block.querySelector<HTMLInputElement>("input")!;
    assert.equal(input.value, "remember to test");
    assert.equal(input.getAttribute("aria-label"), "内容");
  });

  it("renders the empty canvas state", () => {
    const view = renderCanvas(createDocument(createProject()), {
      registry: defaultRegistry,
      selectedId: null,
      variables: [],
      zoom: 1,
      viewport: { x: 0, y: 0 },
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
    const definition = createBlock("func.define_value", {
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
    assert.ok(types.includes("func.define_value"));
    assert.ok(types.includes(callType));

    const canvas = renderCanvas(document, {
      registry,
      selectedId: null,
      variables: document.project.variables,
      zoom: 1,
      viewport: { x: 0, y: 0 },
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

  it("renders growable join inputs and else-if branches", () => {
    const document = createDocument(createProject());
    document.project.scripts = [
      {
        id: "s",
        type: "control.start",
        inputs: {
          body: [
            { id: "j", type: "text.join", fields: { count: 3 } },
            { id: "i", type: "control.if", fields: { elseIfs: 1 } },
          ],
        },
      },
    ];
    const view = renderCanvas(document, {
      registry: defaultRegistry,
      selectedId: null,
      variables: [],
      zoom: 1,
      viewport: { x: 0, y: 0 },
      interactive: true,
    });
    const join = view.surface.querySelector<HTMLElement>('[data-block-id="j"]');
    assert.ok(join);
    assert.equal(join.querySelectorAll(".port").length, 3);
    assert.ok(join.querySelector('.block__counter [data-grow="add"]'));
    assert.ok(join.querySelector('.block__counter [data-grow="remove"]'));

    const ifBlock = view.surface.querySelector<HTMLElement>('[data-block-id="i"]');
    assert.ok(ifBlock);
    assert.equal(ifBlock.querySelectorAll(".block__mouth").length, 3);
    assert.equal(ifBlock.querySelectorAll(".stack__caption").length, 3);
  });
});

it("expression blocks render as capsules and terminal statements get their own class", () => {
  const document = createStarterDocument();
  document.project.scripts[0]!.inputs!.body = [
    createBlock("control.break"),
    createBlock("io.print", {
      inputs: {
        text: createBlock("math.arithmetic", {
          fields: { op: "+" },
          inputs: { a: createBlock("math.number", { fields: { value: 1 } }), b: createBlock("math.number", { fields: { value: 2 } }) },
        }),
      },
    }),
  ];
  const canvas = renderCanvas(document, {
    registry: defaultRegistry,
    selectedId: null,
    variables: [],
    zoom: 1,
    viewport: { x: 0, y: 0 },
    interactive: false,
  });
  const terminal = canvas.root.querySelector(".block--terminal");
  assert.ok(terminal);
  assert.equal((terminal as HTMLElement | null)?.dataset.blockType, "control.break");
  const expression = canvas.root.querySelector(".block--expression");
  assert.ok(expression);
  assert.equal((expression as HTMLElement | null)?.dataset.blockType, "math.arithmetic");
});
