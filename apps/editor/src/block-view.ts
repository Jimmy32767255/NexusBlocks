import type { BlockDefinition, BlockRegistry } from "@nexus/engine";
import { countField, portsOf, type BlockNode, type FieldDef, type PortDef } from "@nexus/ir";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

const MEASURE_FONT = '12.5px "Inter", "Segoe UI", system-ui, sans-serif';
let measureContext: CanvasRenderingContext2D | null = null;

function measureText(text: string): number {
  if (typeof document === "undefined") return text.length * 7;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 7;
  measureContext.font = MEASURE_FONT;
  return measureContext.measureText(text).width;
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.ceil(value)));
}

/** Resize an inline field/select to roughly the width of its current content. */
export function autoSizeControl(control: HTMLInputElement | HTMLSelectElement): void {
  if (control.tagName === "SELECT") {
    const select = control as HTMLSelectElement;
    const label = select.selectedOptions[0]?.textContent ?? "";
    select.style.width = `${clampWidth(measureText(label) + 42, 64, 220)}px`;
    return;
  }
  const input = control as HTMLInputElement;
  if (input.type === "number") {
    input.style.width = `${clampWidth(measureText(input.value) + 24, 44, 170)}px`;
    return;
  }
  input.style.width = `${clampWidth(measureText(input.value) + 22, 54, 320)}px`;
}

export interface BlockRenderContext {
  registry: BlockRegistry;
  selectedId: string | null;
  variables: readonly { id: string; name: string }[];
  interactive: boolean;
}

/** Render one block, recursing into plugged expressions and nested stacks. */
export function renderBlock(node: BlockNode, context: BlockRenderContext): HTMLElement {
  const definition = context.registry.get(node.type);
  if (!definition) {
    return el("div", {
      class: "block block--unknown",
      text: `? ${node.type}`,
      dataset: { blockId: node.id, blockType: node.type },
    });
  }

  const ports = portsOf(definition, node);
  const root = el("div", {
    class: [
      "block",
      `block--${definition.kind}`,
      definition.category === "comment" ? "block--comment" : "",
      ports.some((port) => port.kind === "stack") ? "block--c" : "",
      definition.terminal ? "block--terminal" : "",
      context.selectedId === node.id ? "block--selected" : "",
    ]
      .filter(Boolean)
      .join(" "),
    dataset: { blockId: node.id, blockType: node.type },
    attrs: { title: t(definition.label) },
    style: { "--block-color": definition.color },
  });

  const head = el("div", { class: "block__head" }, [
    el("span", { class: "block__label", text: t(definition.label) }),
  ]);

  for (const field of definition.fields) {
    head.append(renderField(node, field, context));
  }

  for (const port of ports) {
    if (port.kind !== "value") continue;
    head.append(renderValuePort(node, port, context));
  }

  root.append(head);

  for (const port of ports) {
    if (port.kind !== "stack") continue;
    root.append(renderStack(node, port, context));
  }

  if (ports.some((port) => port.kind === "stack")) root.append(el("div", { class: "block__foot" }));

  return root;
}

/**
 * Stretch each C-block's bottom lip to the width of the block it wraps last, so
 * nested scripts end flush instead of inheriting the widest child's width.
 */
export function syncCBlockFeet(root: ParentNode): void {
  if (typeof window === "undefined") return;
  const wrappers = Array.from(root.querySelectorAll<HTMLElement>(".block--c")).reverse();
  for (const wrapper of wrappers) {
    const foot = Array.from(wrapper.children).find((child) =>
      (child as HTMLElement).classList?.contains("block__foot"),
    ) as HTMLElement | undefined;
    if (!foot) continue;
    const mouth = wrapper.querySelector<HTMLElement>(":scope > .block__mouth");
    const children = mouth?.querySelectorAll<HTMLElement>(":scope > .stack > .block") ?? [];
    const last = children[children.length - 1];
    const reference = last ?? wrapper.querySelector<HTMLElement>(":scope > .block__head");
    const width = reference?.getBoundingClientRect().width ?? 0;
    if (width > 0) foot.style.width = `${width}px`;
  }
}

function valueChild(node: BlockNode, port: string): BlockNode | null {
  const value = node.inputs?.[port];
  return value && !Array.isArray(value) ? value : null;
}

