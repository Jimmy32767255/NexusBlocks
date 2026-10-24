import {
  createLocalHost,
  createProjectRegistry,
  createStarterDocument,
  resolveImports,
  runProject,
  type BlockRegistry,
  type ImportError,
  type RuntimeEvent,
  type RuntimeFailure,
} from "@nexus/engine";
import {
  countBlocks,
  createDocument,
  createProject,
  createVariable,
  findBlock,
  isCatchType,
  walkProject,
  type BlockNode,
  countField,
  formatParams,
  parseParams,
  portsOf,
  printNblk,
  type Diagnostic,
  type Value,
  type ValueType,
} from "@nexus/ir";
import { renderCanvas } from "./canvas.ts";
import { renderConsole } from "./console.ts";
import { confirmDialog, helpBody, openDialog, variableDialog } from "./dialogs.ts";
import { el } from "./dom.ts";
import { startBlockDrag, startToolboxDrag, type DragDeps } from "./drag.ts";
import { autoSizeControl, syncCBlockFeet } from "./block-view.ts";
import {
  createScriptWith,
  moveScript,
  newBlockInstance,
  removeBlock,
  unplugPort,
} from "./edits.ts";
import { currentLocale, hasKey, setUiLocale, t } from "./i18n.ts";
import { icon } from "./icons.ts";
import { renderInspector } from "./inspector.ts";
import {
  downloadDocument,
  loadAutosave,
  pickDocument,
  projectFileName,
  readDocument,
  saveAutosave,
  type OpenResult,
} from "./persist.ts";
import { Store, type RunStatus } from "./store.ts";
import { toast } from "./toast.ts";
import { renderToolbar } from "./toolbar.ts";
import { renderToolbox } from "./toolbox.ts";
import { renderVariables } from "./variables.ts";
import { createDesktopFiles, createDesktopHost, isDesktopShell } from "./desktop.ts";

import "./styles.css";

const mount = document.querySelector<HTMLElement>("#app");
if (!mount) throw new Error("Editor root element #app is missing");
const host: HTMLElement = mount;
// Real file system in the Tauri shell; the browser keeps the localStorage host.
const desktopHost = isDesktopShell() ? createDesktopHost(handleEvent) : null;
const desktopFiles = desktopHost ? createDesktopFiles() : null;

setUiLocale(currentLocale());

const store = new Store(loadAutosave() ?? createStarterDocument(currentLocale()));
let registry: BlockRegistry = createProjectRegistry(store.state.document.project);
let importErrors: ImportError[] = [];
let importToken = 0;
let importTimer: number | null = null;
const editorHost = desktopHost ?? createLocalHost(handleEvent, window.localStorage);

let controller: AbortController | null = null;
let surface: HTMLElement | null = null;
let frame: number | null = null;
/** Pan offset of the automatic layout. Never stored in the document. */
let viewport = { x: 0, y: 0 };
let autosaveTimer: number | null = null;

const STATUS_KEYS: Record<RunStatus, string> = {
  idle: "status.idle",
  running: "status.running",
  finished: "status.finished",
  stopped: "status.stopped",
  error: "status.error",
};

store.subscribe(() => {
  scheduleRender();
  scheduleAutosave();
  scheduleImportRefresh();
});

void refreshImports(false);

/* ------------------------------------------------------------------ render */

function scheduleRender(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    renderNow();
  });
}

