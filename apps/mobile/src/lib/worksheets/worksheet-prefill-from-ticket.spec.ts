import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JEGY_BETOLTES_HIBA,
  JEGY_NINCS_PARTNER,
  partnerLezarva,
  prefillFromTicket,
  type JegyAdat,
} from "./worksheet-prefill-from-ticket";

const PARTNEREK = [
  { customerId: "c-1", name: "Acropora Kft.", partnerCode: "ACR" },
  { customerId: "c-2", name: "Másik partner", partnerCode: "MAS" },
];

function jegy(reszlet: Partial<JegyAdat> = {}): JegyAdat {
  return {
    customerId: "c-1",
    customerName: "Acropora Kft.",
    departmentId: "d-1",
    ...reszlet,
  };
}

function hivas(reszlet: Partial<Parameters<typeof prefillFromTicket>[0]> = {}) {
  return prefillFromTicket({
    link: { kind: "server", serviceJobId: "sj-1" },
    jegy: jegy(),
    betoltes: false,
    hiba: false,
    partnerek: PARTNEREK,
    ...reszlet,
  });
}

describe("mit vesz át a lap a hibajegyből", () => {
  it("a jegy partnerét és helyszínét átveszi", () => {
    assert.deepEqual(hivas(), {
      kind: "kesz",
      partner: PARTNEREK[0],
      departmentId: "d-1",
    });
  });

  /**
   * A HIANYZO HELYSZIN NEM HIBAAG. A jegynek nem kell helyszin, a lapnak igen --
   * tehat a valaszto ures marad, es a szerelo valaszt. Ha ez hibat adna, a
   * telefonos felvitel epp a mai jegyek tobbsegen allna meg.
   */
  it("helyszín nélküli jegynél a partner attól még megvan", () => {
    const eredmeny = hivas({ jegy: jegy({ departmentId: null }) });
    assert.equal(eredmeny.kind, "kesz");
    assert.equal(
      eredmeny.kind === "kesz" ? eredmeny.departmentId : "NEM KESZ",
      null,
    );
  });

  /**
   * A PARTNER NELKULI JEGY SAJAT MONDATOT KAP. Ket allapot, ket teendo: itt a
   * JEGYET kell rendbe tenni, a betoltesi hibanal ujraprobalni.
   */
  it("partner nélküli jegynél külön mondatot ad, nem betöltési hibát", () => {
    const eredmeny = hivas({ jegy: jegy({ customerId: null }) });
    assert.deepEqual(eredmeny, {
      kind: "nincs-partner",
      uzenet: JEGY_NINCS_PARTNER,
    });
    assert.notEqual(JEGY_NINCS_PARTNER, JEGY_BETOLTES_HIBA);
  });

  it("a betöltési hiba a saját mondatát adja", () => {
    assert.deepEqual(hivas({ hiba: true, jegy: null }), {
      kind: "hiba",
      uzenet: JEGY_BETOLTES_HIBA,
    });
  });

  /**
   * A SORBAN ALLO JEGYET NEM LEHET LEKERDEZNI, es ez NEM hiba: azonositoja meg
   * nincs. A szerelo valaszt, es a kepernyo mar ma is figyelmezteti, hogy
   * ugyanazt valassza, mint a jegyen.
   */
  it("a sorban álló jegynél nincs mit átvenni", () => {
    assert.deepEqual(hivas({ link: { kind: "queued", operationId: "op-1" } }), {
      kind: "sorban",
    });
  });

  it("jegy nélkül nincs előtöltés", () => {
    assert.deepEqual(hivas({ link: { kind: "none" } }), { kind: "nincs" });
  });

  it("amíg a jegy töltődik, nincs kész előtöltés", () => {
    assert.deepEqual(hivas({ betoltes: true }), { kind: "toltes" });
  });

  /**
   * A JEGY PARTNERE AKKOR IS ERVENYES, HA A VALASZTHATO LISTABAN NINCS OTT. A
   * jegy LETEZIK azzal a partnerrel; egy megjelenitesi reszlet miatt nem zarunk
   * le egy mukodo utat. A nev a jegybol jon, a kod marad ures.
   */
  it("a listán kívüli partnert a jegy nevéből veszi át", () => {
    const eredmeny = hivas({
      jegy: jegy({ customerId: "c-9", customerName: "Harmadik Kft." }),
    });
    assert.deepEqual(eredmeny, {
      kind: "kesz",
      partner: {
        customerId: "c-9",
        name: "Harmadik Kft.",
        partnerCode: "",
      },
      departmentId: "d-1",
    });
  });

  it("név nélküli partnernél is marad olvasható felirat", () => {
    const eredmeny = hivas({
      jegy: jegy({ customerId: "c-9", customerName: null }),
    });
    assert.equal(
      eredmeny.kind === "kesz" ? eredmeny.partner.name : "",
      "A hibajegy partnere",
    );
  });
});

describe("mikor zárt a partner-választó", () => {
  /**
   * A BETOLTES ALATT IS ZART, es ez nem ovatoskodas: kulonben a szerelo
   * valaszthatna egyet, amit a kovetkezo pillanatban feluluirunk.
   */
  it("jegy alatt zárt, a betöltés alatt is", () => {
    for (const kind of ["toltes", "kesz", "nincs-partner"] as const) {
      const elotoltes =
        kind === "kesz"
          ? ({ kind, partner: PARTNEREK[0]!, departmentId: null } as const)
          : kind === "toltes"
            ? ({ kind } as const)
            : ({ kind, uzenet: JEGY_NINCS_PARTNER } as const);
      assert.equal(partnerLezarva(elotoltes), true, kind);
    }
  });

  /**
   * ES A SORBAN ALLO JEGYNEL NYITVA MARAD -- ott tenyleg a szerelo valaszt.
   * Ez a KONTROLL: nelkule a fenti allitas attol is zold lenne, ha a fuggveny
   * MINDIG igazat adna.
   */
  it("jegy nélkül és sorban álló jegynél nyitva marad", () => {
    assert.equal(partnerLezarva({ kind: "nincs" }), false);
    assert.equal(partnerLezarva({ kind: "sorban" }), false);
    assert.equal(
      partnerLezarva({ kind: "hiba", uzenet: JEGY_BETOLTES_HIBA }),
      false,
    );
  });
});
