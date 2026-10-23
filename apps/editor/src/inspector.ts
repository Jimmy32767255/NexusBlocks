import type { BlockRegistry } from "@nexus/engine";
import type { BlockNode, FieldDef, PortDef } from "@nexus/ir";
import { el } from "./dom.ts";
import { icon } from "./icons.ts";
import { t } from "./i18n.ts";

export interface InspectorOptions {
  registry: BlockRegistry;
  selected: BlockNode | null;
  variables: readonly { id: string; name: string }[];
  onFieldChange: (blockId: string, field: string, value: string | number | boolean) => void;
  onLiteralChange: (blockId: string, port: string, value: string | number | boolean) => void;
  onUnplug: (blockId: string, port: string) => void;
  onDelete: (blockId: string) => void;
  /** Position in `project.scripts` when the block is a top-level hat. */
  scriptPosition?: { index: number; total: number } | null;
  onMoveScript?: (delta: -1 | 1) => void;
}

export function renderInspector(options: InspectorOptions): HTMLElement {
  const panel = el("aside", { class: "inspector" }, [
    el("header", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: t("inspector.title") }),
    ]),
  ]);

  const node = options.selected;
  const definition = node ? options.registry.get(node.type) : undefined;
  if (!node || !definition) {
    panel.append(el("p", { class: "inspector__empty", text: t("inspector.empty") }));
    return panel;
  }

  const body = el("div", { class: "inspector__body" });

  body.append(
    el("div", { class: "inspector__headline" }, [
      el("span", { class: "chip chip--kind", text: t(`inspector.kind.${definition.kind}`) }),
      el("span", { class: "chip chip--type", text: definition.output }),
    ]),
    el("h3", { class: "inspector__name", text: t(definition.label) }),
  );
  if (definition.description) {
    body.append(el("p", { class: "inspector__description", text: t(definition.description) }));
  }
  body.append(el("code", { class: "inspector__type", text: definition.type }));

  if (options.scriptPosition && options.onMoveScript) {
    const { index, total } = options.scriptPosition;
    const up = index > 0;
    const down = index < total - 1;
    const moveButton = (delta: -1 | 1, enabled: boolean, labelKey: string, iconName: "arrowUp" | "arrowDown") =>
      el(
        "button",
        {
          class: "button button--small button--order",
          attrs: {
            type: "button",
            disabled: !enabled,
            title: t(labelKey),
            "aria-label": t(labelKey),
          },
          on: { click: () => options.onMoveScript?.(delta) },
        },
        [icon(iconName, 15)],
      );
    body.append(
      el("div", { class: "inspector__section" }, [
        el("h4", { class: "inspector__section-title", text: t("inspector.order") }),
        el("div", { class: "inspector__order" }, [
          el("span", {
            class: "inspector__order-position",
            text: t("inspector.orderPosition", { index: index + 1, total }),
          }),
          el("div", { class: "inspector__order-buttons" }, [
            moveButton(-1, up, "inspector.moveUp", "arrowUp"),
            moveButton(1, down, "inspector.moveDown", "arrowDown"),
          ]),
        ]),
        el("p", { class: "inspector__hint", text: t("inspector.orderHint") }),
      ]),
    );
  }

  const fields = el("div", { class: "inspector__section" });
  fields.append(el("h4", { class: "inspector__section-title", text: t("inspector.fields") }));
  if (definition.fields.length === 0) {
    fields.append(el("p", { class: "inspector__hint", text: t("inspector.noFields") }));
  }
  for (const field of definition.fields) {
    fields.append(renderInspectorField(node, field, options));
  }
  body.append(fields);

  const ports = el("div", { class: "inspector__section" });
  ports.append(el("h4", { class: "inspector__section-title", text: t("inspector.ports") }));
  const valuePorts = definition.ports.filter((port) => port.kind === "value");
  if (valuePorts.length === 0) {
    ports.append(el("p", { class: "inspector__hint", text: t("inspector.noPorts") }));
  }
  for (const port of valuePorts) {
    ports.append(renderInspectorPort(node, port, options));
  }
  body.append(ports);

  body.append(
    el("div", { class: "inspector__actions" }, [
      el(
        "button",
        {
          class: "button button--danger",
          attrs: { type: "button" },
          on: { click: () => options.onDelete(node.id) },
        },
        [icon("trash", 16), el("span", { text: t("inspector.deleteBlock") })],
      ),
    ]),
  );

  panel.append(body);
  return panel;
}

