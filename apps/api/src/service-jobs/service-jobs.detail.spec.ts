import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPartnerServiceJobDetail,
  type ServiceJobDetail,
  type ServiceJobPartnerDetail,
} from "@acropora/types";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";
import {
  serviceJobDetailRow as row,
  type ServiceJobDetailRow,
} from "../testing/service-job-detail-row.fixture.js";

/**
 * BELSOS HIVO: a reszletlap tartalmarol szolo allitasok NEM a hatokorrol
 * szolnak, tehat itt a szures ures objektum. A hatokort a
 * `service-job-visibility.spec.ts` meri, kulon.
 */
const BELSOS = { id: "user-1", customerId: null, supplierId: null } as never;

/**
 * PARTNER HIVO: a `partnerScopeOf` a `customerId` alapjan sorolja be, tehat
 * ennyi eleg hozza. A lathatosagi szuro a duplaban nem fut le, es ez rendben
 * van: itt a VALASZ ALAKJA a kerdes, nem az, hogy latja-e a sort.
 */
const PARTNER = {
  id: "user-9",
  customerId: "cust-1",
  supplierId: null,
} as never;

/**
 * A VARRAT A VALÓDI SZERZŐDÉS TÍPUSÁT KAPJA (`Pick<...>`), nem `unknown`-t: a
 * részletlap alakja a felület szerződése, és ha a tároló visszatérése
 * elmozdul a duplától, a fordító szóljon, ne a képernyő.
 */
