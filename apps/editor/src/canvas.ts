import type { BlockRegistry } from "@nexus/engine";
import type { NexusDocument } from "@nexus/ir";
import { renderBlock } from "./block-view.ts";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

export interface CanvasOptions {
  registry: BlockRegistry;
  selectedId: string | null;
  variables: readonly { id: string; name: string }[];
  zoom: number;
  viewport: { x: number; y: number };
  interactive: boolean;
}

export interface CanvasView {
  root: HTMLElement;
  surface: HTMLElement;
}

/** Render top-level scripts in document order, left aligned and stacked downwards. */
export function renderCanvas(document: NexusDocument, options: CanvasOptions): CanvasView {
  const surface = el("div", {
    class: "canvas__surface",
    style: {
      transform: `translate(${options.viewport.x}px, ${options.viewport.y}px) scale(${options.zoom})`,
    },
  });

  const context = {
    registry: options.registry,
    selectedId: options.selectedId,
    variables: options.variables,
    interactive: options.interactive,
  };

  for (const hat of document.project.scripts) {
    const wrapper = el("div", { class: "script", dataset: { script: hat.id } });
    wrapper.append(renderBlock(hat, context));
    surface.append(wrapper);
  }

  const root = el("div", { class: "canvas" }, [surface, el("div", { class: "canvas__grid" })]);
  root.dataset.zoom = String(options.zoom);

  if (document.project.scripts.length === 0) {
    root.append(
      el("div", { class: "canvas__empty" }, [
        el("h2", { text: t("canvas.emptyTitle") }),
        el("p", { text: t("canvas.emptyBody") }),
      ]),
    );
  }

  return { root, surface };
}
