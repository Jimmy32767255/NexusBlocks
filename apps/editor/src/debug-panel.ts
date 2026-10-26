import type { Value } from "@nexus/ir";
import type { DebugFrame } from "@nexus/engine";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";
import { renderVariableItems } from "./variables.ts";

export type DebugTab = "variables" | "stack";

export interface DebugPanelOptions {
  tab: DebugTab;
  values: Record<string, Value> | null;
  stack: DebugFrame[];
  onTabChange: (tab: DebugTab) => void;
}

/**
 * Side panel with tabs for live variables and the current function call stack.
 * Both views are read-only mirrors of the running interpreter.
 */
export function renderDebugPanel(options: DebugPanelOptions): HTMLElement {
  const tabs = el("div", { class: "side-tabs", attrs: { role: "tablist" } });
  const tabButton = (tab: DebugTab, label: string) => {
    const active = options.tab === tab;
    return el(
      "button",
      {
        class: `side-tabs__tab${active ? " is-active" : ""}`,
        attrs: { type: "button", role: "tab", "aria-selected": active ? "true" : "false" },
        on: { click: () => options.onTabChange(tab) },
      },
      [label],
    );
  };
  tabs.append(
    tabButton("variables", t("debug.tab.variables")),
    tabButton("stack", t("debug.tab.stack")),
  );

  const body =
    options.tab === "stack"
      ? renderCallStack(options.stack)
      : renderVariableItems(options.values);

  return el("section", { class: "variables debug-panel" }, [
    el("header", { class: "panel__head" }, [tabs]),
    body,
  ]);
}

/** Innermost call first, top-level scripts last. */
function renderCallStack(stack: readonly DebugFrame[]): HTMLElement {
  const list = el("div", { class: "variables__list stack__list" });
  if (stack.length === 0) {
    list.append(el("p", { class: "variables__empty", text: t("debug.stack.empty") }));
  }
  for (const [index, frame] of [...stack].reverse().entries()) {
    list.append(
      el("div", { class: `stack__item${index === 0 ? " is-current" : ""}` }, [
        el("span", { class: "variables__dot" }),
        el("span", { class: "stack__name", text: frame.name }),
        el("span", { class: "stack__meta", text: t("debug.stack.depth", { depth: String(stack.length - index) }) }),
      ]),
    );
  }
  list.append(
    el("div", { class: "stack__item stack__item--top" }, [
      el("span", { class: "variables__dot" }),
      el("span", { class: "stack__name", text: t("debug.stack.top") }),
    ]),
  );
  return list;
}
