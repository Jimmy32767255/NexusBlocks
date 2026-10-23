import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

export interface VariablesOptions {
  variables: readonly { id: string; name: string }[];
  usage: ReadonlyMap<string, number>;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSelectVariable: (id: string) => void;
}

export function renderVariables(options: VariablesOptions): HTMLElement {
  const list = el("div", { class: "variables__list" });

  if (options.variables.length === 0) {
    list.append(el("p", { class: "variables__empty", text: t("variables.empty") }));
  }

  for (const variable of options.variables) {
    const used = options.usage.get(variable.id) ?? 0;
    const row = el("div", { class: "variables__item" }, [
      el("span", { class: "variables__dot" }),
      el("button", {
        class: "variables__name",
        text: variable.name,
        attrs: { type: "button", title: t("variables.usedBy", { count: used }) },
        on: { click: () => options.onSelectVariable(variable.id) },
      }),
      el("span", { class: "variables__usage", text: String(used) }),
      el("button", {
        class: "icon-button icon-button--danger",
        attrs: { type: "button", title: t("variables.delete") },
        on: { click: () => options.onDelete(variable.id) },
      }, [icon("trash", 14)]),
    ]);
    list.append(row);
  }

  return el("section", { class: "variables" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: t("panel.variables") }),
      el("button", {
        class: "button button--small",
        attrs: { type: "button" },
        on: { click: options.onAdd },
      }, [icon("plus", 14), el("span", { text: t("variables.add") })]),
    ]),
    list,
  ]);
}
