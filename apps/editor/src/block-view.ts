import type { BlockDefinition, BlockRegistry } from "@nexus/engine";
import type { BlockNode, FieldDef, PortDef } from "@nexus/ir";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

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

  const root = el("div", {
    class: [
      "block",
      `block--${definition.kind}`,
      hasStack(definition) ? "block--c" : "",
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

  for (const port of definition.ports) {
    if (port.kind !== "value") continue;
    head.append(renderValuePort(node, port, context));
  }

  root.append(head);

  for (const port of definition.ports) {
    if (port.kind !== "stack") continue;
    root.append(renderStack(node, port, context));
  }

  return root;
}

function hasStack(definition: BlockDefinition): boolean {
  return definition.ports.some((port) => port.kind === "stack");
}

function valueChild(node: BlockNode, port: string): BlockNode | null {
  const value = node.inputs?.[port];
  return value && !Array.isArray(value) ? value : null;
}

function renderField(node: BlockNode, field: FieldDef, context: BlockRenderContext): HTMLElement {
  const raw = node.fields?.[field.name] ?? field.default;
  const title = t(field.label);

  switch (field.kind) {
    case "number": {
      return el("input", {
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
      return select;
    }
    case "text":
    default: {
      const text = String(raw ?? "");
      return el("input", {
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
  return section;
}
