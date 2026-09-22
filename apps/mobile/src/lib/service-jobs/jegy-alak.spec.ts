import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  jegyFejlec,
  jegyOroklendo,
  menthetoMasolatkent,
  partnerAlak,
} from "./jegy-alak";
import type { ServiceJobDetail, ServiceJobPartnerDetail } from "./types";

const BELSO = {
  id: "job-1",
  jobNumber: "HJ-0001",
  title: "Szivattyú leállt",
  status: "IN_PROGRESS",
  /*
    A BELSO ALAK IS VISZI EZT A KET MEZOT, es a fixtura ezert hordozza: az elso
    alakom ezt tagadta, es a discriminator EPP ezen bukott el. Egy fixtura, ami
    "tisztabb" a valosagnal, a sajat tevedesemet igazolta volna vissza.
  */
  partnerStatus: "IN_PROGRESS",
  partnerStatusLabel: "Folyamatban",
  customerName: "Fánk Kft.",
  departmentPath: ["Biodóm", "Medence 3"],
  worksheetCount: 0,
  createdAt: "2026-09-22T10:00:00.000Z",
  description: null,
  customerId: "customer-1",
  departmentId: "unit-1",
  departmentName: "Medence 3",
  scheduledAt: null,
  startedAt: null,
  completedAt: null,
  allowedSteps: ["COMPLETED"],
  timeline: [],
  assets: [],
  assignees: [{ userId: "user-1", name: "Szerelő", assignedAt: "x" }],
} as unknown as ServiceJobDetail;

const PARTNERI = {
  id: "job-1",
  jobNumber: "HJ-0001",
  title: "Szivattyú leállt",
  description: null,
  partnerStatus: "IN_PROGRESS",
  partnerStatusLabel: "Folyamatban van",
  departmentPath: ["Biodóm", "Medence 3"],
  createdAt: "2026-09-22T10:00:00.000Z",
  timeline: [],
  assets: [],
} as unknown as ServiceJobPartnerDetail;

const belsoFelirat = (status: string) =>
  status === "IN_PROGRESS" ? "Folyamatban" : status;

describe("a hibajegy ket alakja", () => {
  it("KONTROLL: a ket fixtura TENYLEG ket kulon alak", () => {
    assert.equal(partnerAlak(PARTNERI), true);
    assert.equal(partnerAlak(BELSO), false);
  });

  /**
   * A MERT OSSZEOMLAS: partner-alaknal a kepernyo `detail.allowedSteps.length`
   * hivason halt meg. Ez az allitas azt meri, hogy a dontes MA nem nyul hozza.
   *
   * ES A POZITIV KONTROLL UGYANEBBEN AZ ALLITASBAN ALL, mert enelkul egy URES
   * kepernyo is zold lenne: a felirat NEM ures, es NEM is a nyers kod --
   * a partner sajat szokincsebol valo mondat all ott.
   */
  it("partner-alaknal a PARTNERI felirat all, es nincs leptetes", () => {
    const fejlec = jegyFejlec(PARTNERI, false, belsoFelirat);

    assert.equal(fejlec.allapotFelirat, "Folyamatban van");
    assert.equal(fejlec.leptethet, false);
    // ES A VEVO NEVE NEM JELENIK MEG: partnernel a vevo MAGA a nezo.
    assert.equal(fejlec.ugyfelNeve, undefined);
  });

  /**
   * ES A BELSO ALAK VALTOZATLAN -- ez a masik fele a kontrollnak.
   *
   * Egy javitas, ami a partner-agat megoldja, de a belsot elrontja, ugyanolyan
   * rossz. A ket felirat SZANDEKOSAN kulonbozik ("Folyamatban" kontra
   * "Folyamatban van"), tehat az allitas nem tudja osszekeverni oket.
   */
  it("belso alaknal a BELSO felirat all, es van leptetes", () => {
    const fejlec = jegyFejlec(BELSO, false, belsoFelirat);

    assert.equal(fejlec.allapotFelirat, "Folyamatban");
    assert.equal(fejlec.leptethet, true);
    assert.equal(fejlec.ugyfelNeve, "Fánk Kft.");
  });

  it("mentett masolatbol nezve a belso alak sem leptethet", () => {
    assert.equal(jegyFejlec(BELSO, true, belsoFelirat).leptethet, false);
  });

  /**
   * ES AZ URES LEPESLISTA SEM LEPTETES. Enelkul a kepernyo kirajzolna a
   * blokkot egy ures gombsorral.
   */
  it("ures lepeslistaval sincs leptetes", () => {
    const nincsLepes = { ...BELSO, allowedSteps: [] } as ServiceJobDetail;

    assert.equal(jegyFejlec(nincsLepes, false, belsoFelirat).leptethet, false);
  });

  describe("amit a munkalap orokol", () => {
    it("partner-alaktol NINCS mit orokolni", () => {
      assert.equal(jegyOroklendo(PARTNERI), null);
    });

    /**
     * ES A BELSO ALAKBOL MIND A NEGY MEZO ATJON.
     *
     * A DARABSZAM IS ALLITAS: enelkul egy javitas, ami harmat ad at es a
     * negyediket elhagyja, atmenne. Ugyanaz a fajta, mint a feloldo kepernyo
     * `assignField` hianya, ami harom mezot ejtett el csendben.
     */
    it("belso alakbol MIND A NEGY mezo atjon", () => {
      const orokolt = jegyOroklendo(BELSO);

      assert.ok(orokolt, "belso alaknal van mit orokolni");
      assert.deepEqual(Object.keys(orokolt).sort(), [
        "assignees",
        "customerId",
        "customerName",
        "departmentId",
      ]);
      assert.equal(orokolt.customerId, "customer-1");
      assert.equal(orokolt.departmentId, "unit-1");
      assert.equal(orokolt.assignees.length, 1);
    });
  });

  describe("mi kerulhet a keszulekre", () => {
    it("a belso alak igen, a partneri nem", () => {
      assert.equal(menthetoMasolatkent(BELSO), true);
      assert.equal(menthetoMasolatkent(PARTNERI), false);
    });
  });
});
