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
  hiddenAt: null,
  startedAt: null,
  completedAt: null,
  customerId: "vevo-1",
  customer: { displayName: "Fővárosi Állat- És Növénykert" },
  // VALOS ERTEK: Balazs dontese ("Kotelezo") szerint a `departmentId` majd
  // kotelezo lesz (a sema-szintu NOT NULL, a `department_required` migracio,
  // meg kulon, be nem olvadt PR-ben van). Ez a fixture a `detail()` VALASZAT
  // allitja (a happy-path teszteknel a valasz osszeallitasahoz kell), nem a
  // `setPlacement` bemeno allapotat -- azt a `setup()` `jobAttachState`
  // mockja adja kulon, es OTT marad `null` a "partner nelkuli jegy" esetre
  // (lasd lent).
  departmentId: "unit-1",
  department: { name: "Biodóm", code: "BIO", parent: null },
  events: [],
  worksheets: [],
  assets: [],
  assignees: [],
};

type PlacementArg = Parameters<ServiceJobsRepository["setPlacement"]>[0];
type Lap = Awaited<
  ReturnType<ServiceJobsRepository["worksheetsForPlacement"]>
>[number];

/**
 * EGY JEGYHEZ KOTOTT MUNKALAP.
 *
 * A `number` a DONTO mezo: a munkalap-szamot a lezaras osztja ki, es az ELSO
 * TAGJA a helyszin kodja -- egy mar szamozott lapot ezert nem mozgatunk.
 */
function lap(over: Partial<Lap> = {}): Lap {
  return {
    id: "lap-1",
    number: null,
    subject: "Szivattyú csere",
    departmentId: "unit-9",
    assets: [],
    ...over,
  };
}

function lapEszkoz(over: Partial<Lap["assets"][number]> = {}) {
  return {
    assetId: "esz-7",
    assetNumber: "ESZ-0007",
    assetName: "Szivattyú",
    assetDepartmentId: "unit-9",
    ...over,
  };
}

