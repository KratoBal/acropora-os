import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { documentFooterLine } from "./company.js";

describe("a dokumentum-lábléc fajtánként (acrobot 28093)", () => {
  it("a szervizes lábléc a szerviz számát és a hibabejelentő címet, az irodai az irodáét viszi", () => {
    const service = documentFooterLine("SERVICE");
    const office = documentFooterLine("OFFICE");
    assert.deepEqual(
      [
        service,
        office.includes("+36-20-2676801"),
        office.includes("info@acropora.hu"),
        office.includes("982-3634"),
      ],
      [
        "Acropora Kft. · 1106 Budapest, Pesti Gábor utca 35 · info@acropora.hu · hibabejelentés: ticket@acropora.hu · +36-30-982-3634",
        true,
        true,
        false,
      ],
      "FOOTER-BY-KIND",
    );
  });
});
