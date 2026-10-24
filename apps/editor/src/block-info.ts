import { portsOf, type BlockNode, type BlockSchema, type ValueType } from "@nexus/ir";
import { el } from "./dom.ts";
import { t } from "./i18n.ts";

/** A value port exposed as a formal parameter in the block's detail sheet. */
export interface BlockParam {
  name: string;
  type: ValueType;
}

/** Everything the hover tooltip and the detail dialog need about one block. */
export interface BlockDescription {
  /** `expression` blocks compute a value; everything else performs an action. */
  kind: "expression" | "action";
  /** Hat / normal / terminal for actions; `none` for expressions. */
  subtype: "hat" | "normal" | "terminal" | "none";
  hasStack: boolean;
  extensible: boolean;
  desktopOnly: boolean;
  params: BlockParam[];
  returnType: ValueType | null;
}

/**
 * A throwaway instance with every field at its default, so state-dependent
 * ports (extra join inputs, else-if branches, …) can be inspected.
 */
function sampleNode(schema: BlockSchema): BlockNode {
  const fields: Record<string, string | number | boolean> = {};
  for (const field of schema.fields) fields[field.name] = field.default;
  return { id: "sample", type: schema.type, fields };
}

export function describeBlock(schema: BlockSchema): BlockDescription {
  const ports = portsOf(schema, sampleNode(schema));
  const params = ports
    .filter((port) => port.kind === "value")
    .map((port) => ({ name: port.label, type: port.type ?? "any" }));
  const hasStack = ports.some((port) => port.kind === "stack");
  const expression = schema.kind === "expression";

  let subtype: BlockDescription["subtype"] = "none";
  if (!expression) {
    if (schema.kind === "hat") subtype = "hat";
    else if (schema.terminal) subtype = "terminal";
    else subtype = "normal";
  }

  return {
    kind: expression ? "expression" : "action",
    subtype,
    hasStack,
    extensible: Boolean(schema.dynamicPorts),
    desktopOnly: schema.platforms === "desktop",
    params,
    returnType: expression ? schema.output : null,
  };
}

function typeLabel(type: ValueType): string {
  return t(`type.${type}`);
}

function row(label: string, value: string): HTMLElement {
  return el("div", { class: "block-detail__row" }, [
    el("dt", { class: "block-detail__label", text: label }),
    el("dd", { class: "block-detail__value", text: value }),
  ]);
}

/** Body of the detail dialog: types, capabilities, parameters and result. */
export function renderBlockDetails(schema: BlockSchema): HTMLElement {
  const info = describeBlock(schema);
  const body = el("div", { class: "block-detail" });

  body.append(
    el("p", { class: "block-detail__type", text: schema.type }),
    el("dl", { class: "block-detail__list" }, [
      row(
        t("toolbox.detail.kind"),
        t(info.kind === "expression" ? "toolbox.detail.kind.value" : "toolbox.detail.kind.action"),
      ),
      row(
        t("toolbox.detail.subtype"),
        t(
          info.subtype === "none"
            ? "toolbox.detail.subtype.none"
            : `toolbox.detail.subtype.${info.subtype}`,
        ),
      ),
      row(
        t("toolbox.detail.os"),
        t(info.desktopOnly ? "toolbox.detail.os.desktop" : "toolbox.detail.os.any"),
      ),
      row(t("toolbox.detail.cshape"), t(info.hasStack ? "common.yes" : "common.no")),
      row(t("toolbox.detail.extensible"), t(info.extensible ? "common.yes" : "common.no")),
      row(t("toolbox.detail.params"), t("toolbox.detail.paramCount", { count: info.params.length })),
      row(
        t("toolbox.detail.return"),
        info.returnType ? typeLabel(info.returnType) : t("toolbox.detail.return.none"),
      ),
    ]),
  );

  const table = el("table", { class: "block-detail__params" });
  table.append(
    el("caption", { class: "block-detail__caption", text: t("toolbox.detail.paramTable") }),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { attrs: { scope: "col" }, text: t("toolbox.detail.paramName") }),
        el("th", { attrs: { scope: "col" }, text: t("toolbox.detail.paramType") }),
      ]),
    ]),
  );
  const tbody = el("tbody");
  if (info.params.length === 0) {
    tbody.append(
      el("tr", {}, [
        el("td", { attrs: { colspan: "2" }, text: t("common.none") }),
      ]),
    );
  }
  for (const param of info.params) {
    tbody.append(
      el("tr", {}, [
        el("td", { text: t(param.name) }),
        el("td", { text: typeLabel(param.type) }),
      ]),
    );
  }
  table.append(tbody);
  body.append(table);
  return body;
}
