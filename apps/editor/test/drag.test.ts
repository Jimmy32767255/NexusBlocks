import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { createStarterDocument, defaultRegistry } from "@nexus/engine";
import { findBlock } from "@nexus/ir";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
});

const { startBlockDrag, startToolboxDrag } = await import("../src/drag.ts");
type DragDeps = import("../src/drag.ts").DragDeps;
const { newBlockInstance } = await import("../src/edits.ts");
const { Store } = await import("../src/store.ts");

function setup() {
  const store = new Store(createStarterDocument("en"));
  const canvas = document.createElement("div");
  canvas.className = "canvas";
  const surface = document.createElement("div");
  surface.className = "canvas__surface";
  canvas.append(surface);
  document.body.append(canvas);
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect;

  const toasts: string[] = [];
  const deps = {
    store,
    registry: defaultRegistry,
    variables: () => store.state.document.project.variables,
    zoom: () => 1,
    surface: () => surface,
    createInstance: (type: string) =>
      newBlockInstance(defaultRegistry, store.state.document.project, type),
    placeBlockAtCenter: () => {},
    selectBlock: (id: string | null) => store.select(id),
    toast: (key: string) => toasts.push(key),
    flush: () => {},
  };

  return { store, canvas, surface, toasts, deps };
}

function bodyLength(store: { state: { document: import("@nexus/ir").NexusDocument } }, startId: string): number {
  const body = findBlock(store.state.document.project, startId)?.inputs?.body;
  return Array.isArray(body) ? body.length : -1;
}

function pointAt(target: Element | null): void {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => target,
  });
}

function drag(
  start: (event: PointerEvent, id: string, deps: DragDeps) => void,
  id: string,
  deps: DragDeps,
  path: [number, number][],
): void {
  start({ clientX: 0, clientY: 0 } as PointerEvent, id, deps);
  for (const [x, y] of path) {
    dom.window.dispatchEvent(new dom.window.MouseEvent("pointermove", { clientX: x, clientY: y }));
  }
  dom.window.dispatchEvent(new dom.window.MouseEvent("pointerup", { clientX: 0, clientY: 0 }));
}

describe("editor drag and drop", () => {
  it("moves a hat to the drop point", () => {
    const { store, surface, deps } = setup();
    const hatId = store.state.document.project.scripts[0]!.id;
    pointAt(surface);

    drag(startBlockDrag, hatId, deps, [[100, 150]]);

    assert.deepEqual(store.state.document.editor.positions[hatId], { x: 100, y: 150 });
    assert.equal(store.canUndo(), true);
  });

  it("drops a toolbox expression into a compatible value port", () => {
    const { store, canvas, deps, toasts } = setup();
    const start = store.state.document.project.scripts[0]!;
    const print = (start.inputs?.body as { id: string }[])[0]!;

    const slot = document.createElement("div");
    slot.dataset.drop = "value";
    slot.dataset.parent = print.id;
    slot.dataset.port = "text";
    slot.dataset.type = "text";
    canvas.append(slot);
    pointAt(slot);

    drag(startToolboxDrag, "text.literal", deps, [[120, 80]]);

    const plugged = findBlock(store.state.document.project, print.id)?.inputs?.text;
    assert.equal((plugged as { type?: string } | undefined)?.type, "text.literal");
    assert.deepEqual(toasts, []);
  });

  it("rejects an expression dropped on a stack slot", () => {
    const { store, canvas, deps, toasts } = setup();
    const start = store.state.document.project.scripts[0]!;

    const slot = document.createElement("div");
    slot.dataset.drop = "stack";
    slot.dataset.parent = start.id;
    slot.dataset.port = "body";
    slot.dataset.index = "0";
    canvas.append(slot);
    pointAt(slot);

    drag(startToolboxDrag, "text.literal", deps, [[120, 80]]);

    assert.deepEqual(toasts, ["toast.dropInvalid"]);
    assert.equal(bodyLength(store, start.id), 1);
  });

  it("deletes a statement dropped on the toolbox delete zone", () => {
    const { store, deps, toasts } = setup();
    const start = store.state.document.project.scripts[0]!;
    const print = (start.inputs?.body as { id: string }[])[0]!;

    const zone = document.createElement("aside");
    zone.dataset.deleteZone = "true";
    document.body.append(zone);
    pointAt(zone);

    drag(startBlockDrag, print.id, deps, [[40, 40]]);

    assert.equal(bodyLength(store, start.id), 0);
    assert.deepEqual(toasts, ["toast.deleted"]);
    assert.equal(store.canUndo(), true);

    store.undo();
    assert.equal(bodyLength(store, start.id), 1);
  });

  it("deletes a whole script dropped on the toolbox delete zone", () => {
    const { store, deps } = setup();
    const hat = store.state.document.project.scripts[0]!;

    const zone = document.createElement("aside");
    zone.dataset.deleteZone = "true";
    document.body.append(zone);
    pointAt(zone);

    drag(startBlockDrag, hat.id, deps, [[40, 40]]);

    assert.equal(store.state.document.project.scripts.length, 0);
    assert.equal(store.state.document.editor.positions[hat.id], undefined);

    store.undo();
    assert.equal(store.state.document.project.scripts.length, 1);
    assert.ok(store.state.document.editor.positions[hat.id]);
  });

  it("cancels a toolbox drag dropped back on the toolbox", () => {
    const { store, deps, toasts } = setup();
    const start = store.state.document.project.scripts[0]!;

    const zone = document.createElement("aside");
    zone.dataset.deleteZone = "true";
    document.body.append(zone);
    pointAt(zone);

    drag(startToolboxDrag, "io.print", deps, [[40, 40]]);

    assert.equal(bodyLength(store, start.id), 1);
    assert.equal(store.state.document.project.scripts.length, 1);
    assert.deepEqual(toasts, []);
  });

  it("cancels a statement drag with Escape and restores it", () => {
    const { store, surface, deps } = setup();
    const start = store.state.document.project.scripts[0]!;
    const print = (start.inputs?.body as { id: string }[])[0]!;
    pointAt(surface);

    startBlockDrag({ clientX: 0, clientY: 0 } as PointerEvent, print.id, deps);
    dom.window.dispatchEvent(new dom.window.MouseEvent("pointermove", { clientX: 60, clientY: 60 }));
    assert.equal(bodyLength(store, start.id), 0);

    dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));

    assert.equal(bodyLength(store, start.id), 1);
  });
});
