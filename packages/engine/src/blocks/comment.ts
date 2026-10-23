import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const COMMENT = CATEGORY_COLORS.comment;

/**
 * Comments are ordinary statements that do nothing at runtime. They exist so
 * a program can explain itself; the interpreter still visits them, which keeps
 * execution order and step counting unchanged.
 */
export const commentBlocks: BlockDefinition[] = [
  {
    type: "comment.note",
    kind: "statement",
    category: "comment",
    label: "block.comment.note.label",
    description: "block.comment.note.description",
    output: "void",
    color: COMMENT,
    fields: [
      {
        name: "text",
        kind: "text",
        label: "block.comment.note.field.text",
        default: "",
      },
    ],
    ports: [],
    async execute() {
      // Intentionally empty: a comment never affects program state.
    },
  },
];
