import type { RunStatus } from "./store.ts";
import { el } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { LOCALES, t } from "./i18n.ts";

export interface ToolbarOptions {
  projectName: string;
  locale: string;
  status: RunStatus;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  onRun: () => void;
  onStop: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onLocaleChange: (locale: string) => void;
  onHelp: () => void;
  onDocs: () => void;
  onRefreshImports: () => void;
  onRename: (name: string) => void;
}

export function renderToolbar(options: ToolbarOptions): HTMLElement {
  const running = options.status === "running";

  const name = el("input", {
    class: "project-name",
    attrs: {
      type: "text",
      value: options.projectName,
      "aria-label": t("app.projectName"),
      title: t("app.projectName"),
      spellcheck: "false",
    },
  });
  name.addEventListener("change", () => {
    const next = name.value.trim();
    if (next && next !== options.projectName) options.onRename(next);
    else name.value = options.projectName;
  });

  const language = el("select", {
    class: "language-select",
    attrs: { "aria-label": t("toolbar.language"), title: t("toolbar.language") },
  });
  for (const locale of LOCALES) {
    language.append(
      el("option", {
        text: locale.nativeName,
        attrs: { value: locale.code, selected: locale.code === options.locale },
      }),
    );
  }
  language.addEventListener("change", () => options.onLocaleChange(language.value));

  const runButton = el(
    "button",
    {
      class: "button button--run",
      attrs: { type: "button", title: t("toolbar.run") },
      on: { click: options.onRun },
    },
    [icon("play", 15), el("span", { text: t("toolbar.run") })],
  );

  const stopButton = el(
    "button",
    {
      class: "button button--stop",
      attrs: { type: "button", title: t("toolbar.stop"), disabled: !running },
      on: { click: options.onStop },
    },
    [icon("stop", 15), el("span", { text: t("toolbar.stop") })],
  );

  const iconButton = (name: IconName, title: string, handler: () => void, disabled = false): HTMLElement =>
    el(
      "button",
      {
        class: "icon-button",
        attrs: { type: "button", title, "aria-label": title, disabled },
        on: { click: handler },
      },
      [icon(name)],
    );

  return el("header", { class: "topbar" }, [
    el("div", { class: "brand" }, [
      el("span", { class: "brand__mark", html: brandMark() }),
      el("span", { class: "brand__name", text: "Nexus Blocks" }),
    ]),
    name,
    el("div", { class: "topbar__actions" }, [
      runButton,
      stopButton,
      el("span", { class: "topbar__divider" }),
      iconButton("undo", t("toolbar.undo"), options.onUndo, !options.canUndo),
      iconButton("redo", t("toolbar.redo"), options.onRedo, !options.canRedo),
      el("span", { class: "topbar__divider" }),
      iconButton("plus", t("toolbar.new"), options.onNew),
      iconButton("folder", t("toolbar.open"), options.onOpen),
      iconButton("save", t("toolbar.save"), options.onSave),
      el("span", { class: "topbar__divider" }),
      iconButton("zoomOut", t("toolbar.zoomOut"), options.onZoomOut),
      el("span", { class: "zoom-readout", text: `${Math.round(options.zoom * 100)}%` }),
      iconButton("zoomIn", t("toolbar.zoomIn"), options.onZoomIn),
      iconButton("reset", t("toolbar.zoomReset"), options.onZoomReset),
      el("span", { class: "topbar__divider" }),
      language,
      iconButton("help", t("toolbar.help"), options.onHelp),
      iconButton("book", t("toolbar.docs"), options.onDocs),
      iconButton("refresh", t("toolbar.refreshImports"), options.onRefreshImports),
    ]),
  ]);
}

function brandMark(): string {
  return `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
    <defs><linearGradient id="nexus-logo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6ea8ff"/><stop offset="1" stop-color="#b789ff"/>
    </linearGradient></defs>
    <rect x="2" y="2" width="12" height="12" rx="3" fill="url(#nexus-logo)"/>
    <rect x="18" y="2" width="12" height="12" rx="3" fill="url(#nexus-logo)" opacity=".55"/>
    <rect x="2" y="18" width="12" height="12" rx="3" fill="url(#nexus-logo)" opacity=".55"/>
    <rect x="18" y="18" width="12" height="12" rx="3" fill="url(#nexus-logo)"/>
  </svg>`;
}
