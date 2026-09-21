import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { describe, it } from "node:test";
import { requireInternalWriter } from "./worksheet-internal-write.js";
import { WorksheetsService } from "./worksheets.service.js";
import type { WorksheetsRepository } from "./worksheets.repository.js";

const BELSOS = { id: "szerelo-1", customerId: null, supplierId: null } as never;
const PARTNER = {
  id: "vevo-1",
  customerId: "customer-1",
  supplierId: null,
} as never;

/**
 * A HATOKOR-KAPU, ES A PAR, AMI A PIROS OKAT BIZONYITJA.
 *
 * === MIERT PAR, ES NEM EGY ALLITAS (acrobot kikotese, 2026-09-21) ===
 *
 * Egy elutasitas tobb okbol lehet piros, es kivulrol mind egyforma: a kero
 * nem letezik, a hivas el sem jut idaig, vagy TENYLEG a hianyzo hatokor miatt.
 * Ezert all minden tilto allitas mellett egy ENGEDO: ugyanaz a fuggveny,
 * ugyanabban a korben, BELSOS keroval atmegy.
 *
 * Ha a tilto ag pirosodik es az engedo zold marad, akkor a piros oka
 * bizonyitottan a hatokor. Es ha egy javitas TULLO (a belsost is elvagja),
 * azt az engedo ag azonnal megmutatja.
 */
describe("a belsős írás kapuja", () => {
  it("BELSŐS kérővel átmegy, és a hatókört adja vissza", () => {
    assert.deepEqual(requireInternalWriter(BELSOS, "A művelet"), {
      kind: "internal",
    });
  });

  it("PARTNER kérőt elutasít", () => {
    assert.throws(
      () => requireInternalWriter(PARTNER, "A művelet"),
      ForbiddenException,
    );
  });

  /**
   * A MONDAT A MUVELETET NEVEZI MEG, nem a jogot.
   *
   * A regi kommentek epp a JOGRA hivatkoztak ("SERVICE_MANAGE, amit a partner
   * nem kap meg"), es az volt a hamis allitas. Egy hibauzenet, ami jogot nevez
   * meg, ugyanazt a tevedest viszi tovabb a KEPERNYORE is.
   */
  it("a mondat a MŰVELETET nevezi meg", () => {
    assert.throws(
      () => requireInternalWriter(PARTNER, "A munkalap szerkesztése"),
      (error: unknown) =>
        error instanceof ForbiddenException &&
        /A munkalap szerkesztése belsős lépés/.test(error.message),
    );
  });
});

/**
 * ES A HAROM VEGPONT TENYLEG HASZNALJA -- kulon-kulon.
 *
 * A kapu megletet a fenti harom allitas meri; EZ azt, hogy a harom irasi ut
 * AT IS MEGY rajta. A ketto nem ugyanaz: egy kapu, amit senki nem hiv, zold
 * marad a sajat tesztjeiben.
 *
 * A TAROLO URES DUPLA, es ez szandekos: ha a kapu elsul, a szolgaltatas el sem
 * jut a taroloig. Ha valaha NEM sul el, a hivas egy `undefined` metoduson
 * hasal el -- vagyis a teszt AKKOR IS piros lesz, csak mas okbol. Ez a
 * kulonbseg latszik a hibauzeneten.
 */
