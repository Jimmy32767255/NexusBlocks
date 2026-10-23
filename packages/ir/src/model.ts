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

/** Canvas-only state. Never consulted when a program runs. */
export interface EditorLayout {
  /** Top-left corner of each top-level (hat) block, in canvas coordinates. */
  positions: Record<BlockId, { x: number; y: number }>;
  viewport: { x: number; y: number; zoom: number };
}

/** The on-disk document: language plus presentation state. */
export interface NexusDocument {
  format: "nexus-blocks/document";
  version: 1;
  project: Project;
  editor: EditorLayout;
}

export const DOCUMENT_FORMAT = "nexus-blocks/document" as const;
export const DOCUMENT_VERSION = 1;

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

export type FieldKind = "text" | "number" | "select" | "boolean" | "variable";

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
}
