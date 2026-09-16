import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JEGY_A_SORBAN,
  JEGY_FENT_VAN,
  mustQueue,
  ticketLinkFromParams,
  ticketNotice,
} from "./worksheet-under-ticket";

describe("melyik alakban jött a hibajegy", () => {
  it("jegy nélkül nincs kapcsolat", () => {
    assert.deepEqual(ticketLinkFromParams({}), { kind: "none" });
    // AZ URES SZTRING SEM JEGY: az expo-router uresen is atadhat egy parametert.
    assert.deepEqual(ticketLinkFromParams({ serviceJobId: "  " }), {
      kind: "none",
    });
  });

  it("a felment jegy azonosítója a törzsbe való", () => {
    assert.deepEqual(ticketLinkFromParams({ serviceJobId: "sj-1" }), {
      kind: "server",
      serviceJobId: "sj-1",
    });
  });

  it("a sorban álló jegy a MŰVELET-azonosítójával jön", () => {
    assert.deepEqual(
      ticketLinkFromParams({ serviceJobOperationId: "service-job:a:b" }),
      { kind: "queued", operationId: "service-job:a:b" },
    );
  });

  /**
   * A KETTO EGYSZERRE HIBA, ES A SZIGORUBB NYER.
   *
   * Ha mind a ketto megjon, a hivo maga sem tudja, letezik-e mar a jegy. A ket
   * tevedes ara nem egyforma: a felesleges varakozas HANGOS (a szerelo latja,
   * hogy a lap a sorban van), egy jegy NELKUL felkerult lap viszont NEMA.
   */
  it("mindkettő esetén a SORBAN ÁLLÓ alak nyer", () => {
    assert.deepEqual(
      ticketLinkFromParams({
        serviceJobId: "sj-1",
        serviceJobOperationId: "service-job:a:b",
      }),
      { kind: "queued", operationId: "service-job:a:b" },
    );
  });

  // Az expo-router ugyanazt a parametert tombkent is atadhatja.
  it("tömbként átadott paraméterből az elsőt veszi", () => {
    assert.deepEqual(ticketLinkFromParams({ serviceJobId: ["sj-2", "sj-3"] }), {
      kind: "server",
      serviceJobId: "sj-2",
    });
  });
});

/**
 * EZ A MODUL LEGFONTOSABB ALLITASA.
 *
 * A `saveOrQueue` alapertelmezesben eloszor a szervernek kuld. Egy SORBAN ALLO
 * jegy alatt ez csendben rosszat tenne: a hivas SIKERULNE, csak `serviceJobId`
 * nelkul -- a lap letrejonne, es soha nem kerulne a jegy ala.
 */
describe("mikor kell a sorba tenni a lapot", () => {
  it("sorban álló jegy alatt MINDIG a sorba megy", () => {
    assert.equal(mustQueue({ kind: "queued", operationId: "op" }), true);
  });

  /**
   * TESTVER-KONTROLL: a masik ket ag valtozatlanul a rendes uton megy. Enelkul
   * a fenti allitas akkor is zold lenne, ha a fuggveny MINDIG igazat adna -- es
   * akkor minden munkalap a sorba kerulne, terero mellett is.
   */
  it("felment jegy alatt és jegy nélkül a rendes út marad", () => {
    assert.equal(mustQueue({ kind: "server", serviceJobId: "sj-1" }), false);
    assert.equal(mustQueue({ kind: "none" }), false);
  });
});

describe("mit mond a képernyő a jegyről", () => {
  it("jegy nélkül nincs mit mondani", () => {
    assert.equal(ticketNotice({ kind: "none" }), null);
  });

  /**
   * MIND A KET MONDAT A PARTNERRE FIGYELMEZTET, es ez meresbol jon: a szerver a
   * jegy partneret a lapehoz meri (`mayWorksheetJoinTicket`), es elteres eseten
   * elutasit. A sorbol kuldve ez orakkal kesobb, a helyszintol tavol derulne ki.
   */
  it("mindkét ág a PARTNER egyezésére figyelmeztet", () => {
    assert.match(
      ticketNotice({ kind: "queued", operationId: "op" }) ?? "",
      /partnert/,
    );
    assert.match(
      ticketNotice({ kind: "server", serviceJobId: "sj-1" }) ?? "",
      /partnert/,
    );
  });

  /**
   * ES A KET MONDAT KULONBOZIK: a sorban allo jegynel a lap is var, es ezt ki
   * kell mondani. Enelkul egy valtozat, ami mindig ugyanazt adja vissza,
   * atmenne a fenti allitason.
   */
  it("a sorban álló jegy mondata KIMONDJA, hogy a lap is vár", () => {
    assert.notEqual(JEGY_A_SORBAN, JEGY_FENT_VAN);
    assert.match(JEGY_A_SORBAN, /a lap is a sorba megy/);
  });
});
