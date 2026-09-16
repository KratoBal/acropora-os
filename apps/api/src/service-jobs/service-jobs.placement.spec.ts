import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A HELYSZIN ES AZ ESZKOZOK EGYUTT, A FELVITEL UTAN.
 *
 * Balazs kerese (2026-09-16): a meglevo jegyhez is lehessen eszkozt adni, es a
 * helyszint is lehessen modositani.
 *
 * === MIT ORIZ EZ A FAJL, ES MIT NEM ===
 *
 * Azt, hogy a KETTO EGY MUVELET, es hogy a szerver ugyanazt ellenorzi, mint a
 * felvitelen: a helyszin a jegy partnereé, es a bekuldott eszkozok annak a
 * RESZFAJAN allnak. A hatokor-ellenorzest (ki irhat egyaltalan) a
 * `service-jobs.write-scope.spec.ts` meri, ahova ez az ut fel is kerult.
 *
 * === A LENYEG A NEGYEDIK ALLITAS ===
 *
 * Helyszin-valtaskor a regi helyszin eszkozei leesnenek. A szerver NEM dont
 * helyettuk: ha a bekuldott listaban olyan all, ami az UJ helyszinen nincs, a
 * keres ELAKAD -- a felulet dolga megnevezni a leesoket es megkerdezni a
 * felhasznalot. Igy a szerver soha nem szed le olyat, amit o nem latott.
 */

const BELSOS = { id: "user-1" } as AuthenticatedUser;

type DetailRow = Awaited<ReturnType<ServiceJobsRepository["detail"]>>;

/**
 * A LEGSZUKEBB RESZLETLAP-SOR, TIPUSOSAN.
 *
 * A `setPlacement` a valaszahoz a TELJES reszletlapot allitja ossze, tehat a
 * happy path-hoz kell egy sor. `as unknown as` NELKUL: a varrat valodi tipusa
 * epp az az egy ellenorzes, amit egy kenyelmi cast kikapcsolna.
 */
const RESZLETLAP: DetailRow = {
  departmentPath: null,
  id: "job-1",
  jobNumber: "HJ-2026-001",
  title: "Szivattyú leállt",
  description: null,
  status: "NEW",
  createdAt: new Date("2026-09-16T08:00:00.000Z"),
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  customerId: "vevo-1",
  customer: { displayName: "Fővárosi Állat- És Növénykert" },
  departmentId: null,
  department: null,
  events: [],
  worksheets: [],
  assets: [],
  assignees: [],
};

type PlacementArg = Parameters<ServiceJobsRepository["setPlacement"]>[0];

