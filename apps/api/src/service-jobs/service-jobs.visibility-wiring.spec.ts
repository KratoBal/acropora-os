import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import type { Prisma } from "@acropora/database";

import { expandAssignedUnits } from "./assigned-units.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A BEKOTES MERESE: eljut-e a szuro a LEKERDEZESIG.
 *
 * A `service-job-visibility.spec.ts` azt meri, hogy a szuro ALAKJA helyes. Ez a
 * fajl azt, hogy a szolgaltatas TENYLEG atadja a tarolonak -- a ketto kulon
 * romolhat el, es a masodik romlasa NEMA: a lekerdezes lefut, tobb sort ad, es
 * szabalyos valasznak latszik.
 */
function serviceWith(kapott: {
  where?: Prisma.ServiceJobWhereInput;
  szamlaloWhere?: Prisma.ServiceJobWhereInput;
  listaKereses?: string;
  szamlaloKereses?: string;
}) {
  const repository: Pick<
    ServiceJobsRepository,
    "list" | "assignedUnitIds" | "countsByStatus"
  > = {
    assignedUnitIds: async () => ["u1"],
    list: async (_scope, visibility, search) => {
      kapott.where = visibility;
      kapott.listaKereses = search;
      return { rows: [], truncated: false };
    },
    /**
     * A SZAMLALO IS ROGZITI, MIT KAPOTT. Ket kulon lekerdezes megy ki ugyanarra
     * a kerdesre, es a masodik bekotese kulon tud elromlani -- akkor a partner
     * a sajat listaja folott a HAZ osszesitojet latna.
     */
    countsByStatus: async (visibility, search) => {
      kapott.szamlaloWhere = visibility;
      kapott.szamlaloKereses = search;
      return {
        NEW: 0,
        TRIAGED: 0,
        SCHEDULED: 0,
        IN_PROGRESS: 0,
        WAITING_FOR_PARTS: 0,
        WAITING_FOR_CUSTOMER: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      };
    },
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

/**
 * A SZEREP 2026-09-18 OTA KOTELEZO A FIXTURE-ON, ES EZ NEM FORMASAG.
 *
 * A rejtes-szuro azota `hasPermission`-t hiv, az pedig a `ROLE_PERMISSIONS`
 * tablat INDEXELI a szereppel -- egy szerep nelkuli fixture-on `TypeError`-t
 * dob, nem hamisat ad. Vagyis a fixture hianya HANGOS, es ez jo: egy csendes
 * `false` azt jelentette volna, hogy a spec a jog-agat meri, holott csak a
 * hianyzo mezot.
 *
 * `ADMIN`, mert a spec allitasai a KAPCSOLO hatasat merik -- ahhoz jog kell.
 * A jog-tengelyt kulon spec meri (`hidden-rows.spec.ts`, `service-hide-scope.spec.ts`).
 */
const belsos = { id: "user-1", role: "ADMIN" } as AuthenticatedUser;
const partner = {
  id: "user-2",
  supplierId: "sup-1",
  role: "PARTNER_SERVICE",
} as unknown as AuthenticatedUser;

/**
 * A SZURO 2026-09-18 OTA KET AGBOL ALL: a lathatosag MELLE bekerult a rejtes.
 *
 * Az allitasok azert a TELJES alakra mennek, es nem csak a lathatosagi agra,
 * mert egy kicsomagolo allitas egy felcserelt sorrendnel a masik agat nezne,
 * es zold maradna. Igy viszont mind a ketto nev szerint all itt.
 */
const REJTETT_NELKUL = { hiddenAt: null };

describe("a láthatóság eljut a lekérdezésig", () => {
  it("belsős hívónál csak a rejtés-szűrő marad", async () => {
    const kapott: { where?: Prisma.ServiceJobWhereInput } = {};
    await serviceWith(kapott).list({}, belsos);
    assert.deepEqual(kapott.where, { AND: [{}, REJTETT_NELKUL] });
  });

  it("belsős hívónál a KAPCSOLÓVAL a rejtés-szűrő is eltűnik", async () => {
    /*
      POZITIV KONTROLL A FENTIHEZ: e nelkul a `{ hiddenAt: null }` ag akkor is
      ott allna az allitasban, ha SOHA nem tudna eltunni -- vagyis a kapcsolo
      halott lehetne, es ez a spec nem venne eszre.
    */
    const kapott: { where?: Prisma.ServiceJobWhereInput } = {};
    await serviceWith(kapott).list({ includeHidden: true }, belsos);
    assert.deepEqual(kapott.where, { AND: [{}, {}] });
  });

  it("PARTNER hívónál a kapcsoló NEM hat", async () => {
    /*
      A LENYEG: az `includeHidden` keres-parameter, tehat a partner portalja is
      megadhatja. Ha a hivo dontene el, a rejtett jegyek pont ott jelennenek
      meg, ahol a legrosszabb.
    */
    const kapott: { where?: Prisma.ServiceJobWhereInput } = {};
    await serviceWith(kapott).list({ includeHidden: true }, partner);
    assert.deepEqual((kapott.where as { AND: unknown[] }).AND[1], {
      hiddenAt: null,
    });
  });

  /**
   * A LENYEG: partner-oldali hivonal a szuro NEM ures, es MINDKET tengelyt viszi.
   * Ha a bekotes elmarad, ez a sor ures objektumot lat -- vagyis pontosan azt,
   * amit a belsos ag ad, es a ket eset megkulonboztethetetlenne valna.
   */
  it("partner hívónál mindkét tengely eljut a tárolóig", async () => {
    const kapott: { where?: Prisma.ServiceJobWhereInput } = {};
    await serviceWith(kapott).list({}, partner);
    assert.deepEqual(kapott.where, {
      AND: [
        {
          OR: [{ openedById: "user-2" }, { departmentId: { in: ["u1"] } }],
        },
        REJTETT_NELKUL,
      ],
    });
  });

  /**
   * ES A SZAMLALO UGYANAZT A SZUROT KAPJA, MINT A LISTA.
   *
   * KULON ALLITAS, nem a fenti kiegeszitese: a ket lekerdezes ket kulon
   * hivas, tehat a masodik bekotese kulon tud elmaradni. Ha elmarad, a lista
   * helyesen szukul, a HAROM SZAM FOLOTTE viszont a haz osszesitojet mutatja
   * -- es semmi nem hibazik, mert egy nagyobb szam nem nez ki hibasnak.
   *
   * AZONOSSAGRA MERUNK, NEM ALAKRA: nem azt allitjuk, hogy a szamlalo szuroje
   * ilyen-meg-olyan, hanem hogy UGYANAZ, mint a listae. Igy az allitas akkor
   * sem avul el, ha a lathatosagi szabaly maga valtozik.
   */
  /**
   * A KERESES MIND A KET LEKERDEZESBE ELJUT.
   *
   * A lista es a csempek KET kulon lekerdezes, es a kereses bekotese kulon tud
   * elmaradni. Ha a szamlalobol marad ki, a talalatok FOLOTT a keresestol
   * fuggetlen szam allna -- a lista harom sort mutatna, a csempe hatvanat, es
   * egyik sem nezne ki hibasnak.
   *
   * A SZOVEGRE MERUNK, NEM A FELTETEL ALAKJARA: hogy a `contains` hany mezore
   * megy, azt a taroló dönti el. Ez az allitas arrol szol, hogy a felhasznalo
   * szava EGYALTALAN eljut odaig.
   */
  it("a keresés mindkét lekérdezésbe eljut", async () => {
    const kapott: {
      listaKereses?: string;
      szamlaloKereses?: string;
    } = {};
    await serviceWith(kapott).list({ search: "szivattyú" }, belsos);
    assert.equal(kapott.listaKereses, "szivattyú");
    assert.equal(kapott.szamlaloKereses, "szivattyú");
  });

  /**
   * ES KERESES NELKUL EGYIK SEM KAP SZUROT. Enelkul a fenti allitas egy olyan
   * megvalositasnal is zold lenne, ami MINDIG atad valamit -- peldaul ures
   * sztringet --, es akkor a taroló oldalan kellene kitalalni, hogy az ures
   * szo nem szures.
   */
  it("keresés nélkül nem megy le szűrő", async () => {
    const kapott: {
      listaKereses?: string;
      szamlaloKereses?: string;
    } = {};
    await serviceWith(kapott).list({}, belsos);
    assert.equal(kapott.listaKereses, undefined);
    assert.equal(kapott.szamlaloKereses, undefined);
  });

  it("a számláló ugyanazt a szűrőt kapja, mint a lista", async () => {
    const kapott: {
      where?: Prisma.ServiceJobWhereInput;
      szamlaloWhere?: Prisma.ServiceJobWhereInput;
    } = {};
    await serviceWith(kapott).list({}, partner);
    assert.deepEqual(kapott.szamlaloWhere, kapott.where);
    assert.notDeepEqual(kapott.szamlaloWhere, {});
  });
});

describe("a részfa kibontása", () => {
  const units = [
    { id: "fank", name: "Fank", parentId: null },
    { id: "palmahaz", name: "Palmahaz", parentId: "fank" },
    { id: "akvarium", name: "Akvarium", parentId: "palmahaz" },
    { id: "biodom", name: "Biodom", parentId: null },
  ];

  it("a hozzárendelt csomópont alatti mindent hozza, feljebb semmit", () => {
    assert.deepEqual(
      expandAssignedUnits({ assignedIds: ["palmahaz"], units }),
      ["palmahaz", "akvarium"],
    );
  });

  it("két hozzárendelés egyesítve, ismétlés nélkül", () => {
    assert.deepEqual(
      expandAssignedUnits({ assignedIds: ["palmahaz", "biodom"], units }),
      ["palmahaz", "akvarium", "biodom"],
    );
  });

  /**
   * ISMERT POZITIV KONTROLL A FORDITOTT IRANYRA: a Biodomhoz rendelt ember NEM
   * latja a Fank agat. Enelkul a fenti ket allitas akkor is zold lenne, ha a
   * bejaras MINDENT visszaadna.
   */
  it("a testvér ág nem kerül bele", () => {
    const ids = expandAssignedUnits({ assignedIds: ["biodom"], units });
    assert.deepEqual(ids, ["biodom"]);
    assert.ok(!ids.includes("fank"));
    assert.ok(!ids.includes("palmahaz"));
  });
});
