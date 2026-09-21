import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPartnerServiceJobDetail,
  partnerServiceJobDetail,
} from "./service-job-management.js";
import type { ServiceJobDetail } from "./service-job-management.js";

/**
 * A partner valasza SAJAT TIPUS, nem a belso megszurve (Balazs dontese,
 * 2026-09-21 12:07:32 UTC, message_id 1551565542886740020).
 */

const BELSO: ServiceJobDetail = {
  id: "job-1",
  hidden: false,
  jobNumber: "HJ-2026-001",
  title: "Szivattyú zúg",
  description: "Reggel óta hangos.",
  status: "WAITING_FOR_PARTS",
  partnerStatus: "IN_PROGRESS",
  /*
    A VALODI PARTNERI FELIRAT, NEM A BELSO. 2026-09-21-ig "Folyamatban" allt
    itt -- az az `IN_PROGRESS` BELSO cimkeje, a partnere "Feldolgozas alatt".
    A kulonbseg addig nem szamitott (a mezo csak atment), most viszont ebben a
    fajlban mar ket partneri felirat all, es egy kitalalt szo mellett nem lehet
    megkulonboztetni, melyik jon a valodi tablabol.
  */
  partnerStatusLabel: "Feldolgozás alatt",
  customerName: "Teszt Kft.",
  customerId: "cust-1",
  departmentId: "dep-1",
  departmentPath: ["Biodóm", "Nagymedence"],
  departmentName: "Biodóm / Nagymedence",
  createdAt: "2026-09-20T08:00:00.000Z",
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  allowedSteps: ["COMPLETED", "CANCELLED"],
  timeline: [
    {
      kind: "status",
      at: "2026-09-20T08:00:00.000Z",
      sortKey: "e1",
      event: {
        id: "e1",
        fromStatus: null,
        toStatus: "NEW",
        note: "A vevő telefonon jelezte, ne hívjuk vissza délelőtt.",
        actorName: "Kiss Márta",
        createdAt: "2026-09-20T08:00:00.000Z",
      },
    },
  ],
  assets: [
    {
      id: "l1",
      assetId: "a1",
      assetNumber: "BIO-001",
      assetName: "Szivattyú",
      attachedAt: "2026-09-20T08:00:00.000Z",
    },
  ],
  assignees: [
    { userId: "u1", name: "Nagy Béla", assignedAt: "2026-09-20T08:00:00.000Z" },
  ],
};

/** A tizenegy mezo, amit a portal MA SEM olvas (merve 2026-09-21, kontrollal). */
const ELVETT = [
  "hidden",
  "status",
  "customerName",
  "customerId",
  "departmentId",
  "departmentName",
  "scheduledAt",
  "startedAt",
  "completedAt",
  "allowedSteps",
  "assignees",
] as const;

