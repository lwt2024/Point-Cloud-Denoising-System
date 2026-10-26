import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = new URL("../dist/assets/", import.meta.url);
const filename = (await readdir(assets)).find((file) =>
  /^cloud\.worker-.*\.js$/.test(file),
);
assert.ok(filename, "Build frontend before running worker checks");
let response;
globalThis.self = {
  postMessage: (value) => {
    response = value;
  },
};
await import(new URL(filename, assets));
async function validate(text, reference = false, name = "input.xyz") {
  response = undefined;
  await self.onmessage({ data: { file: new File([text], name), reference } });
  return response;
}

test("140K point input produces a faithful summary, hash and full preview", async () => {
  const content = "1000000000.123 2 -3 255\r\n".repeat(140000);
  const { result, error } = await validate(content);
  assert.equal(error, undefined);
  assert.equal(result.count, 140000);
  assert.equal(result.positions.length, 420000);
  assert.equal(result.positions[0], 1000000000.123);
  assert.equal(result.extraColumns, true);
  assert.equal(result.hash, createHash("sha256").update(content).digest("hex"));
  assert.deepEqual(result.min, [1000000000.123, 2, -3]);
});
test("rejects invalid point counts", async () => {
  assert.match((await validate("0 0 0\n")).error, /140,000/);
  assert.match((await validate("0 0 0\n".repeat(140001))).error, /140,000/);
});
test("rejects NaN, infinity, hexadecimal, blank lines and invalid UTF-8", async () => {
  for (const content of [
    "nan 0 0",
    "Infinity 0 0",
    "0x10 0 0",
    "\n",
    "1 2",
    new Uint8Array([255, 0]),
  ]) {
    assert.ok((await validate(content, true)).error);
  }
});
test("GT accepts a different number of points and scientific notation", async () => {
  const { result } = await validate("1e2 -.5 +3.\n0 0 0", true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.max, [100, 0, 3]);
});
test("rejects empty, wrong extension and oversized files", async () => {
  assert.ok((await validate("")).error);
  assert.ok((await validate("1 2 3", true, "input.ply")).error);
  const file = new File(["0 0 0"], "input.xyz");
  Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 + 1 });
  await self.onmessage({ data: { file, reference: false } });
  assert.match(response.error, /100 MiB/);
});
