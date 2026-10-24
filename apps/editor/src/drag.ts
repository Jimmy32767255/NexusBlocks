import type { BlockRegistry } from "@nexus/engine";
import {
  CATCH_PORT,
  findBlock,
  isAssignable,
  isCatchType,
  portsOf,
  TRY_TYPE,
  type BlockNode,
  type ValueType,
} from "@nexus/ir";
import { applyBlockWidths, renderBlock } from "./block-view.ts";
import {
  createScriptWith,
  insertIntoStack,
  locateBlock,
  plugIntoPort,
  removeBlock,
  type InstanceResult,
} from "./edits.ts";
import { el } from "./dom.ts";
import type { Store } from "./store.ts";

export interface DragDeps {
  store: Store;
  registry: BlockRegistry;
  variables: () => readonly { id: string; name: string }[];
  zoom: () => number;
  surface: () => HTMLElement | null;
  createInstance: (type: string) => InstanceResult;
  placeBlockAtCenter: (type: string) => void;
  selectBlock: (id: string | null) => void;
  toast: (key: string, level?: "info" | "error") => void;
  /** Force a synchronous re-render (used so drop targets match the document). */
  flush: () => void;
}

type Source = { kind: "toolbox"; type: string } | { kind: "block"; blockId: string };

interface Payload {
  kind: "hat" | "statement" | "expression";
  blocks: BlockNode[];
  /** Document JSON before the block was detached; null for toolbox drags. */
  snapshot: string | null;
}

type DropTarget =
  | { type: "delete"; el: HTMLElement }
  | { type: "slot"; el: HTMLElement; parentId: string; port: string; index: number }
  | { type: "value"; el: HTMLElement; parentId: string; port: string; portType: ValueType }
  | { type: "block"; el: HTMLElement; blockId: string }
  | { type: "canvas"; el: HTMLElement };

interface Session {
  source: Source;
  deps: DragDeps;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  payload: Payload | null;
  ghost: HTMLElement | null;
  highlighted: HTMLElement | null;
  /** The in-canvas element being dragged, hidden while the ghost follows the pointer. */
  sourceEl: HTMLElement | null;
}

let session: Session | null = null;

export function startToolboxDrag(event: PointerEvent, type: string, deps: DragDeps): void {
  begin(event, { kind: "toolbox", type }, deps);
}

export function startBlockDrag(event: PointerEvent, blockId: string, deps: DragDeps): void {
  begin(event, { kind: "block", blockId }, deps);
}

function begin(event: PointerEvent, source: Source, deps: DragDeps): void {
  if (session) return;
  session = {
    source,
    deps,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
    payload: null,
    ghost: null,
    highlighted: null,
    sourceEl:
      source.kind === "block"
        ? document.querySelector<HTMLElement>(`[data-block-id="${source.blockId}"]`)
        : null,
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKeyDown);
}

function onMove(event: PointerEvent): void {
  const current = session;
  if (!current) return;
  current.x = event.clientX;
  current.y = event.clientY;

  if (!current.active) {
    if (Math.hypot(current.x - current.startX, current.y - current.startY) < 5) return;
    if (!activate(current)) return;
  }

  moveGhost(current);
  const target = hitTest(current.x, current.y, current.deps);
  highlight(current, target && target.type !== "canvas" ? target.el : null);
}

function activate(current: Session): boolean {
  const { deps, source } = current;
  current.sourceEl?.classList.add("block--drag-source");
  let payload: Payload | null = null;

  if (source.kind === "toolbox") {
    const result = deps.createInstance(source.type);
    if (!result.ok) {
      deps.toast(result.reason === "variable" ? "toast.variableRequired" : "toast.dropInvalid");
      cleanup();
      return false;
    }
    const definition = deps.registry.get(source.type);
    payload = {
      kind: definition?.kind === "expression" ? "expression" : definition?.kind === "hat" ? "hat" : "statement",
      blocks: [result.node],
      snapshot: null,
    };
  } else {
    const document = deps.store.state.document;
    const location = locateBlock(document.project, source.blockId);
    if (!location) {
      cleanup();
      return false;
    }
    const block = location.stack[location.index]!;
    const definition = deps.registry.get(block.type);
    const kind = definition?.kind ?? "statement";
    const snapshot = JSON.stringify(document);

    if (kind === "hat") {
      const hat = location.stack[location.index];
      if (!hat) {
        cleanup();
        return false;
      }
      payload = { kind: "hat", blocks: [hat], snapshot };
    } else {
      let grabbed: BlockNode | null = null;
      deps.store.update(
        (next) => {
          const where = locateBlock(next.project, source.blockId);
          if (!where) return;
          grabbed = where.stack[where.index] ?? null;
          removeBlock(next, source.blockId);
        },
        { history: false, dirty: false },
      );
      if (!grabbed) {
        cleanup();
        return false;
      }
      payload = {
        kind: kind === "expression" ? "expression" : "statement",
        blocks: [grabbed],
        snapshot,
      };
      deps.selectBlock(null);
      deps.flush();
    }
  }

  current.payload = payload;
  current.active = true;
  current.ghost = buildGhost(payload.blocks, deps);
  document.body.append(current.ghost);
  applyBlockWidths(current.ghost);
  document.body.classList.add("is-dragging");
  moveGhost(current);
  return true;
}

