import assert from "node:assert/strict";
import { test } from "node:test";
import { createTranslator, en, extraKeys, missingKeys, zhCN } from "../src/index.ts";

test("every English key has a Chinese translation", () => {
  assert.deepEqual(missingKeys(en, zhCN), []);
});

test("no stale Chinese keys", () => {
  assert.deepEqual(extraKeys(en, zhCN), []);
});

test("placeholders survive interpolation", () => {
  const translator = createTranslator({ locale: "zh-CN", catalogs: { en, "zh-CN": zhCN } });
  assert.equal(
    translator.t("runtime.error.badNumber", { value: "abc" }),
    "无法把“abc”转换成数字",
  );
});

test("unknown keys fall back to English, then to the key itself", () => {
  const translator = createTranslator({ locale: "zh-CN", catalogs: { en, "zh-CN": zhCN } });
  assert.equal(translator.t("toolbar.run"), "运行");
  assert.equal(translator.t("does.not.exist"), "does.not.exist");
  assert.equal(translator.missing.has("does.not.exist"), true);
});
