import assert from "node:assert/strict";
import test from "node:test";

import { createAssetQr, createAssetQrSvg } from "./qr-svg.js";

test("creates a self-contained version-5 SVG QR label", () => {
  const svg = createAssetQrSvg(
    "acropora-os://assets/scan/550e8400-e29b-41d4-a716-446655440000",
  );
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 45 45"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<path d="M/);
  assert.doesNotMatch(svg, /550e8400/);
});

test("rejects payloads that cannot fit the fixed physical-label symbol", () => {
  assert.throws(() => createAssetQrSvg("x".repeat(107)), /maximum is 106/);
});

test("the rows for the phone are the same symbol as the SVG, cell for cell", () => {
  const { svg, modules } = createAssetQr(
    "acropora-os://assets/scan/550e8400-e29b-41d4-a716-446655440000",
  );
  assert.equal(modules.length, 37);
  for (const row of modules) assert.match(row, /^[01]{37}$/);
  // the finder pattern in the top-left corner: a dark 7-wide ring
  assert.equal(modules[0]!.slice(0, 7), "1111111");
  assert.equal(modules[1]!.slice(0, 7), "1000001");
  assert.equal(modules[2]!.slice(0, 7), "1011101");
  // every dark cell is one square in the SVG path, at the same place (+4 border)
  const fromSvg = [...svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)].map(
    (m) => `${Number(m[1]) - 4},${Number(m[2]) - 4}`,
  );
  const fromRows = modules.flatMap((row, y) =>
    [...row].flatMap((cell, x) => (cell === "1" ? [`${x},${y}`] : [])),
  );
  assert.ok(fromRows.length > 300);
  assert.deepEqual(fromRows, fromSvg);
});
