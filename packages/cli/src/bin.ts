import { runCli } from "./main.ts";

const controller = new AbortController();
process.once("SIGINT", () => {
  controller.abort();
  process.exitCode = 130;
});

runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
}, { signal: controller.signal }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`nblk: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
