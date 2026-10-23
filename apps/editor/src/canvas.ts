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
  interactive: boolean;
}

export interface CanvasView {
  root: HTMLElement;
  surface: HTMLElement;
}

/** Render all top-level scripts at their stored positions. */
export function renderCanvas(document: NexusDocument, options: CanvasOptions): CanvasView {
  const viewport = document.editor.viewport;
  const surface = el("div", {
    class: "canvas__surface",
    style: {
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${options.zoom})`,
    },
  });

  const context = {
    registry: options.registry,
    selectedId: options.selectedId,
    variables: options.variables,
    interactive: options.interactive,
  };

  for (const hat of document.project.scripts) {
    const position = document.editor.positions[hat.id] ?? { x: 64, y: 64 };
    const wrapper = el("div", {
      class: "script",
      dataset: { script: hat.id },
      style: { left: `${position.x}px`, top: `${position.y}px` },
    });
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
