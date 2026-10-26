import {
  createLocalHost,
  createProjectRegistry,
  createStarterDocument,
  DebugSession,
  resolveImports,
  runProject,
  type BlockRegistry,
  type DebugFrame,
  type ImportError,
  type RuntimeEvent,
  type RuntimeFailure,
} from "@nexus/engine";
import {
  countBlocks,
  createDocument,
  createProject,
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
  type NexusDocument,
  type Value,
  type ValueType,
} from "@nexus/ir";
import { applyBlockWidths } from "./block-view.ts";
import { renderCanvas } from "./canvas.ts";
import { renderConsole } from "./console.ts";
import { confirmDialog, helpBody, openDialog } from "./dialogs.ts";
import { el } from "./dom.ts";
import { startBlockDrag, startToolboxDrag, type DragDeps } from "./drag.ts";
import { autoSizeControl } from "./block-view.ts";
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
import { renderToolbar, setTraceDelayState } from "./toolbar.ts";
import { renderToolbox, restoreToolboxScroll } from "./toolbox.ts";
import { renderHatList } from "./hat-list.ts";
import { renderDebugPanel, type DebugTab } from "./debug-panel.ts";
import { createDesktopCli, createDesktopFiles, createDesktopHost, isDesktopShell } from "./desktop.ts";

import "./styles.css";

const mount = document.querySelector<HTMLElement>("#app");
if (!mount) throw new Error("Editor root element #app is missing");
const host: HTMLElement = mount;
// Real file system in the Tauri shell; the browser keeps the localStorage host.
const desktopHost = isDesktopShell() ? createDesktopHost(handleEvent) : null;
let cliRunner: Awaited<ReturnType<typeof createDesktopCli>> = null;
let cliRunning = false;
void (async () => {
  cliRunner = await createDesktopCli();
})();
const desktopFiles = desktopHost ? createDesktopFiles() : null;

setUiLocale(currentLocale());

const store = new Store(loadAutosave() ?? createStarterDocument(currentLocale()));
let registry: BlockRegistry = createProjectRegistry(store.state.document.project);
let importErrors: ImportError[] = [];
let importToken = 0;
let importTimer: number | null = null;
const editorHost = desktopHost ?? createLocalHost(handleEvent, window.localStorage);

let controller: AbortController | null = null;
let debugSession: DebugSession | null = null;
let debugTrace = false;
let debugPaused = false;
let debugCurrentId: string | null = null;
let debugValues: Record<string, Value> | null = null;
let debugStack: DebugFrame[] = [];
const DEBUG_TAB_KEY = "nexus-blocks:debug-tab";

function loadDebugTab(): DebugTab {
  return localStorage.getItem(DEBUG_TAB_KEY) === "stack" ? "stack" : "variables";
}

let sideTab: DebugTab = loadDebugTab();
let surface: HTMLElement | null = null;
let frame: number | null = null;
/** Pan offset of the automatic layout. Never stored in the document. */
let viewport = { x: 0, y: 0 };
let autosaveTimer: number | null = null;
const TRACE_DELAY_KEY = "nexus-blocks:trace-delay";

function loadTraceDelay(): number {
  const stored = localStorage.getItem(TRACE_DELAY_KEY);
  if (stored === null) return 450;
  const value = Number(stored);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 3000) : 450;
}

let traceDelay = loadTraceDelay();
setTraceDelayState(traceDelay, (milliseconds) => {
  traceDelay = milliseconds;
  localStorage.setItem(TRACE_DELAY_KEY, String(milliseconds));
  debugSession?.setTraceDelay(traceDelay);
});
let focusScriptId: string | null = null;

const LEFT_TAB_KEY = "nexus-blocks:left-tab";

function loadLeftTab(): "toolbox" | "hats" {
  return localStorage.getItem(LEFT_TAB_KEY) === "hats" ? "hats" : "toolbox";
}

let leftTab = loadLeftTab();

function setLeftTab(tab: "toolbox" | "hats"): void {
  leftTab = tab;
  localStorage.setItem(LEFT_TAB_KEY, tab);
  scheduleRender();
}

const STATUS_KEYS: Record<RunStatus, string> = {
  idle: "status.idle",
  running: "status.running",
  paused: "status.paused",
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
  // A timeout (not rAF) keeps updates flowing when the tab is throttled or the
  // webview is not painting, which is common while tracing in the background.
  frame = window.setTimeout(() => {
    frame = null;
    renderNow();
  }, 16);
}

