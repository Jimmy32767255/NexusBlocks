import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const SYSTEM = CATEGORY_COLORS.system;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local `YYYY-MM-DD HH:mm:ss` for the current instant. */
export function formatOsTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export const timeBlocks: BlockDefinition[] = [
  {
    type: "time.get_os_time",
    kind: "expression",
    category: "system",
    label: "block.time.getOsTime.label",
    description: "block.time.getOsTime.description",
    output: "text",
    color: SYSTEM,
    fields: [],
    ports: [],
    evaluate() {
      return formatOsTime(new Date());
    },
  },
];