describe("a partner reszletlapja", () => {
  it("EGYIK belso mezot sem viszi at", () => {
    /*
      KULCS-HALMAZ, NEM TIPUS-CAST. Az elso valtozatom
      `as Record<string, unknown>` alakot hasznalt, es a `pnpm typecheck` ATENGEDTE
      -- a csomag tsconfigja kizarja a `*.test.ts` fajlokat. A teszt-forditas
      (`tsconfig.test.json`) fogta meg. Ugyanaz a szerkezet, mint a mobil
      csomagban: a ket kapu MAST lat.
    */
    const kulcsok = new Set(Object.keys(partnerServiceJobDetail(BELSO)));
    for (const mezo of ELVETT)
      assert.ok(!kulcsok.has(mezo), `a partner megkapta: ${mezo}`);
  });

  /**
   * A POZITIV KONTROLL: a fenti allitas egy URES objektumra is zold lenne.
   * Ez meri, hogy amit a portal HASZNAL, az tenyleg atmegy.
   */
  it("amit a portal hasznal, azt ATVISZI", () => {
    const partner = partnerServiceJobDetail(BELSO);
    assert.equal(partner.jobNumber, "HJ-2026-001");
    assert.equal(partner.title, "Szivattyú zúg");
    assert.equal(partner.description, "Reggel óta hangos.");
    assert.equal(partner.partnerStatusLabel, "Feldolgozás alatt");
    assert.deepEqual(partner.departmentPath, ["Biodóm", "Nagymedence"]);
    assert.equal(partner.createdAt, "2026-09-20T08:00:00.000Z");
    assert.equal(partner.assets.length, 1);
    assert.equal(partner.timeline.length, 1);
  });

  /**
   * A BELSO MEGJEGYZES NEM MEHET KI. Balazs, 2026-09-21 10:5x: "a megjegyzes
   * nem kell a nev igen". A kezelo szabad szoveget ir a statuszvaltashoz, es
   * semmi nem mondja ki rola, hogy ugyfelnek szol.
   */
  it("a naplo-sorbol a MEGJEGYZES eltunik", () => {
    const partner = partnerServiceJobDetail(BELSO);
    const sor = partner.timeline[0];
    assert.ok(sor && sor.kind === "status");
    if (!sor || sor.kind !== "status") return;
    assert.ok(!("note" in sor.event), "a megjegyzes atment a droton");
    // ES SEHOL A VALASZBAN: egy masolat barhol mashol ugyanaz a szivargas.
    assert.ok(
      !JSON.stringify(partner).includes("ne hívjuk vissza"),
      "a megjegyzes szovege valahol mashol atment",
    );
  });

  /**
   * A NEV MARAD. Balazs kimondta, hogy a nev IGEN -- enelkul a takaritas azt
   * is elvinne, es a partner nem tudna, ki intezi az ugyet.
   */
  it("a naplo-sorban a NEV megmarad", () => {
    const partner = partnerServiceJobDetail(BELSO);
    const sor = partner.timeline[0];
    if (!sor || sor.kind !== "status") return assert.fail("nem status sor");
    assert.equal(sor.event.actorName, "Kiss Márta");
  });

  /**
   * A NAPLO-SOR MEGNEVEZI AZ ALLAPOTOT -- PARTNERI SZOVAL (147d9a1d).
   *
   * A `#895` utan a partner napló-alakjából kikerült a nyolcértékű enum, és
   * ettől a portál naplósora nem tudta MEGNEVEZNI, milyen állapotba lépett a
   * jegy. A mező a feliratot teszi vissza, a belső szókincset nem.
   *
   * A BEMENET SZANDEKOSAN `WAITING_FOR_PARTS`, es ez a lenyeg: ott a ket
   * szokincs KULONBOZIK ("Alkatreszre var" kontra "Feldolgozas alatt"). Egy
   * `NEW` bemeneten mind a ket irany ugyanarra a szora mutatna ("Uj"), tehat
   * az allitas nem tudna megkulonboztetni a kettot.
   */
  it("a naplo-sor a PARTNERI feliratot viszi, a belsot nem", () => {
    const sor = partnerServiceJobDetail({
      ...BELSO,
      timeline: [
        {
          kind: "status",
          at: "2026-09-20T09:00:00.000Z",
          sortKey: "e2",
          event: {
            id: "e2",
            fromStatus: "TRIAGED",
            toStatus: "WAITING_FOR_PARTS",
            note: null,
            actorName: "Kiss Márta",
            createdAt: "2026-09-20T09:00:00.000Z",
          },
        },
      ],
    }).timeline[0];
    if (!sor || sor.kind !== "status") return assert.fail("nem status sor");
    assert.equal(sor.event.partnerStatusLabel, "Feldolgozás alatt");
  });

  /**
   * ES VISSZAFELE, KULON ALLITASKENT: a belso alak SEHOL nincs a naplo-soron.
   *
   * MIERT KULON `it()`: a ket irany kulon is el tud romlani, es ha egy
   * allitasban allnanak, a futtato a TESZT nevet irna ki, nem az allitasét --
   * a kalibracio kimenetebol nem latszana, melyik fogott.
   *
   * ES A KET IRANY HATARA, MERVE (ne bizzunk benne tobbet, mint amennyit tud):
   * egy olyan rontas, ami a felirat HELYERE teszi a nyers enumot, MIND A KETTOT
   * pirosra dontí -- egy edit, ket kovetkezmeny. Az also allitas AKKOR all
   * egyedul, ha a belso ertek egy MASIK mezon szivarog ki (azonosito,
   * rendezesi kulcs), es pontosan ez az eset az, amit a tipus NEM zar ki.
   */
  it("a naplo-soron a belso alak SEHOL nem szerepel", () => {
    const sor = partnerServiceJobDetail({
      ...BELSO,
      timeline: [
        {
          kind: "status",
          at: "2026-09-20T09:00:00.000Z",
          sortKey: "e2",
          event: {
            id: "e2",
            fromStatus: "TRIAGED",
            toStatus: "WAITING_FOR_PARTS",
            note: null,
            actorName: "Kiss Márta",
            createdAt: "2026-09-20T09:00:00.000Z",
          },
        },
      ],
    }).timeline[0];
    if (!sor || sor.kind !== "status") return assert.fail("nem status sor");
    const szoveg = JSON.stringify(sor);
    for (const belso of ["Alkatrészre vár", "WAITING_FOR_PARTS", "TRIAGED"])
      assert.ok(!szoveg.includes(belso), `kiment a belso alak: ${belso}`);
    /*
      KONTROLL: a sor NEM ures -- van rajta valodi adat. Enelkul ez az allitas
      egy elhagyott naplo-soron is zold lenne.

      ES A KONTROLL SZANDEKOSAN NEM A FELIRAT: ha azt merne, akkor minden
      olyan rontas, ami a feliratot elrontja, EZT IS pirosra dontene -- vagyis
      a ket `it()` ugyanarra a bemenetre pirosodna, es a kalibracio nem tudna
      megkulonboztetni oket. A nev az az adat, ami MIND A KET iranytol
      fuggetlen.
    */
    assert.ok(szoveg.includes("Kiss Márta"));
  });

  /**
   * A BELSO ALLAPOT-SZOKINCS SEM MEGY KI, ES EZ KULON ALLITAS.
   *
   * acrobot kikotese (2026-09-21): a ketto kulon romlik el. Valaki
   * hozzaadhatja a `toStatus`-t "kenyelembol", es az `isCreation` attol meg jo
   * lesz -- ez az allitas az, ami akkor pirosodik.
   */
  it("a belso allapot NEVE sehol nem szerepel a valaszban", () => {
    const szoveg = JSON.stringify(partnerServiceJobDetail(BELSO));
    for (const belso of ["WAITING_FOR_PARTS", "NEW", "TRIAGED", "SCHEDULED"])
      assert.ok(!szoveg.includes(belso), `kiment a belso allapot: ${belso}`);
    // KONTROLL: a PARTNER allapota viszont KIMEGY -- kulonben a fenti
    // allitas egy ures valaszra is zold lenne.
    assert.ok(szoveg.includes("IN_PROGRESS"));
  });

  /**
   * A KET AG KULONBOZIK. Az `isCreation` a `fromStatus === null` helyett all:
   * a portal EDDIG IS csak ezt az egy bitet olvasta ki a nyolc erteku belso
   * enumbol (merve: `naplo-sor.ts`).
   */
  it("a keletkezes sora megkulonboztetheto a kesobbi valtastol", () => {
    const sorral = (fromStatus: ServiceJobDetail["status"] | null) =>
      partnerServiceJobDetail({
        ...BELSO,
        timeline: [
          {
            kind: "status",
            at: "2026-09-20T08:00:00.000Z",
            sortKey: "e1",
            event: {
              id: "e1",
              fromStatus,
              toStatus: "NEW",
              note: null,
              actorName: null,
              createdAt: "2026-09-20T08:00:00.000Z",
            },
          },
        ],
      }).timeline[0];

    const letrejott = sorral(null);
    const valtas = sorral("NEW");
    if (!letrejott || letrejott.kind !== "status")
      return assert.fail("nem status sor");
    if (!valtas || valtas.kind !== "status")
      return assert.fail("nem status sor");
    assert.equal(letrejott.event.isCreation, true);
    assert.equal(valtas.event.isCreation, false);
  });

  it("a predikatum megkulonbozteti a ket alakot", () => {
    assert.equal(isPartnerServiceJobDetail(BELSO), false);
    assert.equal(
      isPartnerServiceJobDetail(partnerServiceJobDetail(BELSO)),
      true,
    );
  });
});
