import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

export interface VariablesOptions {
  variables: readonly { id: string; name: string }[];
  usage: ReadonlyMap<string, number>;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSelectVariable: (id: string) => void;
  /** Commits a new name; returns an error message to keep editing, or null. */
  onRename: (id: string, name: string) => string | null;
}

export function renderVariables(options: VariablesOptions): HTMLElement {
  const list = el("div", { class: "variables__list" });

  if (options.variables.length === 0) {
    list.append(el("p", { class: "variables__empty", text: t("variables.empty") }));
  }

  for (const variable of options.variables) {
    const used = options.usage.get(variable.id) ?? 0;
    const name = el("button", {
      class: "variables__name",
      text: variable.name,
      attrs: {
        type: "button",
        title: `${t("variables.usedBy", { count: used })}\n${t("variables.renameHint")}`,
      },
      on: { click: () => options.onSelectVariable(variable.id) },
    });
    const row = el("div", { class: "variables__item" }, [
      el("span", { class: "variables__dot" }),
      name,
      el("span", { class: "variables__usage", text: String(used) }),
      el("button", {
        class: "icon-button icon-button--danger",
        attrs: { type: "button", title: t("variables.delete") },
        on: { click: () => options.onDelete(variable.id) },
      }, [icon("trash", 14)]),
    ]);
    list.append(row);

    name.addEventListener("dblclick", (event) => {
      event.preventDefault();
      beginRename(variable.id, variable.name, name, row, options);
    });
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

function beginRename(
  id: string,
  current: string,
  name: HTMLElement,
  row: HTMLElement,
  options: VariablesOptions,
): void {
  const input = el("input", {
    class: "input variables__rename",
    attrs: {
      type: "text",
      value: current,
      "aria-label": t("variables.promptName"),
      spellcheck: "false",
    },
  });
  let settled = false;
  const error = el("p", { class: "variables__error" });
  error.hidden = true;

  const cancel = (): void => {
    if (settled) return;
    settled = true;
    error.remove();
    input.replaceWith(name);
  };

  name.replaceWith(input);
  row.after(error);
  input.focus();
  input.select();

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const next = input.value.trim();
      if (next === current) {
        cancel();
        return;
      }
      const message = options.onRename(id, next);
      if (message) {
        error.textContent = message;
        error.hidden = false;
        input.focus();
        return;
      }
      settled = true;
      error.remove();
      input.replaceWith(name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });

  input.addEventListener("blur", () => {
    if (settled) return;
    const next = input.value.trim();
    if (next === current) {
      cancel();
      return;
    }
    const message = options.onRename(id, next);
    if (message) {
      error.textContent = message;
      error.hidden = false;
      // Keep the failed value visible; the user can fix it or press Escape.
      return;
    }
    settled = true;
    error.remove();
    input.replaceWith(name);
  });
}
