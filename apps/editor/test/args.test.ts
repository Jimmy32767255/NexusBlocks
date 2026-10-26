import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatArguments, parseArguments } from "../src/args.ts";

describe("program arguments", () => {
  it("splits on whitespace", () => {
    assert.deepEqual(parseArguments("one two  3"), ["one", "two", "3"]);
  });

  it("keeps quoted text together", () => {
    assert.deepEqual(parseArguments('--name "Ada Lovelace" \'x y\''), ["--name", "Ada Lovelace", "x y"]);
  });

  it("supports escapes and empty quoted arguments", () => {
    assert.deepEqual(parseArguments('a\\ b "" c'), ["a b", "", "c"]);
  });

  it("returns no arguments for blank input", () => {
    assert.deepEqual(parseArguments("   \n\t "), []);
  });

  it("round-trips through formatArguments", () => {
    const args = ["plain", "with space", 'quote"inside', ""];
    assert.deepEqual(parseArguments(formatArguments(args)), args);
  });
});
