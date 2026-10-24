import type { BlockRegistry } from "@nexus/engine";
import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

const COLLAPSED_KEY = "nexus-blocks:toolbox-collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Collapse state is a convenience; losing it must never break the toolbox.
  }
}

const collapsedGroups = loadCollapsed();

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
  const groups: { section: HTMLElement; body: HTMLElement; category: string; toggle: HTMLButtonElement }[] = [];

  for (const { category, blocks } of options.registry.grouped()) {
    const section = el("section", { class: "toolbox__group", dataset: { category } });
    const body = el("div", { class: "toolbox__group-body" });
    const toggle = el(
      "button",
      {
        class: "toolbox__group-title",
        attrs: {
          type: "button",
          "aria-expanded": String(!collapsedGroups.has(category)),
          "aria-controls": `toolbox-group-${category}`,
        },
        on: {
          click: () => {
            const nowCollapsed = !collapsedGroups.has(category);
            if (nowCollapsed) collapsedGroups.add(category);
            else collapsedGroups.delete(category);
            saveCollapsed(collapsedGroups);
            syncGroup(section, body, toggle, category, search.value.trim() !== "");
          },
        },
      },
      [
        el("span", { class: "toolbox__group-caret", html: "" }),
        el("span", { class: "toolbox__group-name", text: t(`category.${category}`) }),
      ],
    );
    body.id = `toolbox-group-${category}`;
    section.append(toggle, body);
    syncGroup(section, body, toggle, category, false);
    for (const definition of blocks) {
      const label = t(definition.label);
      const row = el("div", {
        class: "toolbox__item",
        dataset: { toolbox: definition.type, kind: definition.kind },
        attrs: { title: `${label}\n${definition.type}`, role: "button", tabindex: "0" },
      });
      row.style.setProperty("--block-color", definition.color);
      row.append(
        el("span", {
          class: [
            "toolbox__swatch",
            `toolbox__swatch--${definition.kind}`,
            definition.terminal ? "toolbox__swatch--terminal" : "",
          ]
            .filter(Boolean)
            .join(" "),
        }),
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
      body.append(row);
      rows.push({ row, haystack: `${label} ${definition.type}`.toLowerCase() });
    }
    groups.push({ section, body, category, toggle });
    list.append(section);
  }

  const applyFilter = (): void => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const { row, haystack } of rows) {
      const match = query === "" || haystack.includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    }
    for (const group of groups) {
      const hasVisible = [...group.body.querySelectorAll<HTMLElement>(".toolbox__item")].some(
        (item) => !item.hidden,
      );
      // A search always reveals matches, even inside a collapsed group.
      syncGroup(group.section, group.body, group.toggle, group.category, query !== "");
      group.section.hidden = !hasVisible;
    }
    empty.hidden = visible > 0;
    if (visible === 0) empty.textContent = t("toolbox.noResults", { query: search.value.trim() });
  };

  search.addEventListener("input", applyFilter);
  applyFilter();

  return el("aside", { class: "toolbox", dataset: { deleteZone: "true" } }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: t("toolbox.title") }),
      el("span", { class: "toolbox__delete-hint", text: t("toolbox.deleteHint") }),
    ]),
    el("div", { class: "toolbox__search" }, [search]),
    list,
    empty,
  ]);
}

function syncGroup(
  section: HTMLElement,
  body: HTMLElement,
  toggle: HTMLButtonElement,
  category: string,
  searching: boolean,
): void {
  const collapsed = collapsedGroups.has(category);
  const expanded = searching || !collapsed;
  section.classList.toggle("toolbox__group--collapsed", !expanded);
  body.hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
  const caret = toggle.querySelector<HTMLElement>(".toolbox__group-caret");
  if (caret) caret.replaceChildren(icon(expanded ? "chevronDown" : "chevronRight", 12));
  toggle.title = t(expanded ? "toolbox.collapseGroup" : "toolbox.expandGroup", {
    category: t(`category.${category}`),
  });
}