function renderInspectorField(node: BlockNode, field: FieldDef, options: InspectorOptions): HTMLElement {
  const raw = node.fields?.[field.name] ?? field.default;
  const label = t(field.label);
  const row = el("label", { class: "field" }, [el("span", { class: "field__label", text: label })]);
  let control: HTMLElement;

  switch (field.kind) {
    case "number": {
      const input = el("input", {
        class: "input",
        attrs: { type: "number", step: "any", value: String(raw) },
      });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        options.onFieldChange(node.id, field.name, Number.isFinite(value) ? value : 0);
      });
      control = input;
      break;
    }
    case "select":
    case "boolean": {
      const select = el("select", { class: "input" });
      const entries: { value: string; label: string }[] =
        field.kind === "select"
          ? (field.options ?? []).map((option) => ({ value: option.value, label: option.label }))
          : [
              { value: "true", label: t("common.true") },
              { value: "false", label: t("common.false") },
            ];
      for (const entry of entries) {
        select.append(
          el("option", {
            text: entry.label,
            attrs: { value: entry.value, selected: entry.value === String(raw) },
          }),
        );
      }
      select.addEventListener("change", () => {
        options.onFieldChange(node.id, field.name, field.kind === "boolean" ? select.value === "true" : select.value);
      });
      control = select;
      break;
    }
    case "variable": {
      const select = el("select", { class: "input" });
      if (options.variables.length === 0) {
        select.append(el("option", { text: t("inspector.noVariables"), attrs: { value: "" } }));
      }
      for (const variable of options.variables) {
        select.append(
          el("option", {
            text: variable.name,
            attrs: { value: variable.id, selected: variable.id === String(raw) },
          }),
        );
      }
      select.addEventListener("change", () => options.onFieldChange(node.id, field.name, select.value));
      control = select;
      break;
    }
    case "text":
    default: {
      const input = el("input", { class: "input", attrs: { type: "text", value: String(raw ?? "") } });
      input.addEventListener("change", () => options.onFieldChange(node.id, field.name, input.value));
      control = input;
      break;
    }
  }

  row.append(control);
  return row;
}

function renderInspectorPort(node: BlockNode, port: PortDef, options: InspectorOptions): HTMLElement {
  const plugged = node.inputs?.[port.name];
  const connected = plugged !== undefined && !Array.isArray(plugged);
  const row = el("div", { class: "field" }, [
    el("span", { class: "field__label", text: t(port.label) }),
  ]);

  if (connected) {
    row.append(
      el("div", { class: "field__row" }, [
        el("code", { class: "field__value", text: String((plugged as BlockNode).type) }),
        el("button", {
          class: "button button--small",
          text: t("inspector.clearInput"),
          attrs: { type: "button" },
          on: { click: () => options.onUnplug(node.id, port.name) },
        }),
      ]),
    );
    return row;
  }

  const raw = node.fields?.[port.name] ?? port.default ?? "";
  let control: HTMLElement;
  if (port.type === "boolean") {
    const select = el("select", { class: "input" });
    for (const value of [true, false]) {
      select.append(
        el("option", {
          text: t(value ? "common.true" : "common.false"),
          attrs: { value: String(value), selected: String(raw) === String(value) },
        }),
      );
    }
    select.addEventListener("change", () => options.onLiteralChange(node.id, port.name, select.value === "true"));
    control = select;
  } else {
    const input = el("input", {
      class: "input",
      attrs: { type: port.type === "number" ? "number" : "text", step: "any", value: String(raw) },
    });
    input.addEventListener("change", () => {
      const value = port.type === "number" ? Number(input.value) || 0 : input.value;
      options.onLiteralChange(node.id, port.name, value);
    });
    control = input;
  }
  row.append(control);
  return row;
}