function renderNow(): void {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  const state = store.state;
  const document = state.document;
  const running = state.status === "running";

  const toolbox = renderToolbox({
    registry,
    onInsert: (type) => placeBlockAtCenter(type),
    onDragStart: (event, type) => startToolboxDrag(event, type, dragDeps()),
  });

  const canvas = renderCanvas(document, {
    registry,
    selectedId: state.selectedId,
    variables: document.project.variables,
    zoom: state.zoom,
    viewport,
    interactive: !running,
  });
  surface = canvas.surface;

  const canvasHost = el("div", { class: "canvas-host" }, [canvas.root]);

  const diagnostics = validateQuietly();
  const errorCount =
    diagnostics.filter((diagnostic) => diagnostic.severity === "error").length + importErrors.length;
  const problems = el(
    "button",
    {
      class: `statusbar__problems${errorCount > 0 ? " statusbar__problems--error" : ""}`,
      attrs: { type: "button", title: t("panel.problems") },
      on: { click: () => void showProblems() },
    },
    [
      icon(errorCount > 0 ? "warning" : "terminal", 13),
      el("span", {
        text: diagnostics.length > 0 ? t("problems.count", { count: diagnostics.length }) : t("problems.none"),
      }),
    ],
  );

  const stage = el("section", { class: "stage" }, [
    canvasHost,
    el("div", { class: "statusbar" }, [
      el("span", { class: `status status--${state.status}`, text: t(STATUS_KEYS[state.status]) }),
      problems,
      el("span", { class: "statusbar__spacer" }),
      el("span", { text: t("canvas.blocks", { count: countBlocks(document.project) }) }),
      el("span", { text: `${Math.round(state.zoom * 100)}%` }),
    ]),
  ]);

  const selected = state.selectedId ? findBlock(document.project, state.selectedId) : null;
  const scriptIndex = selected
    ? document.project.scripts.findIndex((script) => script.id === selected.id)
    : -1;

  const side = el("aside", { class: "side" }, [
    renderInspector({
      registry,
      selected,
      variables: document.project.variables,
      onFieldChange: setBlockValue,
      onLiteralChange: setBlockValue,
      onUnplug: (blockId, port) => unplug(blockId, port),
      onDelete: (blockId) => deleteBlock(blockId),
      scriptPosition:
        selected && scriptIndex >= 0
          ? { index: scriptIndex, total: document.project.scripts.length }
          : null,
      onMoveScript: (delta) => moveSelectedScript(delta),
    }),
    renderVariables({
      variables: document.project.variables,
      usage: variableUsage(),
      onAdd: () => void addVariable(),
      onDelete: (id) => void deleteVariable(id),
      onSelectVariable: (id) => selectVariable(id),
      onRename: (id, name) => renameVariable(id, name),
    }),
    renderConsole({
      logs: state.logs,
      onClear: () => store.clearLogs(),
      onSelectBlock: (blockId) => store.select(blockId),
    }),
  ]);

  const toolbar = renderToolbar({
    projectName: document.project.name,
    locale: currentLocale(),
    status: state.status,
    canUndo: store.canUndo(),
    canRedo: store.canRedo(),
    zoom: state.zoom,
    onRun: () => void run(),
    onStop: () => stop(),
    onNew: () => void newProject(),
    onOpen: () => void openProject(),
    onSave: () => void save(),
    onUndo: () => store.undo(),
    onRedo: () => store.redo(),
    onZoomIn: () => store.setZoom(store.state.zoom * 1.2),
    onZoomOut: () => store.setZoom(store.state.zoom / 1.2),
    onZoomReset: () => resetView(),
    onLocaleChange: (locale) => changeLocale(locale),
    onHelp: () => void showHelp(),
    onDocs: () => void showDocs(),
    onRefreshImports: () => void refreshImports(true),
    onRename: (name) => renameProject(name),
  });

  host.replaceChildren(
    el("div", { class: "app" }, [toolbar, el("main", { class: "workspace" }, [toolbox, stage, side])]),
  );
  syncCBlockFeet(host);
  applyViewport();
}

/* -------------------------------------------------------------------- data */

function scheduleImportRefresh(): void {
  if (importTimer !== null) window.clearTimeout(importTimer);
  importTimer = window.setTimeout(() => {
    importTimer = null;
    void refreshImports(false);
  }, 250);
}

async function refreshImports(announce: boolean): Promise<void> {
  const token = ++importToken;
  try {
    const resolved = await resolveImports(store.state.document.project, { host: editorHost });
    if (token !== importToken) return;
    importErrors = resolved.errors;
    registry = createProjectRegistry(resolved.project);
    if (announce) {
      toast(
        importErrors.length > 0
          ? t(importErrors[0]!.messageKey, importErrors[0]!.params)
          : t("toast.importsRefreshed"),
        importErrors.length > 0 ? "error" : "info",
      );
    }
    scheduleRender();
  } catch (error) {
    if (token !== importToken) return;
    importErrors = [
      {
        messageKey: "runtime.error.importUnreadable",
        params: { file: "?", message: error instanceof Error ? error.message : String(error) },
      },
    ];
    scheduleRender();
  }
}