interface Shell {
  app: HTMLElement;
  toolbar: HTMLElement | null;
  tabs: { toolbox: HTMLButtonElement; hats: HTMLButtonElement };
  leftBody: HTMLElement;
  canvasHost: HTMLElement;
  status: HTMLElement;
  problems: HTMLButtonElement;
  blockCount: HTMLElement;
  zoomText: HTMLElement;
  inspector: HTMLElement | null;
  variables: HTMLElement | null;
  console: HTMLElement | null;
}

let shell: Shell | null = null;
const regionDeps: Record<string, unknown[] | undefined> = {};

/** True when one of a region's inputs changed since its last render. */
function dirty(name: string, next: unknown[]): boolean {
  const previous = regionDeps[name];
  if (
    previous &&
    previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]))
  ) {
    return false;
  }
  regionDeps[name] = next;
  return true;
}

/** Diagnostics and block count are document-wide; validate once per document. */
let analysedDocument: NexusDocument | null = null;
let analysedRegistry: BlockRegistry | null = null;
let analysedDiagnostics: Diagnostic[] = [];
let analysedBlocks = 0;

function analyse(document: NexusDocument): { diagnostics: Diagnostic[]; blocks: number } {
  if (analysedDocument === document && analysedRegistry === registry) {
    return { diagnostics: analysedDiagnostics, blocks: analysedBlocks };
  }
  analysedDocument = document;
  analysedRegistry = registry;
  analysedDiagnostics = validateQuietly();
  analysedBlocks = countBlocks(document.project);
  return { diagnostics: analysedDiagnostics, blocks: analysedBlocks };
}

function buildShell(): Shell {
  const tab = (id: "toolbox" | "hats", key: string): HTMLButtonElement =>
    el("button", {
      class: "left-panel__tab",
      text: t(key),
      attrs: { type: "button", role: "tab", "data-left-tab": id },
      on: { click: () => setLeftTab(id) },
    });
  const tabs = { toolbox: tab("toolbox", "sidebar.toolbox"), hats: tab("hats", "sidebar.hats") };
  const leftBody = el("div", { class: "left-panel__body" });
  const left = el("aside", { class: "toolbox left-panel", dataset: { deleteZone: "true" } }, [
    el("div", { class: "left-panel__tabs", attrs: { role: "tablist" } }, [tabs.toolbox, tabs.hats]),
    leftBody,
  ]);

  const canvasHost = el("div", { class: "canvas-host" });
  const status = el("span", { class: "status status--idle" });
  const problems = el("button", {
    class: "statusbar__problems",
    attrs: { type: "button", title: t("panel.problems") },
    on: { click: () => void showProblems() },
  });
  const blockCount = el("span");
  const zoomText = el("span");
  const statusbar = el("div", { class: "statusbar" }, [
    status,
    problems,
    el("span", { class: "statusbar__spacer" }),
    blockCount,
    zoomText,
  ]);
  const stage = el("section", { class: "stage" }, [canvasHost, statusbar]);

  const side = el("aside", { class: "side" });
  const workspace = el("main", { class: "workspace" }, [left, stage, side]);
  const app = el("div", { class: "app" }, [workspace]);

  return {
    app,
    toolbar: null,
    tabs,
    leftBody,
    canvasHost,
    status,
    problems,
    blockCount,
    zoomText,
    inspector: null,
    variables: null,
    console: null,
  };
}

