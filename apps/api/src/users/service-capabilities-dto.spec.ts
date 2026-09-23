// The decorators on the DTO read their metadata through `Reflect`, which the
// application installs in `main.ts`. A unit test starts without it, so the
// import has to come first, before the DTO module is evaluated.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UpdateUserDto } from "./dto/user.dto.js";

const ALAP = { expectedUpdatedAt: "2026-09-23T08:00:00.000Z" };

function serviceCapabilityMessages(serviceCapabilities: unknown): string[] {
  const dto = plainToInstance(UpdateUserDto, {
    ...ALAP,
    serviceCapabilities,
  });
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

/**
 * A PARJA, UGYANAZZAL A MINTAVAL, MINT A `notification-roles-dto.spec.ts` --
 * lasd annak fejlecet. Itt a mert korlat mas: a `ServiceCapability` enum a
 * sematerv oldalan mindig is EGY erteket viselt (`MATERIAL_REQUEST_MARK_
 * RECEIVED`), csak a keszlet, ami az `@IsIn`-t taplalja, es a felulet, ami a
 * jelolonegyzetet rajzolja, NEM LETEZETT: az iro ut es a felulet ehhez a
 * kepesseghez a `3dc8edab` kartyaig sehol nem allt.
 */
describe("UpdateUserDto serviceCapabilities", () => {
  it("elfogadja a meglévő MATERIAL_REQUEST_MARK_RECEIVED képességet", () => {
    assert.deepEqual(
      serviceCapabilityMessages(["MATERIAL_REQUEST_MARK_RECEIVED"]),
      [],
    );
  });

  it("elfogadja az üres listát is", () => {
    assert.deepEqual(serviceCapabilityMessages([]), []);
  });

  it("a mező hiánya sem hibázik -- a hiányzó mező NEM nyúl a képességekhez", () => {
    const dto = plainToInstance(UpdateUserDto, ALAP);
    assert.deepEqual(
      validateSync(dto).flatMap((error) =>
        Object.values(error.constraints ?? {}),
      ),
      [],
    );
    assert.equal(dto.serviceCapabilities, undefined);
  });

  /**
   * A KONTROLL: a keszlet nem NYITOTT fel mindent, csak a megnevezett
   * erteket. Enelkul a fenti allitasok egy olyan megvalositason is zoldek
   * lennenek, amibol az `@IsIn` teljesen hianyzik.
   */
  it("KONTROLL: egy ki nem mondott képességet visszautasít", () => {
    const messages = serviceCapabilityMessages(["NEM_LETEZO_KEPESSEG"]);
    assert.ok(
      messages.length > 0,
      "egy nem létező képességet vissza kellett volna utasítania",
    );
  });

  /**
   * TESTVER-KONTROLL: A KET MEZO NEM KEVEREDIK OSSZE.
   *
   * MI PIROSIT: ha a ket `@IsIn` ugyanazt a keszletet olvasna (masolas-hiba),
   * egy `notificationRoles`-be irt ervenyes ertek a `serviceCapabilities`
   * validatoran is atmenne, vagy forditva.
   */
  it("KONTROLL: a notificationRoles értéke nem érvényes serviceCapabilities-ként", () => {
    const messages = serviceCapabilityMessages(["SERVICE_JOB_OPENED"]);
    assert.ok(
      messages.length > 0,
      "a notificationRoles egyik értékét sem szabadna elfogadnia",
    );
  });
});
