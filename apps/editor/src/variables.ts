import { toDisplayText, type Value } from "@nexus/ir";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

export interface VariablesOptions {
  /** Live values keyed by variable name; empty until the program declares one. */
  values: Record<string, Value> | null;
}

/**
 * Read-only panel listing the variables that exist at run time. Variables are
 * created and deleted by blocks, so the panel mirrors the interpreter instead
 * of editing the document.
 */
export function renderVariables(options: VariablesOptions): HTMLElement {
  const entries = Object.entries(options.values ?? {});
  const list = el("div", { class: "variables__list" });

  if (entries.length === 0) {
    list.append(el("p", { class: "variables__empty", text: t("variables.empty") }));
  }

  for (const [name, value] of entries) {
    list.append(
      el("div", { class: "variables__item" }, [
        el("span", { class: "variables__dot" }),
        el("span", { class: "variables__name", text: name }),
        el("code", { class: "variables__value", text: formatValue(value) }),
      ]),
    );
  }

  return el("section", { class: "variables" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: t("panel.variables") }),
    ]),
    list,
  ]);
}

function formatValue(value: Value | undefined): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? JSON.stringify(value) : toDisplayText(value);
}