function validateQuietly(): Diagnostic[] {
  try {
    return store.validate(registry);
  } catch {
    return [];
  }
}

function variableUsage(): Map<string, number> {
  const usage = new Map<string, number>();
  walkProject(store.state.document.project, (node) => {
    const definition = registry.get(node.type);
    const field = definition?.fields.find((candidate) => candidate.kind === "variable");
    if (!field) return;
    const id = String(node.fields?.[field.name] ?? "");
    if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
  });
  return usage;
}

function dragDeps(): DragDeps {
  return {
    store,
    registry,
    variables: () => store.state.document.project.variables,
    zoom: () => store.state.zoom,
    surface: () => surface,
    createInstance: (type) => newBlockInstance(registry, store.state.document.project, type),
    placeBlockAtCenter: (type) => placeBlockAtCenter(type),
    selectBlock: (id) => store.select(id),
    toast: (key, level = "error") => toast(t(key), level),
    flush: () => renderNow(),
  };
}

function placeBlockAtCenter(type: string): void {
  const definition = registry.get(type);
  if (!definition) return;
  if (isCatchType(type)) {
    toast(t("toast.catchNeedsTry"), "error");
    return;
  }
  const result = newBlockInstance(registry, store.state.document.project, type);
  if (!result.ok) {
    toast(t(result.reason === "variable" ? "toast.variableRequired" : "toast.dropInvalid"), "error");
    return;
  }

  const node = result.node;
  const state = store.state;
  const selected = state.selectedId ? findBlock(state.document.project, state.selectedId) : null;

  if (definition.kind === "expression" && !selected) {
    toast(t("toast.noTarget"), "error");
    return;
  }

  store.update((document) => {
    if (definition.kind === "hat") {
      document.project.scripts.push(node);
      return;
    }
    if (definition.kind === "expression") {
      const target = selected ? findBlock(document.project, selected.id) : null;
      const parentDef = target ? registry.get(target.type) : undefined;
      const port = target && parentDef
        ? portsOf(parentDef, target).find(
            (candidate) => candidate.kind === "value" && target.inputs?.[candidate.name] === undefined,
          )
        : undefined;
      if (target && port) (target.inputs ??= {})[port.name] = node;
      return;
    }
    const last = document.project.scripts[document.project.scripts.length - 1];
    if (!last) {
      createScriptWith(document, node);
      return;
    }
    const inputs = (last.inputs ??= {});
    const existing = inputs.body;
    const body = Array.isArray(existing) ? existing : [];
    if (!Array.isArray(existing)) inputs.body = body;
    body.push(node);
  });
}

/* ------------------------------------------------------------------ actions */

async function run(): Promise<void> {
  if (store.state.status === "running") return;
  if (store.state.document.project.scripts.length === 0) {
    toast(t("toast.nothingToRun"), "error");
    return;
  }
  controller = new AbortController();
  store.clearLogs();
  store.setStatus("running");
  try {
    await runProject(store.state.document.project, {
      signal: controller.signal,
      onEvent: handleEvent,
      describeFailure: translateFailure,
      // Workspace files live in localStorage in the browser; the desktop
      // shell provides a host backed by the real file system instead.
      ...(desktopHost ? { host: desktopHost } : { storage: window.localStorage }),
    });
  } finally {
    controller = null;
    scheduleAutosave();
  }
}

function stop(): void {
  controller?.abort();
}

/** Best-effort message for anything thrown across the desktop bridge. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Localised text for a caught runtime failure, falling back to its key. */
function translateFailure(failure: RuntimeFailure): string {
  try {
    return t(failure.messageKey, failure.params);
  } catch {
    return failure.messageKey;
  }
}