function buildGhost(blocks: BlockNode[], deps: DragDeps): HTMLElement {
  const ghost = el("div", { class: "drag-ghost" });
  const context = {
    registry: deps.registry,
    selectedId: null,
    variables: deps.variables(),
    interactive: false,
  };
  for (const block of blocks) ghost.append(renderBlock(block, context));
  return ghost;
}

function moveGhost(current: Session): void {
  if (!current.ghost) return;
  current.ghost.style.left = `${current.x}px`;
  current.ghost.style.top = `${current.y}px`;
}

function highlight(current: Session, element: HTMLElement | null): void {
  if (current.highlighted === element) return;
  current.highlighted?.classList.remove("drop-active");
  element?.classList.add("drop-active");
  current.highlighted = element;
}

function onUp(): void {
  const current = session;
  if (!current) return;
  const { deps, source } = current;

  if (!current.active) {
    cleanup();
    if (source.kind === "toolbox") deps.placeBlockAtCenter(source.type);
    else deps.selectBlock(source.blockId);
    return;
  }

  const target = hitTest(current.x, current.y, deps);
  const payload = current.payload;
  cleanup();
  if (!payload) return;

  const placed = applyDrop(payload, target, deps);
  if (placed) deps.flush();
  if (!placed) {
    if (payload.snapshot) deps.store.restoreSnapshot(payload.snapshot);
    else deps.flush();
    deps.toast(source.kind === "toolbox" ? "toast.dropInvalid" : "toast.noTarget");
  }
}

function onCancel(): void {
  cancelSession();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  cancelSession();
}

function cancelSession(): void {
  const current = session;
  if (!current) return;
  if (current.active && current.payload?.snapshot) {
    current.deps.store.restoreSnapshot(current.payload.snapshot);
  }
  cleanup();
}

function cleanup(): void {
  const current = session;
  session = null;
  if (!current) return;
  current.ghost?.remove();
  current.sourceEl?.classList.remove("block--drag-source");
  current.highlighted?.classList.remove("drop-active");
  document.body.classList.remove("is-dragging");
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
  window.removeEventListener("keydown", onKeyDown);
}

function hitTest(clientX: number, clientY: number, deps: DragDeps): DropTarget | null {
  const element = document.elementFromPoint(clientX, clientY);
  if (!(element instanceof Element)) return null;

  const zone = element.closest<HTMLElement>("[data-delete-zone]");
  if (zone) return { type: "delete", el: zone };

  const drop = element.closest<HTMLElement>("[data-drop]");
  if (drop) {
    const kind = drop.dataset.drop;
    if (kind === "value" && drop.dataset.parent && drop.dataset.port) {
      return {
        type: "value",
        el: drop,
        parentId: drop.dataset.parent,
        port: drop.dataset.port,
        portType: (drop.dataset.type ?? "any") as ValueType,
      };
    }
    if (kind === "stack" && drop.dataset.parent && drop.dataset.port) {
      return {
        type: "slot",
        el: drop,
        parentId: drop.dataset.parent,
        port: drop.dataset.port,
        index: Number(drop.dataset.index ?? 0),
      };
    }
  }

  const block = element.closest<HTMLElement>(".block");
  if (block?.dataset.blockId) {
    return { type: "block", el: block, blockId: block.dataset.blockId };
  }

  const canvas = element.closest<HTMLElement>(".canvas");
  if (canvas) return { type: "canvas", el: canvas };

  return null;
}