function serviceWith(detailRow: ServiceJobDetailRow) {
  const repository: Pick<
    ServiceJobsRepository,
    "detail" | "documentRemovals" | "assignedUnitIds"
  > = {
    detail: async () => detailRow,
    /*
        A PARTNER HATOKOR EZT IS HIVJA. A `visibilityFor` nem-belso hivonal a
        kero egysegeit keri le -- a belsos agon ez a hivas NEM fut le, ezert
        hianyzott eddig a duplabol. Ures lista: "ehhez a felhasznalohoz nincs
        egyseg rendelve", ami ervenyes valasz, es a VALASZ ALAKJAT (amit ez a
        spec mer) nem befolyasolja.
      */
    assignedUnitIds: async () => [],
    /* A TOROLT CSATOLMANYOK KULON LEKERDEZESBOL JONNEK (az AuditLog nem all
       relacioban a jeggyel), tehat a duplanak ezt is tudnia kell. Ures lista =
       "ezen a jegyen nem toroltek csatolmanyt", ami ervenyes valasz. */
    documentRemovals: async () => [],
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

/**
 * A BELSO HIVO A TELJES RESZLETLAPOT KAPJA -- ES EZ ALLITAS, NEM KENYELEM.
 *
 * A `detail` 2026-09-21 ota ket alakot ad vissza (a partner sajat, szukebb
 * tipust kap). Ez a segedfuggveny nem csak szukit: KIMONDJA, hogy a belso
 * hivo tovabbra is a teljeset kapja. Enelkul egy kesobbi "egyszerusites"
 * MINDENKITOL elvehetne a mezoket, es a tesztek ettol meg zoldek maradnanak.
 */
function belsoReszletlap(
  detail: ServiceJobDetail | ServiceJobPartnerDetail,
): ServiceJobDetail {
  assert.ok(
    !isPartnerServiceJobDetail(detail),
    "a belso hivo a TELJES reszletlapot kapja",
  );
  return detail;
}

describe("a hibajegy részletlapja", () => {
  it("dátumot ISO szöveggé fordít, mert a válasz JSON, nem Date", async () => {
    const detail = belsoReszletlap(
      await serviceWith(row()).detail("job-1", BELSOS),
    );

    assert.equal(detail.createdAt, "2026-09-01T08:00:00.000Z");
    assert.equal(detail.completedAt, "2026-09-04T08:00:00.000Z");
    // A SORRENDTŐL FÜGGETLENÜL keressük ki: ez az állítás a dátum-fordítást
    // méri, nem a rendezést. Index szerint hivatkozva egy rendezési hiba is
    // ezt pirosítaná, és akkor két állítás mondaná ugyanazt.
    const naplosor = detail.timeline.find((entry) => entry.kind === "status");
    assert.equal(naplosor?.at, "2026-09-01T08:00:00.000Z");
  });

  /**
   * AZ ÖSSZEFÉSÜLÉS A SZERVERÉ, NEM A KLIENSÉ.
   *
   * A minta úgy áll, hogy a két csatolás a naplósor UTÁN keletkezett: ha a
   * végpont három listát adna vissza, vagy fésülés nélkül fűzné össze őket, ez
   * az állítás pirosodna. A kliens rajzol, nem dönt.
   */
  it("egy időrendbe fésülve adja vissza a három forrást, legújabb felül", async () => {
    const detail = belsoReszletlap(
      await serviceWith(row()).detail("job-1", BELSOS),
    );

    assert.deepEqual(
      detail.timeline.map((entry) => entry.kind),
      ["asset", "worksheet", "status"],
    );
  });

  /**
   * A LAP NEVE IS ÁTMEGY A NAPLÓSORBA, NEM CSAK A SZÁMA.
   *
   * A név a lap LEGFRISSEBB VERZIÓJÁN lakik, tehát egy relációból jön -- ha a
   * lekérdezés kihagyná, itt `undefined` állna, a felületen pedig üres
   * zárójel. Az állítás a VÉGPONT válaszát méri, nem a lekérdezést: a kettő
   * közé a leképezés is beleesik.
   */
  it("a munkalap nevét is kiadja, a legfrissebb verzióról", async () => {
    const detail = belsoReszletlap(
      await serviceWith(row()).detail("job-1", BELSOS),
    );

    const sor = detail.timeline.find((entry) => entry.kind === "worksheet");
    assert.ok(sor?.kind === "worksheet");
    assert.equal(sor.worksheet.subject, "Szivattyú csere");
  });

  /**
   * A `scheduledAt` NEM SZÁRMAZTATOTT, a másik kettő az - de mindhárom
   * MEGJELENIK a válaszban. Ha kimaradnának, a felület a naplóból kezdené
   * visszafejteni őket, és a szabály két helyen állna.
   */
  it("mindhárom időbélyeget kiadja, a tervezettet is", async () => {
    const detail = belsoReszletlap(
      await serviceWith(row()).detail("job-1", BELSOS),
    );

    assert.equal(detail.scheduledAt, null);
    assert.equal(detail.startedAt, null);
    assert.equal(detail.completedAt, "2026-09-04T08:00:00.000Z");
  });

  /**
   * A LÉPÉSEKET A TÁBLA ADJA, NEM A FELÜLET. Ha a válasz nem vinné, a kliens
   * kezdené el kitalálni, mi mehet - és onnantól az átmenet-szabály két helyen
   * állna, ami közül csak az egyik a szerver.
   */
  it("megmondja, mit tehet a jegy innen", async () => {
    const detail = belsoReszletlap(
      await serviceWith(row()).detail("job-1", BELSOS),
    );
    assert.ok(detail.allowedSteps.length > 0);
    assert.ok(!detail.allowedSteps.includes("NEW"));
  });

  it("lezárt jegyen üres a lépések listája", async () => {
    const detail = belsoReszletlap(
      await serviceWith(row({ status: "CANCELLED" })).detail("job-1", BELSOS),
    );
    assert.deepEqual(detail.allowedSteps, []);
  });

  /**
   * A TÖRÖLT FELHASZNÁLÓ NEM VISZI MAGÁVAL A NAPLÓT: az `actor` `null` lehet,
   * és a válasznak akkor is teljesnek kell lennie. Egy hiányzó mező itt a
   * kliensen `undefined`-ként jelenne meg, hibaüzenet nélkül.
   */
  it("aktor nélküli naplósort is kiad, nem hagyja ki", async () => {
    const eventek = row().events.map((event) => ({ ...event, actor: null }));
    const detail = await serviceWith(row({ events: eventek })).detail(
      "job-1",
      BELSOS,
    );

    const naplosorok = detail.timeline.filter(
      (entry) => entry.kind === "status",
    );
    assert.equal(naplosorok.length, 1);
    assert.equal(
      naplosorok[0]!.kind === "status" ? naplosorok[0]!.event.actorName : "x",
      null,
    );
  });

  it("nem létező jegyre nem találhatót mond, nem üres részletlapot", async () => {
    await assert.rejects(
      () => serviceWith(null).detail("hianyzik", BELSOS),
      /nem található/,
    );
  });
});

/**
 * A HUZALOZAS, NEM A FUGGVENY.
 *
 * A vetites SAJAT specje a kozos csomagban all, es azt meri, hogy a tiszta
 * fuggveny helyesen vetit. EZ a blokk azt meri, hogy a `detail()` MEG IS
 * HIVJA -- ket kulon dolog, es ma reggel epp ezen csusztam el egy masik
 * munkaban: az orzot egy HALOTT agra tettem, es a fuggveny sajat tesztjei
 * attol meg zoldek voltak.
 */
describe("a partner hivo SAJAT alakot kap", () => {
  it("nem kapja meg a delegaltakat", async () => {
    const detail = await serviceWith(row()).detail("job-1", PARTNER);
    assert.ok(
      isPartnerServiceJobDetail(detail),
      "a partner a BELSO reszletlapot kapta",
    );
  });

  it("a naplo-soraibol hianyzik a megjegyzes, de a NEV megmarad", async () => {
    const detail = await serviceWith(
      row({
        events: [
          {
            id: "e1",
            fromStatus: null,
            toStatus: "NEW",
            note: "belső megjegyzés, nem ügyfélnek",
            actor: { displayName: "Kiss Márta" },
            createdAt: new Date("2026-09-20T08:00:00.000Z"),
          },
        ],
      } as never),
    ).detail("job-1", PARTNER);

    const szoveg = JSON.stringify(detail);
    assert.ok(!szoveg.includes("belső megjegyzés"), "a megjegyzes kiment");
    assert.ok(szoveg.includes("Kiss Márta"), "a nevnek meg kell maradnia");
  });

  /** KONTROLL: ugyanaz a sor BELSO hivonak TELJES alakban megy. */
  it("ugyanaz a jegy a BELSO hivonak teljes alakban megy", async () => {
    const detail = await serviceWith(row()).detail("job-1", BELSOS);
    assert.ok(!isPartnerServiceJobDetail(detail));
  });
});