function handleEvent(event: RuntimeEvent): void {
  switch (event.kind) {
    case "log":
      store.pushLog({ level: event.level, text: event.text, blockId: event.blockId });
      break;
    case "error":
      store.pushLog({
        level: "error",
        text: t(event.messageKey, event.params),
        blockId: event.blockId,
      });
      break;
    case "status":
      if (event.status === "running") {
        store.setStatus("running");
        return;
      }
      store.setStatus(event.status);
      if (event.status === "finished") {
        store.pushLog({
          level: "info",
          text: t("console.finished", { ms: Math.round(event.durationMs ?? 0) }),
        });
      } else if (event.status === "stopped") {
        store.pushLog({ level: "info", text: t("console.stopped") });
      }
      break;
  }
}

async function newProject(): Promise<void> {
  if (store.state.dirty) {
    const proceed = await confirmDialog(t("dialog.newProject.body"), t("dialog.newProject.title"));
    if (!proceed) return;
  }
  const document = createDocument(
    createProject({ name: t("app.untitled"), locale: currentLocale() }),
  );
  store.replaceDocument(document);
  viewport = { x: 0, y: 0 };
  saveAutosave(document);
  toast(t("toast.newProject"));
}

async function openProject(): Promise<void> {
  if (store.state.dirty) {
    const proceed = await confirmDialog(t("dialog.open.body"), t("dialog.open.title"));
    if (!proceed) return;
  }
  const result = desktopFiles ? await openDesktopProject() : await pickDocument();
  if (!result) return;
  if (!result.ok) {
    toast(t("toast.invalidFile", { detail: result.error }), "error");
    return;
  }
  store.replaceDocument(result.document);
  viewport = { x: 0, y: 0 };
  saveAutosave(result.document);
  toast(t("toast.opened"));
  if (result.warnings.length > 0) {
    await openDialog({
      title: t("panel.problems"),
      body: helpBody(result.warnings.join("\n")),
      actions: [{ label: t("common.close"), value: "close", primary: true }],
    });
  }
}

async function openDesktopProject(): Promise<OpenResult | null> {
  let file: { content: string } | null = null;
  try {
    file = await desktopFiles!.open();
  } catch (error) {
    toast(t("toast.openFailed", { detail: errorMessage(error) }), "error");
    return null;
  }
  if (!file) return null;
  return readDocument(file.content);
}

/** Save to a real file: native dialog on desktop, download in the browser. */
async function save(): Promise<void> {
  const document = store.state.document;
  if (desktopFiles) {
    let saved: { path: string } | null = null;
    try {
      saved = await desktopFiles.save(printNblk(document), projectFileName(document));
    } catch (error) {
      toast(t("toast.saveFailed", { detail: errorMessage(error) }), "error");
      return;
    }
    // Cancelling the dialog must not claim a save happened.
    if (!saved) return;
    store.markSaved();
    saveAutosave(document);
    toast(t("toast.savedTo", { path: saved.path }));
    return;
  }
  downloadDocument(document);
  store.markSaved();
  saveAutosave(document);
  toast(t("toast.saved"));
}

function renameProject(name: string): void {
  store.update((document) => {
    document.project.name = name;
  });
}

function resetView(): void {
  viewport = { x: 0, y: 0 };
  store.setZoom(1);
  applyViewport();
}

function changeLocale(locale: string): void {
  setUiLocale(locale);
  store.setLocale(locale);
  renderNow();
}

/* ---------------------------------------------------------------- shortcuts */

function deleteSelected(): void {
  const id = store.state.selectedId;
  if (!id) return;
  deleteBlock(id);
}

function deleteBlock(blockId: string): void {
  store.update((document) => {
    removeBlock(document, blockId);
  });
  store.select(null);
  toast(t("toast.deleted"));
}

function moveSelectedScript(delta: -1 | 1): void {
  const id = store.state.selectedId;
  if (!id) return;
  const scripts = store.state.document.project.scripts;
  const index = scripts.findIndex((script) => script.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= scripts.length) return;
  store.update((document) => {
    moveScript(document.project, id, delta);
  });
}

function unplug(blockId: string, port: string): void {
  store.update((document) => {
    unplugPort(document.project, blockId, port);
  });
}

function setBlockValue(blockId: string, key: string, value: string | number | boolean): void {
  store.update((document) => {
    const block = findBlock(document.project, blockId);
    if (!block) return;
    block.fields ??= {};
    block.fields[key] = value;
  });
}

