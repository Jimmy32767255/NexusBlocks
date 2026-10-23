import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const MODULES = CATEGORY_COLORS.modules;

/**
 * Import declarations are hats: they sit on the top level of the canvas, are
 * never executed, and are resolved by the loader before the program starts.
 */
export const moduleBlocks: BlockDefinition[] = [
  {
    type: "import.all",
    kind: "hat",
    category: "modules",
    label: "block.import.all.label",
    description: "block.import.all.description",
    output: "void",
    color: MODULES,
    fields: [
      { name: "file", kind: "text", label: "block.import.field.file", default: "lib.nexus.json", required: true },
    ],
    ports: [],
    execute() {},
  },
  {
    type: "import.named",
    kind: "hat",
    category: "modules",
    label: "block.import.named.label",
    description: "block.import.named.description",
    output: "void",
    color: MODULES,
    fields: [
      { name: "file", kind: "text", label: "block.import.field.file", default: "lib.nexus.json", required: true },
      { name: "name", kind: "text", label: "block.import.field.name", default: "greet", required: true },
    ],
    ports: [],
    execute() {},
  },
  {
    type: "import.alias",
    kind: "hat",
    category: "modules",
    label: "block.import.alias.label",
    description: "block.import.alias.description",
    output: "void",
    color: MODULES,
    fields: [
      { name: "file", kind: "text", label: "block.import.field.file", default: "lib.nexus.json", required: true },
      { name: "name", kind: "text", label: "block.import.field.name", default: "greet", required: true },
      { name: "alias", kind: "text", label: "block.import.field.alias", default: "", required: false },
    ],
    ports: [],
    execute() {},
  },
];
