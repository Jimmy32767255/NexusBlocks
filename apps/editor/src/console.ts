import type { LogEntry } from "./store.ts";
import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

export interface ConsoleOptions {
  logs: readonly LogEntry[];
  onClear: () => void;
  onSelectBlock: (blockId: string) => void;
}

export function renderConsole(options: ConsoleOptions): HTMLElement {
  const list = el("div", { class: "console__list", attrs: { role: "log", "aria-live": "polite" } });

  if (options.logs.length === 0) {
    list.append(el("p", { class: "console__empty", text: t("console.empty") }));
  }

  for (const log of options.logs) {
    const time = new Date(log.time).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const row = el("div", { class: `console__line console__line--${log.level}` }, [
      el("span", { class: "console__time", text: time }),
      el("span", { class: "console__text", text: log.text }),
    ]);
    if (log.blockId) {
      row.dataset.blockId = log.blockId;
      row.classList.add("console__line--linked");
      row.addEventListener("click", () => options.onSelectBlock(log.blockId!));
    }
    list.append(row);
  }

  queueMicrotask(() => {
    list.scrollTop = list.scrollHeight;
  });

  return el("section", { class: "console" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: t("panel.console") }),
      el("button", {
        class: "icon-button",
        attrs: { type: "button", title: t("console.clear") },
        on: { click: options.onClear },
      }, [icon("trash", 16)]),
    ]),
    list,
  ]);
}