describe("a három írási út a kapun megy át", () => {
  const service = new WorksheetsService({} as unknown as WorksheetsRepository);

  it("updateDraft partnerként nem megy", async () => {
    await assert.rejects(
      () => service.updateDraft("worksheet-1", {} as never, PARTNER),
      ForbiddenException,
    );
  });

  it("setAssignees partnerként nem megy", async () => {
    await assert.rejects(
      () => service.setAssignees("worksheet-1", {} as never, PARTNER),
      ForbiddenException,
    );
  });

  it("setAssets partnerként nem megy", async () => {
    await assert.rejects(
      () => service.setAssets("worksheet-1", {} as never, PARTNER),
      ForbiddenException,
    );
  });

  /*
    A MASODIK KOR (2026-09-21 este): kilenc utvonal all igy. A ketto, ami a
    TAROLOIG sem jut el, kulon all lent -- ott a kapu a szolgaltatas elso sora,
    es a tarolo dupla ures maradhat.
  */
  it("createDepartment partnerként nem megy", async () => {
    await assert.rejects(
      () => service.createDepartment(PARTNER, "customer-1", {} as never),
      ForbiddenException,
    );
  });

  it("setPartnerCode partnerként nem megy", async () => {
    await assert.rejects(
      () => service.setPartnerCode(PARTNER, "customer-1", {} as never),
      ForbiddenException,
    );
  });

  it("addLine partnerként nem megy", async () => {
    await assert.rejects(
      () => service.addLine("worksheet-1", {} as never, PARTNER),
      ForbiddenException,
    );
  });

  it("updateLine partnerként nem megy", async () => {
    await assert.rejects(
      () => service.updateLine("worksheet-1", "line-1", {} as never, PARTNER),
      ForbiddenException,
    );
  });

  it("removeLine partnerként nem megy", async () => {
    await assert.rejects(
      () => service.removeLine("worksheet-1", "line-1", PARTNER),
      ForbiddenException,
    );
  });

  it("create partnerként nem megy", async () => {
    await assert.rejects(
      () => service.create({} as never, PARTNER),
      ForbiddenException,
    );
  });

  it("continueFrom partnerként nem megy", async () => {
    await assert.rejects(
      () => service.continueFrom("worksheet-1", PARTNER),
      ForbiddenException,
    );
  });

  it("close partnerként nem megy", async () => {
    await assert.rejects(
      () => service.close("worksheet-1", PARTNER),
      ForbiddenException,
    );
  });
});

/**
 * A MUNKANAPLO KET VEGPONTJA KULON ALL, MERT OTT A KAPU EGY MASIK ORZO MELLE
 * KERULT, NEM HELYETTE.
 *
 * A `updateEntry` eddig is korlatozott volt: `canEditWorksheetEntry` szerint a
 * kero a lap letrehozoja VAGY a jegy nyitoja legyen. Az jo kerdesre valaszol --
 * csak EGYEDUL allt, es a partner ATFERT alatta, mert a jegy nyitojakent o is
 * "szerzo". (Merve: a partner-fiok SAJAT NEVEN nyit jegyet.)
 *
 * A DONTES ALAPJA (acrobot, 2026-09-21): a partner-portal ma nem ir munkanaplot,
 * es ezt nem megfigyeles tartja, hanem ALLITAS --
 * `apps/partner/src/lib/portal-wiring.spec.ts` kimondja, hogy sem a lap, sem a
 * kliens nem hiv `/entries` vegpontot.
 */
describe("a munkanapló belsős", () => {
  const service = new WorksheetsService({} as unknown as WorksheetsRepository);

  it("addEntry partnerként nem megy", async () => {
    await assert.rejects(
      () => service.addEntry("worksheet-1", "szoveg", PARTNER),
      ForbiddenException,
    );
  });

  it("updateEntry partnerként nem megy", async () => {
    await assert.rejects(
      () => service.updateEntry("worksheet-1", "entry-1", "szoveg", PARTNER),
      ForbiddenException,
    );
  });

  /**
   * ES A SZERZOSEG-ELLENORZES TOVABBRA IS EL -- ez a kontroll.
   *
   * Belsos keroval a hivas MAR NEM a hatokor-kapun akad el, hanem eljut a
   * taroloig. Ha a kapu valaha ELVENNE a szerzoseg-ellenorzest (vagy forditva),
   * ez az allitas mutatja meg: a hibauzenet MAS lesz.
   */
  it("KONTROLL: belsős kérőnél a hatókör-kapu NEM fog, a hívás továbbmegy", async () => {
    await assert.rejects(
      () =>
        new WorksheetsService({
          entries: async () => null,
        } as unknown as WorksheetsRepository).updateEntry(
          "worksheet-1",
          "entry-1",
          "szoveg",
          BELSOS,
        ),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof ForbiddenException) &&
        /nem található/.test(error.message),
    );
  });
});
