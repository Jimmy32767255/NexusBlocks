import { el } from "./dom.ts";

let container: HTMLElement | null = null;

/** Transient message in the bottom-left corner; never blocks the editor. */
export function toast(message: string, kind: "info" | "error" = "info"): void {
  if (!container) {
    container = el("div", { class: "toasts", attrs: { "aria-live": "polite" } });
    document.body.append(container);
  }
  const item = el("div", { class: `toast toast--${kind}`, text: message });
  container.append(item);
  setTimeout(() => {
    item.classList.add("toast--out");
    setTimeout(() => item.remove(), 220);
  }, 2800);
}
