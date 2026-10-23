import type { BlockRegistry } from "@nexus/engine";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

export interface ToolboxOptions {
  registry: BlockRegistry;
  onInsert: (type: string) => void;
  onDragStart: (event: PointerEvent, type: string) => void;
}

export function renderToolbox(options: ToolboxOptions): HTMLElement {
  const search = el("input", {
    class: "input input--search",
    attrs: { type: "search", placeholder: t("toolbox.search"), "aria-label": t("toolbox.search") },
  });

  const list = el("div", { class: "toolbox__list" });
  const empty = el("p", { class: "toolbox__empty", text: t("toolbox.noResults", { query: "" }) });
  empty.hidden = true;

  const rows: { row: HTMLElement; haystack: string }[] = [];

  for (const { category, blocks } of options.registry.grouped()) {
    const section = el("section", { class: "toolbox__group", dataset: { category } });
    section.append(el("h3", { class: "toolbox__group-title", text: t(`category.${category}`) }));
    for (const definition of blocks) {
      const label = t(definition.label);
      const row = el("div", {
        class: "toolbox__item",
        dataset: { toolbox: definition.type, kind: definition.kind },
        attrs: { title: `${label}\n${definition.type}`, role: "button", tabindex: "0" },
      });
      row.style.setProperty("--block-color", definition.color);
      row.append(
        el("span", { class: "toolbox__swatch" }),
        el("span", { class: "toolbox__label", text: label }),
      );
      row.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        options.onDragStart(event, definition.type);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          options.onInsert(definition.type);
        }
      });
      section.append(row);
      rows.push({ row, haystack: `${label} ${definition.type}`.toLowerCase() });
    }
    list.append(section);
  }

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const { row, haystack } of rows) {
      const match = query === "" || haystack.includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    }
    for (const section of list.querySelectorAll<HTMLElement>(".toolbox__group")) {
      const hasVisible = [...section.querySelectorAll<HTMLElement>(".toolbox__item")].some(
        (item) => !item.hidden,
      );
      section.hidden = !hasVisible;
    }
    empty.hidden = visible > 0;
    if (visible === 0) empty.textContent = t("toolbox.noResults", { query: search.value.trim() });
  });

  return el("aside", { class: "toolbox" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: t("toolbox.title") }),
    ]),
    el("div", { class: "toolbox__search" }, [search]),
    list,
    empty,
  ]);
}