function renderNow(): void {
  if (frame !== null) {
    window.clearTimeout(frame);
    frame = null;
  }
  const state = store.state;
  const document = state.document;
  const running = state.status === "running";
  if (!shell) {
    shell = buildShell();
    host.replaceChildren(shell.app);
  }
  const current = shell;
  const analysis = analyse(document);

  for (const id of ["toolbox", "hats"] as const) {
    const button = current.tabs[id];
    const active = leftTab === id;
    button.classList.toggle("left-panel__tab--active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (dirty("tabs", [currentLocale()])) {
    current.tabs.toolbox.textContent = t("sidebar.toolbox");
    current.tabs.hats.textContent = t("sidebar.hats");
  }

  if (
    dirty("toolbar", [
      document.project.name,
      currentLocale(),
      state.status,
      state.zoom,
      store.canUndo(),
      store.canRedo(),
    ])
  ) {
    const toolbar = renderToolbar({
      projectName: document.project.name,
      locale: currentLocale(),
      status: state.status,
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
      zoom: state.zoom,
      onRun: () => void run(false),
      onRunTrace: () => void run(true),
      traceDelay,
      onTraceDelayChange: (milliseconds) => {
        traceDelay = milliseconds;
        localStorage.setItem(TRACE_DELAY_KEY, String(milliseconds));
        debugSession?.setTraceDelay(traceDelay);
      },
      onPause: () => debugSession?.requestPause(),
      onResume: () => debugSession?.resume(),
      onStep: () => debugSession?.step(),
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
    if (current.toolbar) current.toolbar.replaceWith(toolbar);
    else current.app.prepend(toolbar);
    current.toolbar = toolbar;
  }

  if (
    dirty("left", [
      leftTab,
      registry,
      currentLocale(),
      ...(leftTab === "hats" ? [document, state.selectedId] : []),
    ])
  ) {
    const body =
      leftTab === "toolbox"
        ? renderToolbox({
            registry,
            onInsert: (type) => placeBlockAtCenter(type),
            onDragStart: (event, type) => startToolboxDrag(event, type, dragDeps()),
          })
        : el("div", { class: "toolbox__body" }, [
            renderHatList({
              document,
              registry,
              selectedId: state.selectedId,
              onSelect: (id) => {
                focusScriptId = id;
                store.select(id);
                scheduleRender();
              },
            }),
          ]);
    current.leftBody.replaceChildren(body);
    if (leftTab === "toolbox") restoreToolboxScroll();
  }

  const canvasChanged = dirty("canvas", [
    document,
    registry,
    state.zoom,
    running || state.status === "paused",
  ]);
  if (canvasChanged) {
    const canvas = renderCanvas(document, {
      registry,
      selectedId: state.selectedId,
      zoom: state.zoom,
      viewport,
      interactive: !running && state.status !== "paused",
      breakpoints: store.breakpoints,
      debugCurrentId,
    });
    current.canvasHost.replaceChildren(canvas.root);
    surface = canvas.surface;
    applyBlockWidths(current.canvasHost);
  }

  if (dirty("statusbar", [analysis.diagnostics, importErrors, analysis.blocks, state.status, state.zoom])) {
    current.status.className = `status status--${state.status}`;
    current.status.textContent = t(STATUS_KEYS[state.status]);
    const errorCount =
      analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length +
      importErrors.length;
    current.problems.className = `statusbar__problems${errorCount > 0 ? " statusbar__problems--error" : ""}`;
    current.problems.replaceChildren(
      icon(errorCount > 0 ? "warning" : "terminal", 13),
      el("span", {
        text:
          analysis.diagnostics.length > 0
            ? t("problems.count", { count: analysis.diagnostics.length })
            : t("problems.none"),
      }),
    );
    current.blockCount.textContent = t("canvas.blocks", { count: analysis.blocks });
    current.zoomText.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  const selected = state.selectedId ? findBlock(document.project, state.selectedId) : null;
  const scriptIndex = selected
    ? document.project.scripts.findIndex((script) => script.id === selected.id)
    : -1;

  if (
    dirty("inspector", [
      selected,
      document,
      registry,
      currentLocale(),
      scriptIndex,
      selected ? store.breakpoints.has(selected.id) : false,
    ])
  ) {
    const inspector = renderInspector({
      registry,
      selected,
      onFieldChange: setBlockValue,
      onLiteralChange: setBlockValue,
      onUnplug: (blockId, port) => unplug(blockId, port),
      onDelete: (blockId) => deleteBlock(blockId),
      scriptPosition:
        selected && scriptIndex >= 0
          ? { index: scriptIndex, total: document.project.scripts.length }
          : null,
      onMoveScript: (delta) => moveSelectedScript(delta),
      breakpoint: selected ? store.breakpoints.has(selected.id) : false,
      onToggleBreakpoint: (enabled) => {
        if (!selected) return;
        if (enabled !== store.breakpoints.has(selected.id)) {
          store.toggleBreakpoint(selected.id);
          debugSession?.setBreakpoints(store.breakpoints);
        }
      },
    });
    if (current.inspector) current.inspector.replaceWith(inspector);
    else current.app.querySelector(".side")?.append(inspector);
    current.inspector = inspector;
  }

  if (dirty("debug-side", [debugValues, debugStack, sideTab])) {
    const variables = renderDebugPanel({
      tab: sideTab,
      values: debugValues,
      stack: debugStack,
      onTabChange: (tab) => {
        sideTab = tab;
        localStorage.setItem(DEBUG_TAB_KEY, tab);
        renderNow();
      },
    });
    if (current.variables) current.variables.replaceWith(variables);
    else current.app.querySelector(".side")?.append(variables);
    current.variables = variables;
  }

  if (dirty("console", [state.logs])) {
    const consolePanel = renderConsole({
      logs: state.logs,
      onClear: () => store.clearLogs(),
      onSelectBlock: (blockId) => store.select(blockId),
    });
    if (current.console) current.console.replaceWith(consolePanel);
    else current.app.querySelector(".side")?.append(consolePanel);
    current.console = consolePanel;
  }

  syncTransientState();
  if (focusScriptId) {
    jumpToScript(focusScriptId);
    focusScriptId = null;
  }
  applyViewport();
}

/**
 * Selection, breakpoints and the debug pointer only change classes, so a
 * keystroke in the inspector never rebuilds thousands of blocks.
 */
function syncTransientState(): void {
  const surfaceElement = surface;
  if (!surfaceElement) return;
  const selectedId = store.state.selectedId;
  for (const marked of surfaceElement.querySelectorAll<HTMLElement>(".block--selected")) {
    if (marked.dataset.blockId !== selectedId) marked.classList.remove("block--selected");
  }
  if (selectedId) {
    surfaceElement
      .querySelector<HTMLElement>(`[data-block-id="${CSS.escape(selectedId)}"]`)
      ?.classList.add("block--selected");
  }

  for (const marked of surfaceElement.querySelectorAll<HTMLElement>(".block--debug-current")) {
    if (marked.dataset.blockId !== debugCurrentId) marked.classList.remove("block--debug-current");
  }
  if (debugCurrentId) {
    surfaceElement
      .querySelector<HTMLElement>(`[data-block-id="${CSS.escape(debugCurrentId)}"]`)
      ?.classList.add("block--debug-current");
  }

  const markedBreakpoints = new Set<string>();
  for (const marked of surfaceElement.querySelectorAll<HTMLElement>(".block--breakpoint")) {
    const id = marked.dataset.blockId ?? "";
    if (store.breakpoints.has(id)) markedBreakpoints.add(id);
    else marked.classList.remove("block--breakpoint");
  }
  for (const id of store.breakpoints) {
    if (markedBreakpoints.has(id)) continue;
    surfaceElement
      .querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)
      ?.classList.add("block--breakpoint");
  }
}

/* -------------------------------------------------------------------- data */

function renderLeftPanel(): HTMLElement {
  const tabButton = (id: "toolbox" | "hats", key: string): HTMLButtonElement => {
    const active = leftTab === id;
    return el("button", {
      class: `left-panel__tab${active ? " left-panel__tab--active" : ""}`,
      text: t(key),
      attrs: {
        type: "button",
        role: "tab",
        "aria-selected": active ? "true" : "false",
        "data-left-tab": id,
      },
      on: { click: () => setLeftTab(id) },
    });
  };

  const body =
    leftTab === "toolbox"
      ? renderToolbox({
          registry,
          onInsert: (type) => placeBlockAtCenter(type),
          onDragStart: (event, type) => startToolboxDrag(event, type, dragDeps()),
        })
      : el("div", { class: "toolbox__body" }, [
          renderHatList({
            document: store.state.document,
            registry,
            selectedId: store.state.selectedId,
            onSelect: (id) => {
              focusScriptId = id;
              store.select(id);
              scheduleRender();
            },
          }),
        ]);

  return el("aside", { class: "toolbox left-panel", dataset: { deleteZone: "true" } }, [
    el("div", { class: "left-panel__tabs", attrs: { role: "tablist" } }, [
      tabButton("toolbox", "sidebar.toolbox"),
      tabButton("hats", "sidebar.hats"),
    ]),
    body,
  ]);
}

/** Scroll the canvas so one top-level script sits near the top of the view. */
function jumpToScript(scriptId: string): void {
  const wrapper = surface?.querySelector<HTMLElement>(`[data-script="${CSS.escape(scriptId)}"]`);
  if (!wrapper) return;
  viewport = clampViewport({ x: 0, y: 40 - wrapper.offsetTop * store.state.zoom });
}

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

function dragDeps(): DragDeps {
  return {
    store,
    registry,
    zoom: () => store.state.zoom,
    surface: () => surface,
    createInstance: (type) => newBlockInstance(registry, type),
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
  const result = newBlockInstance(registry, type);
  if (!result.ok) {
    toast(t("toast.dropInvalid"), "error");
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

async function runWithCli(): Promise<void> {
  const runner = cliRunner;
  if (!runner || cliRunning) return;
  cliRunning = true;
  store.clearLogs();
  store.setStatus("running");
  scheduleRender();
  try {
    const schemas = new Map(registry.all().map((definition) => [definition.type, definition]));
    await runner.run(printNblk(store.state.document, schemas), currentLocale(), (value) => {
      const event = value as {
        kind?: string;
        text?: string;
        message?: string;
        status?: RunStatus;
      } | null;
      const kind = event?.kind;
      if (kind === "log") {
        store.pushLog({ level: "info", text: String(event?.text ?? "") });
      } else if (kind === "error" || kind === "stderr") {
        store.pushLog({ level: "error", text: String(event?.message ?? event?.text ?? "") });
      } else if (kind === "status" && event?.status) {
        store.setStatus(event.status);
      }
      scheduleRender();
    });
  } catch {
    toast(t("toast.cliFailed"), "error");
  } finally {
    cliRunning = false;
    if (store.state.status === "running") store.setStatus("idle");
  }
}

async function run(trace = false): Promise<void> {
  if (controller || cliRunning) return;
  if (store.state.document.project.scripts.length === 0) {
    toast(t("toast.nothingToRun"), "error");
    return;
  }
  if (cliRunner && !trace && store.breakpoints.size === 0) {
    await runWithCli();
    return;
  }
  controller = new AbortController();
  debugTrace = trace;
  debugPaused = false;
  debugCurrentId = null;
  debugValues = null;
  const session = new DebugSession({
    signal: controller.signal,
    traceDelay: trace ? traceDelay : 0,
    breakpoints: store.breakpoints,
    onStatement: (blockId, stack) => {
      debugCurrentId = blockId;
      debugStack = stack;
      if (trace) {
        scheduleRender();
        requestAnimationFrame(() => focusBlock(blockId));
      }
    },
    onPause: (blockId, values, stack) => {
      debugPaused = true;
      debugCurrentId = blockId;
      debugValues = values as Record<string, Value>;
      debugStack = stack;

      store.setStatus("paused");
      scheduleRender();
      requestAnimationFrame(() => focusBlock(blockId));
    },
    onResume: () => {
      debugPaused = false;
      store.setStatus("running");
    },
    onVariables: (values, stack) => {
      debugValues = values as Record<string, Value>;
      debugStack = stack;


      if (trace || debugPaused) scheduleRender();
    },
  });
  debugSession = session;
  store.clearLogs();
  store.setStatus("running");
  try {
    await runProject(store.state.document.project, {
      signal: controller.signal,
      debug: session,
      onEvent: handleEvent,
      describeFailure: translateFailure,
      // Workspace files live in localStorage in the browser; the desktop
      // shell provides a host backed by the real file system instead.
      ...(desktopHost ? { host: desktopHost } : { storage: window.localStorage }),
    });
  } finally {
    debugSession = null;
    controller = null;
    debugTrace = false;
    debugPaused = false;
    debugCurrentId = null;
    debugValues = null;
    debugStack = [];
    scheduleAutosave();
    scheduleRender();
  }
}

function stop(): void {
  controller?.abort();
  debugSession?.requestStop();
  if (cliRunning) void cliRunner?.stop();
}

/** Keep the highlighted statement inside the stage while tracing or paused. */
function focusBlock(blockId: string): void {
  if (!surface) return;
  const stage = surface.closest(".canvas-host") as HTMLElement | null;
  const target = surface.querySelector<HTMLElement>(
    `.block[data-block-id="${CSS.escape(blockId)}"]`,
  );
  if (!stage || !target) return;
  const stageRect = stage.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const pad = 64;
  let dx = 0;
  let dy = 0;
  if (rect.left < stageRect.left + pad) dx = stageRect.left + pad - rect.left;
  else if (rect.right > stageRect.right - pad) dx = stageRect.right - pad - rect.right;
  if (rect.top < stageRect.top + pad) dy = stageRect.top + pad - rect.top;
  else if (rect.bottom > stageRect.bottom - pad) dy = stageRect.bottom - pad - rect.bottom;
  if (dx === 0 && dy === 0) return;
  viewport = clampViewport({ x: viewport.x + dx, y: viewport.y + dy });
  applyViewport();
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
      saved = await desktopFiles.save(printNblk(document, registry), projectFileName(document));
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
  downloadDocument(document, registry);
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

  if (event.key === "F8") {
    event.preventDefault();
    if (store.state.status === "paused") debugSession?.resume();
    else if (store.state.status === "running") debugSession?.requestPause();
    return;
  }
  if (event.key === "F10") {
    event.preventDefault();
    debugSession?.step();
    return;
  }

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