function renderField(node: BlockNode, field: FieldDef, context: BlockRenderContext): HTMLElement {
  const raw = node.fields?.[field.name] ?? field.default;
  const title = t(field.label);

  switch (field.kind) {
    case "count": {
      const current = countField(node, field);
      const min = field.min ?? 0;
      const max = field.max ?? Number.MAX_SAFE_INTEGER;
      const step = (action: "add" | "remove") =>
        el("button", {
          class: "block__step",
          text: action === "add" ? "+" : "−",
          attrs: {
            type: "button",
            title: t(action === "add" ? "block.grow.add" : "block.grow.remove"),
            "aria-label": t(action === "add" ? "block.grow.add" : "block.grow.remove"),
            disabled: !context.interactive || (action === "add" ? current >= max : current <= min),
          },
          dataset: { grow: action, field: field.name },
        });
      return el("span", { class: "block__counter", attrs: { title } }, [
        step("remove"),
        el("span", { class: "block__counter-value", text: String(current) }),
        step("add"),
      ]);
    }
    case "params": {
      const input = el("input", {
        class: "block__input block__params",
        attrs: {
          type: "text",
          value: String(raw),
          title,
          "aria-label": title,
          placeholder: "a:text, b:number",
          disabled: !context.interactive,
        },
        dataset: { field: field.name },
      });
      autoSizeControl(input);
      const button = (action: "add" | "remove") =>
        el("button", {
          class: "block__step",
          text: action === "add" ? "+" : "−",
          attrs: {
            type: "button",
            title: t(action === "add" ? "block.grow.addParam" : "block.grow.removeParam"),
            "aria-label": t(action === "add" ? "block.grow.addParam" : "block.grow.removeParam"),
            disabled: !context.interactive,
          },
          dataset: { param: action, field: field.name },
        });
      return el("span", { class: "block__params-group" }, [input, button("remove"), button("add")]);
    }
    case "number": {
      const input = el("input", {
        class: "block__input block__input--number",
        attrs: {
          type: "number",
          step: "any",
          value: String(raw),
          title,
          "aria-label": title,
          disabled: !context.interactive,
        },
        dataset: { field: field.name },
      });
      autoSizeControl(input);
      return input;
    }
    case "select": {
      const select = el("select", {
        class: "block__input block__select",
        attrs: { title, "aria-label": title, disabled: !context.interactive },
        dataset: { field: field.name },
      });
      for (const option of field.options ?? []) {
        select.append(
          el("option", {
            text: option.labelKey ? t(option.labelKey) : option.label,
            attrs: { value: option.value, selected: option.value === raw },
          }),
        );
      }
      autoSizeControl(select);
      return select;
    }
    case "boolean": {
      const select = el("select", {
        class: "block__input block__select",
        attrs: { title, "aria-label": title, disabled: !context.interactive },
        dataset: { field: field.name },
      });
      for (const value of [true, false]) {
        select.append(
          el("option", {
            text: t(value ? "common.true" : "common.false"),
            attrs: { value: String(value), selected: value === raw },
          }),
        );
      }
      autoSizeControl(select);
      return select;
    }
    case "variable": {
      if (context.variables.length === 0) {
        return el("span", { class: "block__input block__input--empty", text: "—", attrs: { title } });
      }
      const select = el("select", {
        class: "block__input block__select",
        attrs: { title, "aria-label": title, disabled: !context.interactive },
        dataset: { field: field.name },
      });
      for (const variable of context.variables) {
        select.append(
          el("option", {
            text: variable.name,
            attrs: { value: variable.id, selected: variable.id === raw },
          }),
        );
      }
      autoSizeControl(select);
      return select;
    }
    case "text":
    default: {
      const text = String(raw ?? "");
      const input = el("input", {
        class: "block__input block__input--text",
        attrs: {
          type: "text",
          value: text,
          size: Math.max(2, Math.min(24, text.length + 1)),
          title,
          "aria-label": title,
          disabled: !context.interactive,
        },
        dataset: { field: field.name },
      });
      autoSizeControl(input);
      return input;
    }
  }
}

function renderValuePort(node: BlockNode, port: PortDef, context: BlockRenderContext): HTMLElement {
  const child = valueChild(node, port.name);
  const type = port.type ?? "any";
  const chip = el("span", {
    class: `port port--${type}${child ? " port--filled" : ""}`,
    dataset: { drop: "value", parent: node.id, port: port.name, type },
    attrs: { title: t(port.label) },
  });

  if (child) {
    chip.append(renderBlock(child, context));
  } else {
    const raw = node.fields?.[port.name];
    const value = raw === undefined ? port.default ?? "" : raw;
    if (type === "boolean") {
      const select = el("select", {
        class: "port__input port__select",
        attrs: { disabled: !context.interactive },
      });
      for (const option of [true, false]) {
        select.append(
          el("option", {
            text: t(option ? "common.true" : "common.false"),
            attrs: { value: String(option), selected: option === value },
          }),
        );
      }
      select.dataset.literal = port.name;
      autoSizeControl(select);
      chip.append(select);
    } else {
      const text = String(value ?? "");
      const input = el("input", {
        class: "port__input",
        attrs: {
          type: type === "number" ? "number" : "text",
          step: "any",
          value: text,
          size: Math.max(2, Math.min(20, text.length + 1)),
          disabled: !context.interactive,
        },
      });
      input.dataset.literal = port.name;
      autoSizeControl(input);
      chip.append(input);
    }
  }

  const group = el("span", { class: "port-group" }, [chip]);
  if (port.name !== "text") {
    group.append(el("span", { class: "port__label", text: t(port.label) }));
  }
  return group;
}

function renderStack(node: BlockNode, port: PortDef, context: BlockRenderContext): HTMLElement {
  const raw = node.inputs?.[port.name];
  const stack = Array.isArray(raw) ? raw : [];
  const mouth = el("div", { class: "block__mouth" });
  const section = el("div", { class: "stack" });
  section.append(el("span", { class: "stack__caption", text: t(port.label) }));
  for (let index = 0; index <= stack.length; index += 1) {
    section.append(
      el("div", {
        class: "stack__slot",
        dataset: { drop: "stack", parent: node.id, port: port.name, index: String(index) },
      }),
    );
    const child = stack[index];
    if (child) section.append(renderBlock(child, context));
  }
  mouth.append(section);
  return mouth;
}
