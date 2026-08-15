import assert from "node:assert/strict";
import test from "node:test";

import { createAssetQrSvg } from "./qr-svg.js";

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