/** Add/remove a `count`-driven port, dropping inputs that no longer exist. */
function adjustGrowCount(blockId: string, fieldName: string, delta: number): void {
  store.update((document) => {
    const block = findBlock(document.project, blockId);
    const definition = block ? registry.get(block.type) : undefined;
    const field = definition?.fields.find((candidate) => candidate.name === fieldName);
    if (!block || !definition || !field || field.kind !== "count") return;
    const current = countField(block, field);
    const min = field.min ?? 0;
    const max = field.max ?? Number.MAX_SAFE_INTEGER;
    const next = Math.max(min, Math.min(max, current + delta));
    if (next === current) return;
    (block.fields ??= {})[fieldName] = next;
    const names = new Set(portsOf(definition, block).map((port) => port.name));
    for (const port of Object.keys(block.inputs ?? {})) {
      if (!names.has(port)) delete block.inputs![port];
    }
  });
  store.select(blockId);
}

/** Append/remove one parameter on a function definition. */
function adjustParams(blockId: string, fieldName: string, delta: number): void {
  store.update((document) => {
    const block = findBlock(document.project, blockId);
    if (!block) return;
    const parsed = parseParams(String(block.fields?.[fieldName] ?? ""));
    if (parsed.errors.length > 0) return;
    const params = [...parsed.params];
    if (delta > 0) {
      if (params.length >= 8) return;
      let index = 1;
      while (params.some((param) => param.name === `arg${index}`)) index += 1;
      params.push({ name: `arg${index}`, type: "any" });
    } else {
      if (params.length === 0) return;
      params.pop();
    }
    (block.fields ??= {})[fieldName] = formatParams(params);
  });
  store.select(blockId);
}

const VARIABLE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function renameVariable(id: string, rawName: string): string | null {
  const name = rawName.trim();
  if (!VARIABLE_NAME.test(name)) return t("variables.invalidName");

  const project = store.state.document.project;
  const variable = project.variables.find((candidate) => candidate.id === id);
  if (!variable) return null;
  if (project.variables.some((candidate) => candidate.id !== id && candidate.name === name)) {
    return t("variables.duplicateName");
  }
  if (variable.name === name) return null;

  store.update((document) => {
    const target = document.project.variables.find((candidate) => candidate.id === id);
    if (target) target.name = name;
  });
  toast(t("toast.variableRenamed", { name }));
  return null;
}

function selectVariable(id: string): void {
  const variable = store.state.document.project.variables.find((candidate) => candidate.id === id);
  if (variable) toast(variable.name);
}

const VARIABLE_TYPES: ValueType[] = ["any", "text", "number", "boolean", "list", "dict"];

async function addVariable(): Promise<void> {
  const project = store.state.document.project;
  const suggested = nextVariableName(project.variables.map((variable) => variable.name));
  const result = await variableDialog({
    title: t("variables.add"),
    nameLabel: t("variables.promptName"),
    typeLabel: t("variables.type"),
    initialLabel: t("variables.initial"),
    initialName: suggested,
    types: VARIABLE_TYPES.map((type) => ({ value: type, label: t(`type.${type}`) })),
    validateName: (value) => {
      if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value)) return t("variables.invalidName");
      if (project.variables.some((variable) => variable.name === value)) return t("variables.duplicateName");
      return null;
    },
  });
  if (result === null) return;
  const type = result.type as ValueType;
  let initial: Value | null = null;
  if (result.initial !== "") {
    if (type === "number") initial = Number(result.initial);
    else if (type === "boolean") initial = result.initial === "true";
    else if (type === "list" || type === "dict") initial = JSON.parse(result.initial) as Value;
    else initial = result.initial;
  }
  store.update((document) => {
    document.project.variables.push(createVariable(result.name, type, initial));
  });
}

function nextVariableName(existing: readonly string[]): string {
  let index = 1;
  while (existing.includes(`var${index}`)) index += 1;
  return `var${index}`;
}

