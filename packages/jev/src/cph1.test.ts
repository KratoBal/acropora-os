import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  Cph1Decimal,
  Cph1Error,
  Cph1Set,
  canonicalDecimal,
  cph1,
  cph1Canonical,
} from "./cph1.js";

/**
 * A KOZOS VEKTORFAJL A SZERZODES (#1199 ACD-002, 4. pont). A vart kanonikus
 * alakot es hash-t NEM ez a megvalositas allitotta elo, hanem egy Python
 * `json.dumps` + `hashlib` a kezzel irt, normalizalt alakon -- kulonben a
 * vektor a sajat hibajat igazolna.
 */
interface Vektor {
  name: string;
  input: { schema: string; data: unknown };
  canonical?: string;
  hash?: string;
  error?: string;
}
const doc = JSON.parse(
  readFileSync(new URL("../cph1-vectors.json", import.meta.url), "utf8"),
) as { vectors: Vektor[] };

/** A vektorfajl jeloloit a nyelv sajat tipusaira forditja. */
function jelolo(ertek: unknown): unknown {
  if (Array.isArray(ertek)) return ertek.map(jelolo);
  if (ertek && typeof ertek === "object") {
    const o = ertek as Record<string, unknown>;
    if ("$cph1_set" in o)
      return new Cph1Set((o.$cph1_set as unknown[]).map(jelolo));
    if ("$cph1_decimal" in o) return new Cph1Decimal(o.$cph1_decimal as string);
    if ("$cph1_datetime" in o) return new Date(o.$cph1_datetime as string);
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, jelolo(v)]),
    );
  }
  return ertek;
}

describe("cph1: a közös vektorfájl", () => {
  it("kontroll: a fájl legalább 15 vektort hordoz, hibás esetekkel együtt", () => {
    assert.ok(doc.vectors.length >= 15, `${doc.vectors.length} vektor`);
    assert.ok(doc.vectors.some((v) => v.error));
  });

  for (const vektor of doc.vectors)
    it(vektor.name, () => {
      const bemenet = {
        schema: vektor.input.schema,
        data: jelolo(vektor.input.data),
      };
      if (vektor.error) {
        assert.throws(
          () => cph1(bemenet),
          (hiba: unknown) =>
            hiba instanceof Cph1Error && hiba.code === vektor.error,
        );
        return;
      }
      assert.equal(cph1Canonical(bemenet), vektor.canonical);
      assert.equal(cph1(bemenet), vektor.hash);
    });

  /**
   * A NULL ES A HIANY KET KULON ALLITAS: a vektorfajl ket esete kulon hash-t
   * kell adjon. Ha egy megvalositas a `null`-t is elhagyna, mindket vektor
   * egyenkent zold lehetne egy hibas fajlon -- ez a paros merese.
   */
  it("a null és a hiányzó kulcs különböző hash-t ad", () => {
    const hash = (nev: string) =>
      doc.vectors.find((v) => v.name.startsWith(nev))?.hash;
    assert.notEqual(hash("null megmarad"), hash("hianyzo kulcs"));
  });
});

describe("cph1: ami a vektorfájlban nem fejezhető ki", () => {
  it("az undefined értékű kulcs kimarad, a null nem", () => {
    const s = { schema: "t@1" };
    assert.equal(
      cph1({ ...s, data: { a: undefined } }),
      cph1({ ...s, data: {} }),
    );
    assert.notEqual(
      cph1({ ...s, data: { a: null } }),
      cph1({ ...s, data: {} }),
    );
  });

  it("a -0 egészként 0", () => {
    assert.equal(
      cph1Canonical({ schema: "t@1", data: { a: -0 } }),
      '{"data":{"a":0},"schema":"t@1"}',
    );
  });

  it("a nem támogatott érték (bigint, függvény, érvénytelen dátum) dob", () => {
    for (const data of [{ a: 1n }, { a: () => 1 }, { a: new Date("x") }])
      assert.throws(() => cph1({ schema: "t@1", data }), Cph1Error);
  });

  it("a hash alakja cph1:sha256:<64 kisbetűs hex>", () => {
    assert.match(
      cph1({ schema: "t@1", data: {} }),
      /^cph1:sha256:[0-9a-f]{64}$/,
    );
  });

  it("canonicalDecimal: a határesetek", () => {
    assert.equal(canonicalDecimal("0"), "0");
    assert.equal(canonicalDecimal("000"), "0");
    assert.equal(canonicalDecimal("0.10"), "0.1");
    assert.equal(canonicalDecimal("-12.340"), "-12.34");
    for (const rossz of ["", "1.", ".5", "1e3", "1,5", "abc", "--1"])
      assert.throws(() => canonicalDecimal(rossz), Cph1Error, rossz);
  });
});