function applyDrop(payload: Payload, target: DropTarget | null, deps: DragDeps): boolean {
  const store = deps.store;
  const snapshot = payload.snapshot ?? JSON.stringify(store.state.document);
  const node = payload.blocks[0];

  if (target?.type === "delete") {
    // Toolbox drags have nothing to delete: dropping them back is a cancel.
    if (!payload.snapshot) return true;
    const ids = new Set(payload.blocks.map((block) => block.id));
    store.pushHistory(payload.snapshot);
    store.update(
      (document) => {
        if (payload.kind === "hat") {
          document.project.scripts = document.project.scripts.filter((script) => !ids.has(script.id));
        }
      },
      { history: false },
    );
    deps.selectBlock(null);
    deps.toast("toast.deleted", "info");
    return true;
  }

  if (payload.kind === "hat") {
    if (!target || target.type !== "canvas" || !node) return false;
    store.pushHistory(snapshot);
    store.update(
      (document) => {
        // Scripts are ordered by the array; a hat dropped on the canvas moves
        // to the end (toolbox hats are new and simply join the end).
        document.project.scripts = document.project.scripts.filter(
          (script) => script.id !== node.id,
        );
        document.project.scripts.push(node);
      },
      { history: false },
    );
    return true;
  }

  if (!node) return false;

  if (payload.kind === "expression") {
    if (!target || target.type !== "value") return false;
    const definition = deps.registry.get(node.type);
    if (!definition || !isAssignable(definition.output, target.portType)) return false;
    if (!canPlug(store, target.parentId, target.port)) return false;

    store.pushHistory(snapshot);
    store.update(
      (document) => {
        plugIntoPort(document.project, target.parentId, target.port, node);
      },
      { history: false },
    );
    return true;
  }

  if (!target) return false;

  if (target.type === "slot") {
    if (!canInsert(store, deps, target.parentId, target.port)) return false;
    if (!catchFits(store, deps, node, target.parentId, target.port)) return false;
    store.pushHistory(snapshot);
    store.update(
      (document) => {
        insertIntoStack(document.project, target.parentId, target.port, target.index, node);
      },
      { history: false },
    );
    return true;
  }

  if (target.type === "canvas") {
    if (isCatchType(node.type)) return false;
    store.pushHistory(snapshot);
    store.update(
      (document) => {
        createScriptWith(document, node);
      },
      { history: false },
    );
    return true;
  }

  if (target.type === "block") {
    const insertion = insertionAfterBlock(target.blockId, target.el, deps);
    if (!insertion) return false;
    if (!canInsert(store, deps, insertion.parentId, insertion.port)) return false;
    if (!catchFits(store, deps, node, insertion.parentId, insertion.port)) return false;
    store.pushHistory(snapshot);
    store.update(
      (document) => {
        insertIntoStack(document.project, insertion.parentId, insertion.port, insertion.index, node);
      },
      { history: false },
    );
    return true;
  }

  return false;
}

/** Catch branches belong in a try block's catch stack, and nowhere else. */
function catchFits(
  store: Store,
  deps: DragDeps,
  node: BlockNode,
  parentId: string,
  port: string,
): boolean {
  const parent = findBlock(store.state.document.project, parentId);
  const slot = parent?.type === TRY_TYPE && port === CATCH_PORT;
  if (isCatchType(node.type)) return slot;
  return !slot;
}

function canInsert(store: Store, deps: DragDeps, parentId: string, port: string): boolean {
  const parent = findBlock(store.state.document.project, parentId);
  if (!parent) return false;
  const definition = deps.registry.get(parent.type);
  if (
    !definition ||
    !portsOf(definition, parent).some((candidate) => candidate.name === port && candidate.kind === "stack")
  ) {
    return false;
  }
  const existing = parent.inputs?.[port];
  return existing === undefined || Array.isArray(existing);
}

function canPlug(store: Store, parentId: string, port: string): boolean {
  const parent = findBlock(store.state.document.project, parentId);
  if (!parent) return false;
  return parent.inputs?.[port] === undefined;
}

interface Insertion {
  parentId: string;
  port: string;
  index: number;
}

/** Where a statement lands when hovered over another block. */
function insertionAfterBlock(blockId: string, element: HTMLElement, deps: DragDeps): Insertion | null {
  const document = deps.store.state.document;
  const location = locateBlock(document.project, blockId);
  if (!location) return null;
  const block = location.stack[location.index];
  if (!block) return null;

  const definition = deps.registry.get(block.type);
  if (definition?.kind === "expression") {
    const statement = element.closest<HTMLElement>(".block--statement, .block--hat");
    const statementId = statement?.dataset.blockId;
    if (!statementId || statementId === blockId) return null;
    return insertionAfterBlock(statementId, statement!, deps);
  }

  if (definition?.kind === "hat") {
    const body = Array.isArray(block.inputs?.body) ? (block.inputs!.body as BlockNode[]) : [];
    return { parentId: block.id, port: "body", index: body.length };
  }

  if (!location.parent || !location.port) return null;
  return { parentId: location.parent.id, port: location.port, index: location.index + 1 };
}