async function deleteVariable(id: string): Promise<void> {
  const project = store.state.document.project;
  const variable = project.variables.find((candidate) => candidate.id === id);
  if (!variable) return;
  const proceed = await confirmDialog(
    t("variables.confirmDelete", { name: variable.name }),
    t("common.delete"),
  );
  if (!proceed) return;
  store.update((document) => {
    document.project.variables = document.project.variables.filter((candidate) => candidate.id !== id);
    const visit = (node: BlockNode): void => {
      const definition = registry.get(node.type);
      const field = definition?.fields.find((candidate) => candidate.kind === "variable");
      if (field && node.fields?.[field.name] === id) node.fields[field.name] = "";
    };
    walkProject(document.project, (node) => visit(node));
  });
}

/* ------------------------------------------------------------------ dialogs */

async function showProblems(): Promise<void> {
  const diagnostics = validateQuietly();
  const body = el("div", { class: "problems" });
  if (diagnostics.length === 0 && importErrors.length === 0) {
    body.append(el("p", { class: "inspector__hint", text: t("problems.empty") }));
  }
  for (const error of importErrors) {
    body.append(
      el("div", { class: "problems__item problems__item--error" }, [
        el("span", { class: "problems__badge", text: "import" }),
        el("div", {}, [el("div", { text: t(error.messageKey, error.params) })]),
      ]),
    );
  }
  for (const diagnostic of diagnostics) {
    const key = `diag.${diagnostic.code}`;
    body.append(
      el("div", { class: `problems__item problems__item--${diagnostic.severity}` }, [
        el("span", { class: "problems__badge", text: diagnostic.severity }),
        el("div", {}, [
          el("div", {
            text: hasKey(key) ? t(key, diagnostic.params) : diagnostic.message,
          }),
          el("code", { class: "problems__path", text: diagnostic.path }),
        ]),
      ]),
    );
  }
  await openDialog({
    title: t("panel.problems"),
    body,
    actions: [{ label: t("common.close"), value: "close", primary: true }],
  });
}

async function showHelp(): Promise<void> {
  await openDialog({
    title: t("help.title"),
    body: helpBody(t("help.body")),
    actions: [{ label: t("common.close"), value: "close", primary: true }],
  });
}

async function showDocs(): Promise<void> {
  await openDialog({
    title: t("docs.title"),
    body: helpBody(t("docs.body")),
    actions: [{ label: t("common.close"), value: "close", primary: true }],
  });
}

/* --------------------------------------------------------------- view maths */

/** Content starts at the origin: panning left/up stops at 0,0. */
function clampViewport(next: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.min(0, next.x), y: Math.min(0, next.y) };
}

