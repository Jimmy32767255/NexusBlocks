import type { BlockRegistry } from "@nexus/engine";
import {
  formatParams,
  FUNCTION_DEFINE_ACTION_TYPE,
  FUNCTION_DEFINE_VALUE_TYPE,
  isImportType,
  parseParams,
  walkBlocks,
  type BlockNode,
  type NexusDocument,
} from "@nexus/ir";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

export interface HatListOptions {
  document: NexusDocument;
  registry: BlockRegistry;
  selectedId: string | null;
  onSelect: (blockId: string) => void;
}

/** Blocks under one hat, including the hat itself. */
function subtreeSize(hat: BlockNode): number {
  let count = 1;
  const body = hat.inputs?.body;
  walkBlocks(Array.isArray(body) ? body : [], () => {
    count += 1;
  });
  return count;
}

/** A short, human title for a top-level hat: label plus its most useful field. */
function hatTitle(hat: BlockNode, registry: BlockRegistry): string {
  const definition = registry.get(hat.type);
  const label = definition ? t(definition.label) : hat.type;
  if (hat.type === FUNCTION_DEFINE_VALUE_TYPE || hat.type === FUNCTION_DEFINE_ACTION_TYPE) {
    const name = String(hat.fields?.name ?? "").trim();
    const params = formatParams(parseParams(String(hat.fields?.params ?? "")).params);
    return `${label} ${name}(${params})`;
  }
  if (isImportType(hat.type)) {
    return `${label} ${String(hat.fields?.file ?? "")}`;
  }
  return label;
}

/** The hat that owns `blockId`, or null when the block is not in any script. */
function scriptIdOf(document: NexusDocument, blockId: string): string | null {
  for (const hat of document.project.scripts) {
    if (hat.id === blockId) return hat.id;
    let found = false;
    const body = hat.inputs?.body;
    walkBlocks(Array.isArray(body) ? body : [], (node) => {
      if (node.id === blockId) found = true;
    });
    if (found) return hat.id;
  }
  return null;
}

/** A flat, clickable index of every top-level hat, in script order. */
export function renderHatList(options: HatListOptions): HTMLElement {
  const rows = el("div", { class: "hat-list__rows" });
  const active = options.selectedId
    ? scriptIdOf(options.document, options.selectedId)
    : null;

  options.document.project.scripts.forEach((hat, index) => {
    const definition = options.registry.get(hat.type);
    const row = el("div", {
      class: `hat-row${hat.id === active ? " hat-row--active" : ""}`,
      dataset: { hat: hat.id },
      attrs: {
        role: "button",
        tabindex: "0",
        title: t("hats.jump"),
        "aria-current": hat.id === active ? "true" : "false",
      },
    });
    row.style.setProperty("--block-color", definition?.color ?? "#8a94ad");
    row.append(
      el("span", {
        class: [
          "hat-row__swatch",
          `toolbox__swatch--${definition?.kind ?? "statement"}`,
          definition?.terminal ? "toolbox__swatch--terminal" : "",
        ]
          .filter(Boolean)
          .join(" "),
      }),
      el("span", { class: "hat-row__body" }, [
        el("span", { class: "hat-row__title", text: hatTitle(hat, options.registry) }),
        el("span", {
          class: "hat-row__meta",
          text: t("hats.meta", { index: index + 1, count: subtreeSize(hat) }),
        }),
      ]),
    );
    const select = () => options.onSelect(hat.id);
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    rows.append(row);
  });

  if (options.document.project.scripts.length === 0) {
    rows.append(el("p", { class: "hat-list__empty", text: t("hats.empty") }));
  }

  return el("div", { class: "hat-list" }, [rows]);
}
