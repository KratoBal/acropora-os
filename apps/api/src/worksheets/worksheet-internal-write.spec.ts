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
});
