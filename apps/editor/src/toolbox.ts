import type { BlockDefinition, BlockRegistry } from "@nexus/engine";
import { renderBlockDetails } from "./block-info.ts";
import { openDialog } from "./dialogs.ts";
import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

const TIP_DELAY_MS = 600;

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

/** Keep the scissors where the user left them: every render rebuilds the list. */
let savedScrollTop = 0;
let activeList: HTMLElement | null = null;

/** Re-apply the remembered offset once the rebuilt list is in the document. */
export function restoreToolboxScroll(): void {
  if (activeList) activeList.scrollTop = savedScrollTop;
}

window.addEventListener("scroll", hideTip, true);

let tipTimer: number | null = null;
let hideTimer: number | null = null;
let tipElement: HTMLElement | null = null;

/** Remove the tip immediately and cancel any pending timers. */
function hideTip(): void {
  if (tipTimer !== null) window.clearTimeout(tipTimer);
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  tipTimer = null;
  hideTimer = null;
  tipElement?.remove();
  tipElement = null;
}

/**
 * Hide after a short grace period so the pointer can travel from the row to
 * the tooltip and click its "more" link without it vanishing.
 */
function hideTipSoon(): void {
  // Cancel a pending appearance right away: leaving must never pop a tip.
  if (tipTimer !== null) window.clearTimeout(tipTimer);
  tipTimer = null;
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideTip, 160);
}

/** Show the short hover card under `anchor`, with a link to the full sheet. */
function showTip(anchor: HTMLElement, definition: BlockDefinition): void {
  hideTip();
  const tip = el("div", { class: "block-tip", attrs: { role: "tooltip" } });
  tip.append(
    el("div", { class: "block-tip__title", text: t(definition.label) }),
    el("div", { class: "block-tip__type", text: definition.type }),
  );
  if (definition.description) {
    tip.append(el("p", { class: "block-tip__text", text: t(definition.description) }));
  }
  const more = el("button", {
    class: "block-tip__more",
    text: t("toolbox.tip.more"),
    attrs: { type: "button" },
  });
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    hideTip();
    void openDialog({
      title: t(definition.label),
      body: renderBlockDetails(definition),
      actions: [{ label: t("common.close"), value: "close" }],
    });
  });
  tip.append(more);

  const rect = anchor.getBoundingClientRect();
  tip.style.left = `${Math.round(rect.left + 8)}px`;
  tip.style.top = `${Math.round(rect.bottom + 6)}px`;
  tip.addEventListener("pointerenter", () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    hideTimer = null;
  });
  tip.addEventListener("pointerleave", hideTipSoon);
  document.body.append(tip);
  tipElement = tip;
}

/** Start the hover timer; drags and pointer-out cancel it. */
function scheduleTip(anchor: HTMLElement, definition: BlockDefinition): void {
  hideTip();
  if (document.body.classList.contains("is-dragging")) return;
  tipTimer = window.setTimeout(() => {
    tipTimer = null;
    showTip(anchor, definition);
  }, TIP_DELAY_MS);
}

export interface ToolboxOptions {
  registry: BlockRegistry;
  onInsert: (type: string) => void;
  onDragStart: (event: PointerEvent, type: string) => void;
}

export function renderToolbox(options: ToolboxOptions): HTMLElement {
  hideTip();
  const search = el("input", {
    class: "input input--search",
    attrs: { type: "search", placeholder: t("toolbox.search"), "aria-label": t("toolbox.search") },
  });

  const list = el("div", { class: "toolbox__list" });
  activeList = list;
  list.addEventListener("scroll", () => {
    savedScrollTop = list.scrollTop;
  });
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
      const isC =
        definition.ports.some((port) => port.kind === "stack") ||
        definition.type === "control.if";
      row.append(
        el("span", {
          class: [
            "toolbox__swatch",
            `toolbox__swatch--${definition.kind}`,
            isC ? "toolbox__swatch--c" : "",
            definition.terminal ? "toolbox__swatch--terminal" : "",
          ]
            .filter(Boolean)
            .join(" "),
        }),
        el("span", { class: "toolbox__label", text: label }),
      );
      row.addEventListener("pointerenter", () => scheduleTip(row, definition));
      row.addEventListener("pointerleave", hideTipSoon);
      row.addEventListener("focus", () => scheduleTip(row, definition));
      row.addEventListener("blur", hideTipSoon);
      row.addEventListener("pointerdown", (event) => {
        hideTip();
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

  return el("div", { class: "toolbox__body" }, [
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
