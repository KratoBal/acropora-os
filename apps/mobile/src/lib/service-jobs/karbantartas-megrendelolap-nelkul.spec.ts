import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { jegyFejlec, jegyOroklendo, menthetoMasolatkent } from "./jegy-alak";
import { serviceJobCardMeta } from "./list-card";
import type { ServiceJobDetail, ServiceJobListItem } from "./types";

/**
 * A MEGRENDELŐLAP NÉLKÜLI KARBANTARTÁSI LAP A TELEFONON (karbantartási
 * felmérés S8): várhatóan nincs változás, és ez a spec ezt méri, nem feltételezi.
 *
 * A szerver lap-válasza S7 óta `source` mezőt is visz (megrendelőlap, vagy a
 * szerződés tételei). A mobil `ServiceJobDetail` ezt nem sorolja (szűkebb a
 * közösnél, lásd `mobile-response-mirror.spec.ts`), a lap a `kind`-ból dönt.
 * Ezért a fixtúra a szerver valódi alakját viseli, a `source`-szal együtt, és a
 * telefon minden döntése ugyanaz kell legyen mindhárom forrással: szerződésből
 * megrendelőlap nélkül, a vevő megrendelőlapjával, és forrás nélkül.
 *
 * MI PIROSÍT: ha a telefon bármelyik döntése (fejléc, léptetés, örökölt mezők,
 * mentett másolat, listakártya) a forrástól függne, vagy ha egy megrendelőlap
 * nélküli karbantartási lap belső alakja partneri alaknak látszana.
 */
const SZERZODES = {
  id: "contract-1",
  number: "SZ-2026-01",
  title: "Karbantartás",
};

const FORRASOK = {
  szerzodesbol: {
    kind: "CONTRACT",
    contract: SZERZODES,
    itemDescriptions: ["Akvárium karbantartás"],
  },
  vevoiLappal: {
    kind: "MAINTENANCE_ORDER",
    orderId: "order-1",
    orderNumber: "MR-2026-0001",
    customerForm: true,
    contract: SZERZODES,
  },
  nincs: null,
} as const;

function lap(source: unknown): ServiceJobDetail {
  return {
    id: "job-1",
    jobNumber: "HJ-0001",
    title: "Éves karbantartás",
    kind: "MAINTENANCE",
    status: "SCHEDULED",
    partnerStatus: "SCHEDULED",
    partnerStatusLabel: "Ütemezve",
    customerName: "Fánk Kft.",
    departmentPath: ["Biodóm", "Medence 3"],
    worksheetCount: 1,
    createdAt: "2026-10-15T10:00:00.000Z",
    description: null,
    customerId: "customer-1",
    departmentId: "unit-1",
    departmentName: "Medence 3",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    allowedSteps: ["IN_PROGRESS"],
    timeline: [],
    assets: [],
    assignees: [{ userId: "user-1", name: "Szerelő", assignedAt: "x" }],
    source,
  } as unknown as ServiceJobDetail;
}

const felirat = (status: string) =>
  status === "SCHEDULED" ? "Ütemezve" : status;

function dontesek(detail: ServiceJobDetail) {
  return {
    fejlec: jegyFejlec(detail, false, felirat),
    masolatbolFejlec: jegyFejlec(detail, true, felirat),
    oroklendo: jegyOroklendo(detail),
    menthetoMasolatkent: menthetoMasolatkent(detail),
    kartya: serviceJobCardMeta(
      detail as unknown as ServiceJobListItem,
      new Date("2026-10-15T12:00:00.000Z"),
    ),
  };
}

describe("a megrendelőlap nélküli karbantartási lap a telefonon", () => {
  it("POZITÍV KONTROLL: a szerződésből jött lap belső alak, léptethető, a kártya kitöltött", () => {
    const d = dontesek(lap(FORRASOK.szerzodesbol));
    assert.deepEqual(d.fejlec, {
      allapotFelirat: "Ütemezve",
      leptethet: true,
      ugyfelNeve: "Fánk Kft.",
    });
    assert.equal(d.masolatbolFejlec.leptethet, false);
    assert.equal(d.menthetoMasolatkent, true);
    assert.equal(d.oroklendo?.customerId, "customer-1");
    assert.match(d.kartya, /Szerelő · 1 ML/);
  });

  it("minden döntés ugyanaz, akár megrendelőlap nélkül, akár vevői lappal, akár forrás nélkül", () => {
    const alap = dontesek(lap(FORRASOK.szerzodesbol));
    assert.deepEqual(dontesek(lap(FORRASOK.vevoiLappal)), alap);
    assert.deepEqual(dontesek(lap(FORRASOK.nincs)), alap);
  });
});
