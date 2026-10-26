import { toDisplayText, type Value } from "@nexus/ir";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

/**
 * Read-only list of the variables that exist at run time. Variables are
 * created and deleted by blocks, so the list mirrors the interpreter instead
 * of editing the document.
 */
export function renderVariableItems(values: Record<string, Value> | null): HTMLElement {
  const entries = Object.entries(values ?? {});
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

  return list;
}

function formatValue(value: Value | undefined): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? JSON.stringify(value) : toDisplayText(value);
}
