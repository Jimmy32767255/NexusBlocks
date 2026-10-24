import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

export interface DialogAction {
  label: string;
  value: string;
  primary?: boolean;
}

export interface DialogOptions {
  title: string;
  body?: Node | string;
  actions: DialogAction[];
}

function mount(card: HTMLElement, onClose: () => void): () => void {
  const overlay = el("div", { class: "modal" }, [card]);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) onClose();
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  window.addEventListener("keydown", onKey);
  document.body.append(overlay);
  return () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey);
  };
}

/** Promise-based modal; resolves with the chosen action value or null. */
export function openDialog(options: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let unmount = (): void => {};

    const close = (value: string | null): void => {
      unmount();
      resolve(value);
    };

    const card = el("div", {
      class: "modal__card",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": options.title },
    });

    const body = el("div", { class: "modal__body" });
    if (typeof options.body === "string") body.textContent = options.body;
    else if (options.body) body.append(options.body);

    const actions = el("div", { class: "modal__actions" });
    for (const action of options.actions) {
      actions.append(
        el("button", {
          class: action.primary ? "button button--primary" : "button",
          text: action.label,
          attrs: { type: "button" },
          on: { click: () => close(action.value) },
        }),
      );
    }

    card.append(
      el("header", { class: "modal__head" }, [
        el("h2", { class: "modal__title", text: options.title }),
        el(
          "button",
          {
            class: "icon-button",
            attrs: { type: "button", title: t("common.close") },
            on: { click: () => close(null) },
          },
          [icon("close", 18)],
        ),
      ]),
      body,
      actions,
    );

    unmount = mount(card, () => close(null));
    const focusTarget =
      card.querySelector<HTMLButtonElement>(".button--primary") ?? card.querySelector<HTMLButtonElement>("button");
    focusTarget?.focus();
  });
}

export async function confirmDialog(message: string, title = t("common.confirm")): Promise<boolean> {
  const action = await openDialog({
    title,
    body: message,
    actions: [
      { label: t("common.cancel"), value: "cancel" },
      { label: t("common.confirm"), value: "confirm", primary: true },
    ],
  });
  return action === "confirm";
}

export async function alertDialog(message: string, title: string): Promise<void> {
  await openDialog({
    title,
    body: message,
    actions: [{ label: t("common.close"), value: "close", primary: true }],
  });
}

export interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  /** Return an error message to block submission, or null when valid. */
  validate?: (value: string) => string | null;
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let unmount = (): void => {};
    const close = (value: string | null): void => {
      unmount();
      resolve(value);
    };

    const input = el("input", {
      class: "input",
      attrs: { type: "text", value: options.initial ?? "", autocomplete: "off" },
    });
    const error = el("p", { class: "field-error" });

    const card = el("div", {
      class: "modal__card",
      attrs: { role: "dialog", "aria-modal": "true", "aria-label": options.title },
    });

    const form = el("form", { class: "modal__form" }, [
      el("label", { class: "field" }, [
        el("span", { class: "field__label", text: options.label }),
        input,
      ]),
      error,
    ]);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      const problem = options.validate?.(value) ?? null;
      if (problem) {
        error.textContent = problem;
        input.focus();
        return;
      }
      close(value);
    });

    card.append(
      el("header", { class: "modal__head" }, [
        el("h2", { class: "modal__title", text: options.title }),
        el(
          "button",
          {
            class: "icon-button",
            attrs: { type: "button", title: t("common.close") },
            on: { click: () => close(null) },
          },
          [icon("close", 18)],
        ),
      ]),
      el("div", { class: "modal__body" }, [form]),
      el("div", { class: "modal__actions" }, [
        el("button", {
          class: "button",
          text: t("common.cancel"),
          attrs: { type: "button" },
          on: { click: () => close(null) },
        }),
        el("button", {
          class: "button button--primary",
          text: t("common.confirm"),
          attrs: { type: "button" },
          on: { click: () => form.requestSubmit() },
        }),
      ]),
    );

    unmount = mount(card, () => close(null));
    input.focus();
    input.select();
  });
}

/** Render multi-line help text as a modal body. */
export function helpBody(text: string): HTMLElement {
  const wrapper = el("div", { class: "help-body" });
  for (const line of text.split("\n")) {
    wrapper.append(el("p", { class: "help-line", text: line }));
  }
  return wrapper;
}
