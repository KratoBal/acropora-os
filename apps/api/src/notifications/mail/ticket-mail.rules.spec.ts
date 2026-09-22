import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mailAuditNote,
  mailModeOf,
  ticketMailDecision,
  type TicketOpener,
} from "./ticket-mail.rules.js";

const AKTIV: TicketOpener = {
  email: "nyito@partner.hu",
  displayName: "Nyitó Nóra",
  isActive: true,
};

describe("a kapu alapertelmezesben ZARVA", () => {
  it("beallitatlan kornyezetben nem kuldunk", () => {
    assert.equal(mailModeOf(undefined), "off");
    assert.equal(mailModeOf(null), "off");
    assert.equal(mailModeOf(""), "off");
  });

  it("a kimondott live ertek nyitja", () => {
    assert.equal(mailModeOf("live"), "live");
    assert.equal(mailModeOf("  LIVE  "), "live");
  });

  /**
   * A LEGKOZELEBBI TEVESZTES, ES EZ A LENYEGI ALLITAS EBBEN A BLOKKBAN.
   *
   * Egy elgepelt "liv", egy orokolt "true" vagy egy jol hangzo "on" NE nyisson
   * kaput. A megengedo irany itt visszavonhatatlan (a level a vevonel jelenik
   * meg), a szigoru irany pedig hangos: valaki szol, hogy nem ment ki a level.
   */
  it("ismeretlen ertek ZARVA marad, nem nyit", () => {
    for (const ertek of ["true", "on", "yes", "1", "liv", "LIVE!", "enabled"])
      assert.equal(mailModeOf(ertek), "off", `nem maradt zarva: ${ertek}`);
  });
});

describe("kinek megy level, es mikor nem", () => {
  /**
   * acrobot ELSO KIKOTESE SAJAT ALLITASSAL: zart kapunal akkor sem indul
   * kuldes, ha MINDEN MAS rendben van. Enelkul a kapu csak akkor latszana,
   * amikor amugy sem kuldenenk.
   */
  it("ZART KAPUNAL nem kuldunk, akkor sem, ha van ervenyes cimzett", () => {
    assert.deepEqual(
      ticketMailDecision({
        mode: "off",
        pathMode: "live",
        openedById: "user-1",
        opener: AKTIV,
      }),
      { kind: "skip", reason: "mail-off" },
    );
  });

  it("nyito nelkuli jegynel sajat okkal hagyjuk ki", () => {
    assert.deepEqual(
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: null,
        opener: null,
      }),
      { kind: "skip", reason: "no-opener" },
    );
  });

  /**
   * A LOGO AZONOSITO: az `openedById`-n SZANDEKOSAN NINCS idegenkulcs (a sema
   * fejlece kimondja, miert), tehat MUTATHAT nem letezo sorra. Ezt semmilyen
   * adatbazis-megkotes nem zarja ki, es ez NEM ugyanaz, mint a hianyzo nyito.
   */
  it("torolt nyitonal MAS okkal hagyjuk ki, mint hianyzo nyitonal", () => {
    assert.deepEqual(
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: "user-9",
        opener: null,
      }),
      { kind: "skip", reason: "opener-missing" },
    );
  });

  it("inaktiv nyitonak nem kuldunk, sajat okkal", () => {
    assert.deepEqual(
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: "user-1",
        opener: { ...AKTIV, isActive: false },
      }),
      { kind: "skip", reason: "opener-inactive" },
    );
  });

  it("ervenyes nyitonak megy, cimmel es nevvel", () => {
    assert.deepEqual(
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: "user-1",
        opener: AKTIV,
      }),
      { kind: "send", to: "nyito@partner.hu", name: "Nyitó Nóra" },
    );
  });

  /**
   * acrobot KIKOTESE KULON ALLITASKENT: a kihagyas NE legyen nema, es a harom
   * eset NE ugyanaz az ag legyen. Ha barmelyik ketto osszecsuszik, erre a sorra
   * nem lehet valaszolni: "miert nem kapott levelet?"
   */
  it("a NEGY kimenet NEGY kulonbozo valasz, nem harom", () => {
    const valaszok = [
      ticketMailDecision({
        mode: "off",
        pathMode: "live",
        openedById: "u",
        opener: AKTIV,
      }),
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: null,
        opener: null,
      }),
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: "u",
        opener: null,
      }),
      ticketMailDecision({
        mode: "live",
        pathMode: "live",
        openedById: "u",
        opener: { ...AKTIV, isActive: false },
      }),
    ].map((d) => (d.kind === "skip" ? d.reason : "send"));

    assert.equal(new Set(valaszok).size, 4, `osszecsuszott: ${valaszok}`);
  });
});

describe("a naplo-sor nem szivarogtat cimet", () => {
  /**
   * A NAPLO-SOR CIMET NEM TARTALMAZ -- de NEM azert, mert a partner ma latna.
   * Ma nem latja (merve 2026-09-22: a partner sajat vetitest kap, amiben a
   * `note` mezo nincs benne).
   *
   * AZ INDOK, ES EZ NEM AVUL EL: ennek a mezonek a lathatosaga egy nap alatt
   * KETSZER valtozott. Egy cim, ami egyszer bekerul egy naplo szovegebe,
   * onnantol minden jovobeli felulettel egyutt utazik, es senki nem fogja
   * megkerdezni, szabad-e kiirni.
   */
  it("a sikeres kuldes sora sem cimet, sem nevet nem tartalmaz", () => {
    const sor = mailAuditNote({
      kind: "send",
      to: "nyito@partner.hu",
      name: "Nyitó Nóra",
    });

    assert.ok(!sor.includes("nyito@partner.hu"));
    assert.ok(!sor.includes("Nyitó Nóra"));
    assert.ok(!sor.includes("@"));
    // ES MEGIS MONDJON VALAMIT: a puszta hiany nem ellenorzes.
    assert.match(sor, /kiküldve/);
  });

  it("a kihagyas sora megnevezi az OKOT", () => {
    assert.match(
      mailAuditNote({ kind: "skip", reason: "opener-inactive" }),
      /opener-inactive/,
    );
  });
});
