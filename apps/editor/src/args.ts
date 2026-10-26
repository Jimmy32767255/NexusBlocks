/** Split a command line typed by the user into program arguments. */
export function parseArguments(text: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let pending = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote !== null) {
      if (char === "\\" && quote === '"' && index + 1 < text.length) {
        index += 1;
        current += text[index]!;
        pending = true;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      pending = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      pending = true;
      continue;
    }
    if (char === "\\" && index + 1 < text.length) {
      index += 1;
      current += text[index]!;
      pending = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (pending) {
        args.push(current);
        current = "";
        pending = false;
      }
      continue;
    }
    current += char;
    pending = true;
  }
  if (pending) args.push(current);
  return args;
}

/** Render arguments back into an editable command line. */
export function formatArguments(args: readonly string[]): string {
  return args
    .map((arg) => (/[\s"'\\]/.test(arg) || arg === "" ? `"${arg.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : arg))
    .join(" ");
}