function applyViewport(): void {
  if (!surface) return;
  surface.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${store.state.zoom})`;
}

function scheduleAutosave(): void {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    saveAutosave(store.state.document);
  }, 450);
}

/* ------------------------------------------------------------------ events */

interface PanState {
  startX: number;
  startY: number;
  viewportX: number;
  viewportY: number;
  moved: boolean;
}

let pan: PanState | null = null;

host.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("input, select, textarea")) return;

  const blockEl = target.closest<HTMLElement>(".block");
  // Blocks are only picked up by their head; blank mouth/foot space pans like canvas.
  const onHead = target.closest(".block__head") !== null;
  if (blockEl?.dataset.blockId && onHead && event.button === 0) {
    const node = findBlock(store.state.document.project, blockEl.dataset.blockId);
    // Hats are ordered by the document array; they cannot be repositioned.
    if (node && registry.get(node.type)?.kind === "hat") {
      store.select(blockEl.dataset.blockId);
      return;
    }
    startBlockDrag(event, blockEl.dataset.blockId, dragDeps());
    return;
  }

  if (target.closest(".canvas") && (event.button === 0 || event.button === 1)) {
    pan = {
      startX: event.clientX,
      startY: event.clientY,
      viewportX: viewport.x,
      viewportY: viewport.y,
      moved: false,
    };
  }
});

window.addEventListener("pointermove", (event) => {
  if (!pan) return;
  const dx = event.clientX - pan.startX;
  const dy = event.clientY - pan.startY;
  if (!pan.moved && Math.hypot(dx, dy) < 4) return;
  pan.moved = true;
  viewport = clampViewport({ x: pan.viewportX + dx, y: pan.viewportY + dy });
  applyViewport();
  document.body.classList.add("is-panning");
});

window.addEventListener("pointerup", () => {
  if (!pan) return;
  const moved = pan.moved;
  pan = null;
  document.body.classList.remove("is-panning");
  if (moved) scheduleAutosave();
});

host.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(".toolbox, .topbar, .side, .modal, .toasts")) return;
  const grow = target.closest<HTMLElement>("[data-grow]");
  const growBlock = grow?.closest<HTMLElement>(".block")?.dataset.blockId;
  if (grow && growBlock && grow.dataset.field) {
    adjustGrowCount(growBlock, grow.dataset.field, grow.dataset.grow === "add" ? 1 : -1);
    return;
  }
  const param = target.closest<HTMLElement>("[data-param]");
  const paramBlock = param?.closest<HTMLElement>(".block")?.dataset.blockId;
  if (param && paramBlock && param.dataset.field) {
    adjustParams(paramBlock, param.dataset.field, param.dataset.param === "add" ? 1 : -1);
    return;
  }
  const blockEl = target.closest<HTMLElement>(".block");
  if (blockEl?.dataset.blockId && target.closest(".block__head")) {
    store.select(blockEl.dataset.blockId);
    return;
  }
  if (target.closest(".canvas")) store.select(null);
});

host.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && (target.dataset.field || target.dataset.literal)) {
    autoSizeControl(target);
  }
});

host.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;
  const blockEl = target.closest<HTMLElement>(".block");
  const blockId = blockEl?.dataset.blockId;
  if (!blockId) return;

  const field = target.dataset.field;
  const literal = target.dataset.literal;
  const key = field ?? literal;
  if (!key) return;

  const block = findBlock(store.state.document.project, blockId);
  const definition = block ? registry.get(block.type) : undefined;

  let value: string | number | boolean = target.value;
  if (field) {
    const fieldDef = definition?.fields.find((candidate) => candidate.name === field);
    if (fieldDef?.kind === "number") value = target.value === "" ? 0 : Number(target.value);
    if (fieldDef?.kind === "boolean") value = target.value === "true";
  } else {
    const port = block && definition
      ? portsOf(definition, block).find((candidate) => candidate.name === literal)
      : undefined;
    if (port?.type === "number") value = target.value === "" ? 0 : Number(target.value);
    if (port?.type === "boolean") value = target.value === "true";
  }

  if (block?.fields?.[key] === value) return;
  setBlockValue(blockId, key, value);
});

host.addEventListener(
  "wheel",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".canvas")) return;
    event.preventDefault();
    const state = store.state;
    if (event.ctrlKey || event.metaKey) {
      const canvasEl = target.closest<HTMLElement>(".canvas");
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      const oldZoom = state.zoom;
      const next = Math.min(2, Math.max(0.4, oldZoom * Math.exp(-event.deltaY * 0.0015)));
      if (Math.abs(next - oldZoom) < 0.001) return;
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      const pointX = (anchorX - viewport.x) / oldZoom;
      const pointY = (anchorY - viewport.y) / oldZoom;
      viewport = clampViewport({
        x: anchorX - pointX * next,
        y: anchorY - pointY * next,
      });
      store.setZoom(next);
      applyViewport();
    } else {
      viewport = clampViewport({
        x: viewport.x - event.deltaX,
        y: viewport.y - event.deltaY,
      });
      applyViewport();
    }
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing =
    target instanceof HTMLElement &&
    (target.closest("input, select, textarea") !== null || target.isContentEditable);
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (modifier && key === "s") {
    event.preventDefault();
    void save();
    return;
  }
  if (editing) return;

  if (modifier && key === "z") {
    event.preventDefault();
    if (event.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (modifier && key === "y") {
    event.preventDefault();
    store.redo();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (!store.state.selectedId) return;
    event.preventDefault();
    deleteSelected();
  }
});

/* -------------------------------------------------------------------- boot */

function boot(): void {
  renderNow();
  window.addEventListener("resize", () => {
    // Layout is CSS driven; nothing to recompute for v1.
  });
}

boot();
