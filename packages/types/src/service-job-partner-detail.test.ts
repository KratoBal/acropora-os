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
  partnerStatusLabel: "Folyamatban",
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
    assert.equal(partner.partnerStatusLabel, "Folyamatban");
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