function setup(
  options: {
    customerId?: string | null;
    belongs?: boolean;
    /** Amit a tarolo "nincs ezen a helyszinen" valaszkent ad vissza. */
    kivul?: string[];
    letezik?: boolean;
    /** A jegyhez kotott lapok, ahogy a tarolo adna vissza oket. */
    lapok?: Lap[];
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
    /*
      A HIVO MOSTANTOL LEKERDEZI A JEGYHEZ KOTOTT LAPOKAT IS (a helyszin
      atvezetesehez). A varrat laza (`as unknown as`), tehat a hianyzo metodusrol
      a fordito nem szol -- a szolgaltatas viszont HASZNALJA. Ures lista: ezek az
      esetek nem lapokrol szolnak.
    */
    worksheetsForPlacement: async () => options.lapok ?? [],
    unitPathsOf: async () => new Map([["unit-9", ["Biodóm", "Nagy medence"]]]),
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

  /**
   * === A HELYSZIN ATVEZETESE A KOTOTT LAPOKRA (Balazs merese, 2026-09-16) ===
   *
   * Szo szerint: "a hibajegynel meg tudtam valtoztatni a helyszint. de a mar
   * hozzakotott munkalapnal nem valtozott meg".
   *
   * A KET ALLITAS EGYUTT MER, KULON-KULON NEM: az elso azt mondja, hogy a szam
   * nelkuli lap MEGY, a masodik azt, hogy a szamozott NEM. Onmagaban az elso
   * akkor is zold lenne, ha MINDEN lapot mozgatnank; a masodik akkor is, ha
   * EGYET SEM.
   */
  it("a szám nélküli lap azonosítója lemegy a tárolóhoz", async () => {
    const { service, irasok } = setup({ lapok: [lap({ id: "lap-1" })] });

    await service.setPlacement(
      "job-1",
      { departmentId: "unit-9", assetIds: [] },
      BELSOS,
    );

    assert.deepEqual(irasok[0]?.worksheetIds, ["lap-1"]);
  });

  /**
   * A PAR MASIK FELE, ES A HATAR INDOKA: a munkalap-szamot a lezaras osztja ki,
   * es az ELSO TAGJA A HELYSZIN KODJA (`BIO-2026-001`). Egy mar szamozott lapot
   * mozgatva a szama olyan helyszint nevezne meg, ahol a lap mar nem all -- es
   * a szam a lap azonossaga, kinyomtatva es atadva.
   */
  it("a SZÁMOZOTT lap azonosítója NEM megy le", async () => {
    const { service, irasok } = setup({
      lapok: [
        lap({ id: "lap-1" }),
        lap({ id: "lap-2", number: "BIO-2026-001" }),
      ],
    });

    await service.setPlacement(
      "job-1",
      { departmentId: "unit-9", assetIds: [] },
      BELSOS,
    );

    /*
      A TAGADASRA ALLITUNK, NEM A TELJES LISTARA -- es ez nem szorszalhasogatas.
      Egy `deepEqual(["lap-1"])` akkor is elbukna, ha a szolgaltatas EGY lapot
      sem mozgatna, vagyis ugyanazt merne, mint a par masik fele. Igy a ket
      allitas KULON-KULON egy-egy rontasra pirosodik: "mindet mozgatja" csak
      ezt, "egyet sem mozgat" csak a masikat.
    */
    assert.equal(irasok.length, 1);
    assert.ok(
      !irasok[0]?.worksheetIds.includes("lap-2"),
      "a számozott lap nem mozdulhat",
    );
  });

  /**
   * EGY MOZGATOTT LAPON KIVUL ESO ESZKOZ: A MUVELET MEGALL, ES MEGNEVEZI.
   *
   * Nem a valaszkodra all az allitas, hanem a tarolora: egy 409-et mero teszt
   * akkor is zold lenne, ha az iras kozben mar megtortent. Es az UZENETRE is,
   * mert egy "nehany eszkoz kivul esne" mondat ugyanannyit er, mint a csend.
   */
  it("kívül eső lap-eszköznél megáll, és megnevezi a lapot, az eszközt és a helyét", async () => {
    const { service, irasok } = setup({
      kivul: ["esz-7"],
      lapok: [lap({ subject: "Szivattyú csere", assets: [lapEszkoz()] })],
    });

    await assert.rejects(
      () =>
        service.setPlacement(
          "job-1",
          { departmentId: "unit-5", assetIds: [] },
          BELSOS,
        ),
      (hiba: { status?: number; getResponse?: () => unknown }) => {
        /**
         * A MONDATOK A VALASZ TORZSEBEN VANNAK, NEM A `message` MEZOBEN -- es
         * ezt lemertem, nem feltetelezem (2026-09-16): egy tombbel hivott
         * `ConflictException` sajat `message` erteke a keretrendszer
         * alapertelmezese ("Conflict Exception"), a tomb pedig a
         * `getResponse().message` alatt all. Egy `.message`-re epulo allitas
         * tehat nem a szoveget merne, hanem a keret alapertelmezeset -- es
         * zolden allna akkor is, ha egyetlen mondatot sem kuldenenk ki.
         *
         * A FELULETRE IGY IS ELJUT: a webes kliens a valasz `message` mezojet
         * olvassa, es a tombot ujsorokkal fuzi ossze.
         */
        const valasz = hiba.getResponse?.() as { message?: unknown };
        const szoveg = Array.isArray(valasz?.message)
          ? valasz.message.join("\n")
          : String(valasz?.message ?? "");
        assert.equal(hiba.status, 409);
        assert.match(szoveg, /Szivattyú csere/);
        assert.match(szoveg, /Szivattyú \(ESZ-0007\)/);
        assert.match(szoveg, /Biodóm \/ Nagy medence/);
        assert.match(szoveg, /A lapon marad/);
        return true;
      },
    );
    assert.deepEqual(irasok, []);
  });

  /**
   * ES A MASODIK, KIMONDOTT KORBEN ATMEGY. Enelkul az elozo allitas akkor is
   * zold lenne, ha a vegpont MINDEN ilyen kerest elutasitana -- vagyis ha a
   * dontes nem a felhasznaloe lenne, hanem a szerveré.
   */
  it("tudomásulvétellel ugyanaz a kérés átmegy", async () => {
    const { service, irasok } = setup({
      kivul: ["esz-7"],
      lapok: [lap({ assets: [lapEszkoz()] })],
    });

    await service.setPlacement(
      "job-1",
      {
        departmentId: "unit-5",
        assetIds: [],
        acceptWorksheetAssetsOutsideSite: true,
      },
      BELSOS,
    );

    assert.equal(irasok.length, 1);
    assert.deepEqual(irasok[0]?.worksheetIds, ["lap-1"]);
  });

  /**
   * HA NINCS MIROL DONTENI, NE KERDEZZEN.
   *
   * Ez a gyakori eset, es sajat allitast erdemel: egy megerosito kerdes, ami
   * minden mentesnel feljon, ket het alatt reflexbol elkattintott ablakka
   * valik -- es akkor a valodi utkozest sem olvassa el senki.
   */
  it("ütköző eszköz nélkül nem kérdez, hanem átmegy", async () => {
    const { service, irasok } = setup({
      kivul: [],
      lapok: [lap({ assets: [lapEszkoz()] })],
    });

    await service.setPlacement(
      "job-1",
      { departmentId: "unit-9", assetIds: [] },
      BELSOS,
    );

    assert.equal(irasok.length, 1);
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
