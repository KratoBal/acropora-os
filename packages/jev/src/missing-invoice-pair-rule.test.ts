import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pairExposure } from "./missing-invoice-pair-policy.js";
import {
  pairRuleR1,
  similarSupplierName,
} from "./missing-invoice-pair-rule.js";
import type { PairCandidate, PairPayment } from "./pairing.js";

/**
 * AZ R1 ELŐSZABÁLY (kártya e34247c0). A mérő Python-szabályával a párhuzamot a
 * mért 622 páron ellenőriztük (PR-törzs); itt a fajtái állnak, a mérés
 * jegyzetének példáival.
 *
 * MI PIROSÍT: ha a cégforma (Kft., Zrt.) hasonlóságot adna; ha a rövid nevek
 * összemosódnának; ha az 5 Ft-os tűrés tágulna; ha az EUR-eredeti nem számítana.
 */
const payment = (over: Partial<PairPayment> = {}): PairPayment => ({
  date: "2026-09-10",
  amount: "3803",
  currency: "HUF",
  original: "",
  partner: "Tesla Hungary Kft.",
  narrative: "",
  type: "KÁRTYÁS VÁSÁRLÁS",
  ...over,
});
const candidate = (over: Partial<PairCandidate> = {}): PairCandidate => ({
  number: "SZ-1",
  date: "2026-09-09",
  gross: "9990",
  currency: "HUF",
  supplier: "Yettel Magyarország Zrt.",
  ...over,
});

describe("similarSupplierName", () => {
  it("közös, legalább 4 betűs szó", () => {
    assert.equal(
      similarSupplierName("MAGYAR TELEKOM NYRT", "Magyar Telekom Nyrt."),
      true,
    );
  });

  it("az első szó első öt betűje", () => {
    assert.equal(
      similarSupplierName("Vodafone Magyarorszag", "Vodafonehu Zrt."),
      true,
    );
  });

  it("a cégforma és a gyakori szavak nem tesznek hasonlóvá", () => {
    assert.equal(similarSupplierName("Valami Kft.", "Más Kft."), false);
    assert.equal(
      similarSupplierName("Alfa Hungary Kft.", "Beta Hungary Kft."),
      false,
    );
  });

  it("a rövid, csak hangzásban közeli nevek nem hasonlók (tesla és yettel)", () => {
    assert.equal(
      similarSupplierName("Tesla Hungary Kft.", "Yettel Magyarország Zrt."),
      false,
    );
  });

  it("ékezettől és írásjeltől független", () => {
    assert.equal(
      similarSupplierName("Fővárosi Vízművek Zrt.", "FOVAROSI VIZMUVEK"),
      true,
    );
  });
});

describe("pairRuleR1", () => {
  it("más cég, közeli összeg: nem engedi (a mért hibák fajtája)", () => {
    assert.equal(pairRuleR1(payment({ amount: "9950" }), candidate()), false);
  });

  it("5 Ft-on belül engedi, 6 Ft-tól nem", () => {
    assert.equal(pairRuleR1(payment({ amount: "9995" }), candidate()), true);
    assert.equal(pairRuleR1(payment({ amount: "9996" }), candidate()), false);
  });

  it("hasonló szállító eltérő összeggel is engedi", () => {
    assert.equal(
      pairRuleR1(
        payment({ partner: "TESLA HUNGARY" }),
        candidate({ supplier: "Tesla Hungary Kft.", gross: "1999" }),
      ),
      true,
    );
  });

  it("EUR számlánál az EUR-eredetit veti össze", () => {
    assert.equal(
      pairRuleR1(
        payment({ amount: "4100", original: "10.50 EUR" }),
        candidate({ currency: "EUR", gross: "10.5" }),
      ),
      true,
    );
    assert.equal(
      pairRuleR1(
        payment({ amount: "4100" }),
        candidate({ currency: "EUR", gross: "10.5" }),
      ),
      false,
    );
  });

  it("hiányzó bruttó: csak a név dönthet", () => {
    assert.equal(
      pairRuleR1(payment({ amount: "0" }), candidate({ gross: "" })),
      false,
    );
  });
});

describe("pairExposure és R1", () => {
  it("a biztos, de R1-en elbukó választás rejtett", () => {
    assert.equal(
      pairExposure({
        mode: "live",
        choice: "doc-1",
        confidence: 0.99,
        bankTransactionId: "bt-teszt-0",
        ruleR1: false,
      }),
      "HIDDEN",
    );
    assert.equal(
      pairExposure({
        mode: "live",
        choice: "doc-1",
        confidence: 0.8,
        bankTransactionId: "bt-teszt-0",
        ruleR1: true,
      }),
      "SHOWN",
    );
  });
});