function setup(
  options: {
    customerId?: string | null;
    belongs?: boolean;
    /** Amit a tarolo "nincs ezen a helyszinen" valaszkent ad vissza. */
    kivul?: string[];
    letezik?: boolean;
  } = {},
) {
  const irasok: PlacementArg[] = [];
  const repository: Partial<ServiceJobsRepository> = {
    detail: async () => RESZLETLAP,
    documentRemovals: async () => [],
    jobAttachState: async () =>
      options.letezik === false
        ? null
        : {
            /*
              A `??` ITT NEM JO, ES EZ MERT HIBA VOLT (elsore igy irtam): a
              `null` az egyik VIZSGALT eset -- epp a partner nelkuli jegy --, a
              `??` viszont a `null`-ra is visszaesik, tehat a fixtura csendben
              partneres jegyet adott volna vissza. A kulcs MEGLETE dont, nem az
              erteke.
            */
            customerId:
              "customerId" in options ? (options.customerId ?? null) : "vevo-1",
          },
    departmentBelongsToCustomer: async () => options.belongs ?? true,
    assetsOutsideDepartment: async () => options.kivul ?? [],
    setPlacement: async (input) => {
      irasok.push(input);
      return true;
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    irasok,
  };
}

describe("a hibajegy helyszine és eszközei a felvitel után", () => {
  it("a helyszín és az eszközök EGY hívásban mennek le a tárolóhoz", async () => {
    const { service, irasok } = setup();

    await service.setPlacement(
      "job-1",
      { departmentId: "unit-9", assetIds: ["esz-1", "esz-2"] },
      BELSOS,
    );

    assert.equal(irasok.length, 1, "egy művelet, nem kettő");
    assert.equal(irasok[0]?.departmentId, "unit-9");
    assert.deepEqual(irasok[0]?.assetIds, ["esz-1", "esz-2"]);
  });

  /**
   * MAS PARTNER HELYSZINE: elutasitas, es a tarolohoz EL SEM JUT.
   *
   * Nem a valaszkodra all az allitas, hanem a tarolora: egy 400-at mero teszt
   * akkor is zold lenne, ha az iras kozben mar megtortent.
   */
  it("más partner helyszínét elutasítja, és nem ír", async () => {
    const { service, irasok } = setup({ belongs: false });

    await assert.rejects(
      () =>
        service.setPlacement(
          "job-1",
          { departmentId: "masik-partner-egysege", assetIds: [] },
          BELSOS,
        ),
      /nem ehhez a partnerhez tartozik/,
    );
    assert.deepEqual(irasok, []);
  });

  /**
   * PARTNER NELKULI JEGY: KULON AG, KULON UZENET. Nem "ismeretlen egyseg",
   * hanem ertelmetlen keres -- helyszine csak partnernek van, es a teendo is
   * mas (elobb partnert kell allitani).
   */
  it("partner nélküli jegyen saját üzenetet ad, és nem ír", async () => {
    const { service, irasok } = setup({ customerId: null });

    await assert.rejects(
      () =>
        service.setPlacement(
          "job-1",
          { departmentId: "unit-9", assetIds: [] },
          BELSOS,
        ),
      /csak partnerrel együtt/,
    );
    assert.deepEqual(irasok, []);
  });

  /**
   * EZ A LENYEG: az UJ helyszinen NEM allo eszkoz megallitja a keres.
   *
   * A szerver nem dont a felhasznalo helyett: nem "atviszi, amit lehet", es nem
   * is szedi le csendben a tobbit. A leesoket a feluletnek kell megneveznie, es
   * amit a felhasznalo jovahagy, az utazik a KOVETKEZO keresben.
   */
  it("az új helyszínen nem álló eszközt elutasítja, és nem ír", async () => {
    const { service, irasok } = setup({ kivul: ["esz-7"] });

    await assert.rejects(
      () =>
        service.setPlacement(
          "job-1",
          { departmentId: "unit-5", assetIds: ["esz-1", "esz-7"] },
          BELSOS,
        ),
      /nem a megadott helyszínen áll/,
    );
    assert.deepEqual(irasok, []);
  });

  /**
   * ISMERT POZITIV KONTROLL A FENTIHEZ: az URES lista lemegy.
   *
   * Enelkul az elozo allitas akkor is zold lenne, ha a vegpont MINDEN listat
   * elutasitana. Es egyben a "mindet leveszem" szandek merese: ures listat
   * kuldeni szabad, az nem elgepeles.
   */
  it("üres eszköz-lista szabad: lemegy, és mindent levesz", async () => {
    const { service, irasok } = setup();

    await service.setPlacement(
      "job-1",
      { departmentId: "unit-9", assetIds: [] },
      BELSOS,
    );

    assert.equal(irasok.length, 1);
    assert.deepEqual(irasok[0]?.assetIds, []);
  });

  /**
   * AZ AZONOSITOK NORMALIZALVA MENNEK LE.
   *
   * Nem szepitkezes: a kapcsolotablan `@@unique([serviceJobId, assetId])` all,
   * tehat ket azonos sor a TRANZAKCIOT buktatna -- egy olyan hibaval, aminek a
   * kepernyon semmi ertelme. A szandek viszont egyertelmu.
   */
  it("az ismétlődő és üres azonosítókat kiszűri", async () => {
    const { service, irasok } = setup();

    await service.setPlacement(
      "job-1",
      { departmentId: "unit-9", assetIds: ["esz-1", " esz-1 ", "", "esz-2"] },
      BELSOS,
    );

    assert.deepEqual(irasok[0]?.assetIds, ["esz-1", "esz-2"]);
  });

  it("nem létező jegyre 404-et ad, és nem ír", async () => {
    const { service, irasok } = setup({ letezik: false });

    await assert.rejects(
      () =>
        service.setPlacement(
          "job-1",
          { departmentId: "unit-9", assetIds: [] },
          BELSOS,
        ),
      (hiba: { status?: number }) => hiba.status === 404,
    );
    assert.deepEqual(irasok, []);
  });
});
