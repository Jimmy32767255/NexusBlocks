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

function directChild(parent: HTMLElement, selector: string): HTMLElement | null {
  for (const child of parent.children) {
    if (child.matches(selector)) return child as HTMLElement;
  }
  return null;
}

interface BlockWidths {
  /** Width the top bar should span, in px. */
  top: number;
  /** Width the bottom lip should span, in px. */
  bottom: number;
}

const blockWidths = new WeakMap<HTMLElement, BlockWidths>();

/**
 * Make C-shaped blocks staircase: the top bar matches the first wrapped
 * statement and the bottom lip the last one, recursing through nested C blocks.
 * Runs after the canvas is mounted; widths live in inline styles only.
 */
export function applyBlockWidths(root: ParentNode): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".block"));
  for (const block of blocks.reverse()) {
    const head = directChild(block, ".block__head");
    if (!head) continue;
    if (!block.classList.contains("block--c")) {
      const width = Math.ceil(head.getBoundingClientRect().width);
      blockWidths.set(block, { top: width, bottom: width });
      continue;
    }

    const foot = directChild(block, ".block__foot");
    head.style.width = "";
    const natural = Math.ceil(head.getBoundingClientRect().width);
    const stacks: HTMLElement[][] = [];
    for (const mouth of block.children) {
      if (!mouth.classList.contains("block__mouth")) continue;
      const section = directChild(mouth as HTMLElement, ".stack");
      if (!section) continue;
      stacks.push(
        Array.from(section.children).filter(
          (child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains("block"),
        ),
      );
    }
    const first = stacks.find((list) => list.length > 0)?.[0];
    const last = [...stacks].reverse().find((list) => list.length > 0)?.at(-1);
    const top = first
      ? Math.max(natural, first.offsetLeft + (blockWidths.get(first)?.top ?? 0))
      : natural;
    const bottom = last
      ? last.offsetLeft + (blockWidths.get(last)?.bottom ?? 0)
      : natural;
    head.style.width = `${top}px`;
    if (foot) foot.style.width = `${bottom}px`;
    for (const bar of block.children) {
      if (!(bar instanceof HTMLElement) || !bar.classList.contains("block__bar")) continue;
      const mouth = bar.nextElementSibling;
      const section = mouth instanceof HTMLElement ? directChild(mouth, ".stack") : null;
      const child = section
        ? Array.from(section.children).find(
            (candidate): candidate is HTMLElement =>
              candidate instanceof HTMLElement && candidate.classList.contains("block"),
          )
        : undefined;
      bar.style.width = "";
      const barNatural = Math.ceil(bar.getBoundingClientRect().width);
      bar.style.width = child
        ? `${Math.max(barNatural, child.offsetLeft + (blockWidths.get(child)?.top ?? 0))}px`
        : `${barNatural}px`;
    }
    blockWidths.set(block, { top, bottom });
  }
}

export interface BlockRenderContext {
  registry: BlockRegistry;
  selectedId: string | null;
  variables: readonly { id: string; name: string }[];
  interactive: boolean;
  breakpoints?: ReadonlySet<string>;
  debugCurrentId?: string | null;
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
      context.breakpoints?.has(node.id) ? "block--breakpoint" : "",
      context.debugCurrentId === node.id ? "block--debug-current" : "",
    ]
      .filter(Boolean)
      .join(" "),
    dataset: { blockId: node.id, blockType: node.type },
    attrs: { title: t(definition.label) },
    style: { "--block-color": definition.color },
  });

  if (node.type === "control.if") {
    renderIfBody(root, node, definition, context, ports);
    return root;
  }

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
 * if/else-if/else is laid out as separate horizontal bars, one per branch,
 * instead of squeezing every condition into the single head bar.
 */
function renderIfBody(
  root: HTMLElement,
  node: BlockNode,
  definition: BlockDefinition,
  context: BlockRenderContext,
  ports: PortDef[],
): void {
  const head = el("div", { class: "block__head" }, [
    el("span", { class: "block__label", text: t(definition.label) }),
  ]);
  for (const field of definition.fields) head.append(renderField(node, field, context));
  const condition = ports.find((port) => port.name === "condition" && port.kind === "value");
  if (condition) head.append(renderValuePort(node, condition, context));
  root.append(head);

  const thenPort = ports.find((port) => port.name === "then" && port.kind === "stack");
  if (thenPort) root.append(renderStack(node, thenPort, context));

  const ext = Number(node.fields?.elseIfs ?? 0);
  const count = Math.max(0, ext - 1);
  for (let index = 1; index <= count; index += 1) {
    const conditionPort = ports.find((port) => port.name === `elseIf${index}` && port.kind === "value");
    const bar = el("div", { class: "block__bar", dataset: { branch: `elseIf${index}` } }, [
      el("span", { class: "block__label", text: t("block.control.if.elseIf") }),
    ]);
    if (conditionPort) bar.append(renderValuePort(node, conditionPort, context));
    root.append(bar);
    const bodyPort = ports.find((port) => port.name === `elseIf${index}Body` && port.kind === "stack");
    if (bodyPort) root.append(renderStack(node, bodyPort, context, { caption: false }));
  }

  const elseInput = node.inputs?.else;
  const hasElse = Array.isArray(elseInput) && elseInput.length > 0;
  if (ext > 0 || hasElse) {
    root.append(
      el("div", { class: "block__bar block__bar--else", dataset: { branch: "else" } }, [
        el("span", { class: "block__label", text: t("block.control.if.else") }),
      ]),
    );
    const elsePort = ports.find((port) => port.name === "else" && port.kind === "stack");
    if (elsePort) root.append(renderStack(node, elsePort, context, { caption: false }));
  }

  root.append(el("div", { class: "block__foot" }));
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

function renderStack(
  node: BlockNode,
  port: PortDef,
  context: BlockRenderContext,
  options: { caption?: boolean } = {},
): HTMLElement {
  const raw = node.inputs?.[port.name];
  const stack = Array.isArray(raw) ? raw : [];
  const mouth = el("div", { class: "block__mouth" });
  const section = el("div", { class: "stack" });
  if (options.caption !== false) {
    section.append(el("span", { class: "stack__caption", text: t(port.label) }));
  }
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
