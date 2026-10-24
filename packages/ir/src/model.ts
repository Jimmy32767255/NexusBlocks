/**
 * Core data model of the Nexus Blocks language.
 *
 * The IR is deliberately UI-agnostic: it knows about blocks, ports and values,
 * but nothing about pixels, canvases or editors. Every front end (visual
 * editor, future text view, CLI runner) serialises to and from this model.
 */

/** Marker written into every serialised language document. */
export const IR_FORMAT = "nexus-blocks/ir" as const;

/** Current language revision. Bump together with a migration step. */
export const IR_VERSION = 1;

export type BlockId = string;

/** Value types understood by the language and its type checker. */
export type ValueType =
  | "any"
  | "void"
  | "text"
  | "number"
  | "boolean"
  | "list"
  | "dict";

export const VALUE_TYPES: readonly ValueType[] = [
  "any",
  "void",
  "text",
  "number",
  "boolean",
  "list",
  "dict",
];

/**
 * Runtime value representation. Kept to plain JSON so that programs can cross
 * a process or IPC boundary without a custom codec.
 */
export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };

/** Shape of a block on the canvas. */
export type BlockKind = "hat" | "statement" | "expression";

/** A literal stored directly on a block (text input, dropdown, ...). */
export type FieldValue = string | number | boolean;

/**
 * One block instance.
 *
 * Stacks are arrays and expressions are single nodes, so a program is a tree.
 * The representation is intentionally close to an AST: a future text view can
 * render it, and a future compiler can lower it without touching the editor.
 */
export interface BlockNode {
  /** Unique inside one project; used by the editor for positions and undo. */
  id: BlockId;
  /** Block definition key, e.g. `io.print`. */
  type: string;
  /** Inline literals, keyed by field name. Empty/absent when unset. */
  fields?: Record<string, FieldValue>;
  /** Child blocks: expressions for value ports, arrays for stack ports. */
  inputs?: Record<string, BlockNode | BlockNode[]>;
}

export interface VariableDef {
  id: string;
  name: string;
  type: ValueType;
  /** Literal initial value; `null` means "type default". */
  initial: Value | null;
}

/**
 * Function definitions are part of the model from day one, but the v0.1
 * editor does not create them yet. Keeping the field reserved avoids a file
 * format migration when functions land.
 */
export interface FunctionDef {
  id: string;
  name: string;
  params: { id: string; name: string; type: ValueType }[];
  returnType: ValueType;
  body: BlockNode[];
}

/**
 * A single executable entry point. Scripts are top-level hat blocks; the hat's
 * stack port holds the body that runs when the hat fires.
 */
export interface Project {
  format: typeof IR_FORMAT;
  version: number;
  id: string;
  name: string;
  /** BCP 47 tag used by generated output and as the editor's default locale. */
  locale: string;
  createdAt: string;
  updatedAt: string;
  variables: VariableDef[];
  functions: FunctionDef[];
  scripts: BlockNode[];
  /** Extension bag; unknown keys are preserved across save/load. */
  metadata: Record<string, unknown>;
}

/**
 * Editor-only debugging metadata. It travels with the autosave document but is
 * deliberately omitted from `.nblk` files: code files stay plain programs.
 */
export interface DebugState {
  breakpoints: BlockId[];
}

/** The on-disk document: the program plus its format marker. */
export interface NexusDocument {
  format: "nexus-blocks/document";
  version: 2;
  project: Project;
  debug?: DebugState;
}

export const DOCUMENT_FORMAT = "nexus-blocks/document" as const;
export const DOCUMENT_VERSION = 2;

/** One block connected to a port, as declared by a block definition. */
export type PortKind = "value" | "stack";

export interface PortDef {
  name: string;
  /** Translation key, e.g. `block.io.print.port.text`. */
  label: string;
  kind: PortKind;
  /** Expected type for value ports. Ignored for stack ports. */
  type?: ValueType;
  /** Literal used when no expression block is plugged in. */
  default?: FieldValue;
}

export type FieldKind = "text" | "number" | "select" | "boolean" | "variable" | "count" | "params";

export interface FieldOption {
  value: string;
  /** Display text for the option (operators such as `+` are language-neutral). */
  label: string;
  /** Optional translation key; takes precedence over `label` in the editor. */
  labelKey?: string;
}

export interface FieldDef {
  name: string;
  kind: FieldKind;
  /** Translation key, e.g. `block.control.repeat.field.times`. */
  label: string;
  default: FieldValue;
  options?: FieldOption[];
  /** Soft validation hint for text/number fields. */
  required?: boolean;
  /** Bounds for `count` fields (how many ports/params the block currently uses). */
  min?: number;
  max?: number;
}

/** Ports of a block instance, including any that depend on its state. */
export function portsOf(schema: BlockSchema, node: BlockNode): PortDef[] {
  return schema.dynamicPorts ? schema.dynamicPorts(node) : schema.ports;
}

/** Read a bounded `count` field, falling back to its schema default. */
export function countField(
  node: BlockNode,
  field: FieldDef | undefined,
  fallback = 0,
): number {
  const raw = node.fields?.[field?.name ?? ""];
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : field?.default;
  const number = typeof value === "number" ? value : fallback;
  const min = field?.min ?? 0;
  const max = field?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

/**
 * Everything the validator needs to know about a block type. The engine's
 * richer `BlockDefinition` extends this with execution handlers.
 */
export interface BlockSchema {
  type: string;
  kind: BlockKind;
  /** Grouping used by the toolbox, e.g. `io`. */
  category: string;
  /** Translation key for the block label. */
  label: string;
  /** Translation key for the description shown in the toolbox/detail panel. */
  description?: string;
  /** Output type for expression blocks; `void` for statements and hats. */
  output: ValueType;
  fields: FieldDef[];
  ports: PortDef[];
  /**
   * Ports that depend on the block's own state, e.g. the number of join inputs
   * or else-if branches. When present it fully replaces `ports`.
   */
  dynamicPorts?: (node: BlockNode) => PortDef[];
  /** Kept in the registry for old documents but never offered in the toolbox. */
  hidden?: boolean;
  /** Statement that ends control flow, so nothing can be attached underneath. */
  terminal?: boolean;
}
