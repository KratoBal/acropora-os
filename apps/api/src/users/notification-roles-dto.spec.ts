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

function notificationRoleMessages(notificationRoles: unknown): string[] {
  const dto = plainToInstance(UpdateUserDto, { ...ALAP, notificationRoles });
  return validateSync(dto).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
}

/**
 * MERT KORLAT, MIELOTT A `notification-roles.ts` BOVULT: a
 * `NotificationRoleInfo.value` union egyetlen literalt ismert
 * (`"SERVICE_JOB_OPENED"`), es a `NOTIFICATION_ROLE_VALUES` -- amit ez a DTO
 * `@IsIn`-nel olvas -- ebbol szarmazik. Az adatbazis enumja MAR ismerte a
 * `MATERIAL_REQUEST_CREATED` erteket (lasd schema.prisma), a repository MAR
 * olvasta szerep szerint, es a webes szerkeszto a KOZOS listabol epiti a
 * jelolonegyzeteket -- csak a keszlet nem tartalmazta az uj elemet, tehat sem
 * a felulet nem ajanlotta fel, sem az API nem fogadta volna el, ha valahogy
 * mégis elkuldik.
 */
describe("UpdateUserDto notificationRoles", () => {
  it("elfogadja a meglévő SERVICE_JOB_OPENED szerepet", () => {
    assert.deepEqual(notificationRoleMessages(["SERVICE_JOB_OPENED"]), []);
  });

  it("elfogadja az anyagigény-értesülés szerepét", () => {
    assert.deepEqual(
      notificationRoleMessages(["MATERIAL_REQUEST_CREATED"]),
      [],
    );
  });

  it("elfogadja mindkettőt együtt, és az üres listát is", () => {
    assert.deepEqual(
      notificationRoleMessages([
        "SERVICE_JOB_OPENED",
        "MATERIAL_REQUEST_CREATED",
      ]),
      [],
    );
    assert.deepEqual(notificationRoleMessages([]), []);
  });

  /**
   * A KONTROLL: a keszlet nem NYITOTT fel mindent, csak a ket megnevezett
   * erteket. Enelkul az elozo harom allitas egy olyan megvalositason is zold
   * lenne, amibol az `@IsIn` teljesen hianyzik.
   */
  it("KONTROLL: egy ki nem mondott szerepet visszautasít", () => {
    const messages = notificationRoleMessages(["NEM_LETEZO_SZEREP"]);
    assert.ok(
      messages.length > 0,
      "egy nem létező szerepet vissza kellett volna utasítania",
    );
  });
});
