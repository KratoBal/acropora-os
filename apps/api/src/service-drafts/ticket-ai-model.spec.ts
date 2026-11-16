import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  NOTIFICATION_ROLE_VALUES,
  SERVICE_CAPABILITY_VALUES,
  type ServiceDraftIntakeState,
} from "@acropora/types";

/**
 * A TICKET@ AI HIBAJEGY-VAZLAT ADATMODELLJE (kartya ec7b947b, S1): a harom uj elem harom helyen all, es a hianyat
 * kulon-kulon el lehet felejteni: a sema enumjaban, a migraciojaban es a `@acropora/types` keszletben. Ez a teszt a hármat
 * egymashoz meri, nem a sorok szamat: a hianyzo ADD VALUE migracio nelkul a sema generalna a klienst, az adatbazis viszont
 * visszautasitana az erteket (a hiba az elso bejelolesnel jonne ki, nem a CI-ban).
 *
 * MI PIROSIT: egy uj enum-ertek a keszletben, de a semaban nincs; a semaban van, de a migracio nem adja hozza; a
 * `ServiceDraftIntakeState` egy erteke a migracio enumjabol hianyzik; az `intakeState` alapertéke nem RULE_DRAFT
 * (a meglevo Capasuli sorok akkor mas allapotot kapnanak).
 */
const SEMA = "../../packages/database/prisma/schema.prisma";
const MIGRACIO =
  "../../packages/database/prisma/migrations/20261116220000_ticket_ai_model/migration.sql";

const sema = readFileSync(SEMA, "utf8");
const migracio = readFileSync(MIGRACIO, "utf8");

/** A semaban az `enum <nev> { ... }` blokk ertekei (a `///` megjegyzesek nelkul). */
function enumErtekek(nev: string): string[] {
  const blokk = new RegExp(`enum ${nev} \\{([\\s\\S]*?)\\n\\}`).exec(sema);
  assert.ok(blokk, `a semaban nincs ${nev} enum`);
  return blokk[1]!
    .split("\n")
    .map((sor) => sor.trim())
    .filter((sor) => sor !== "" && !sor.startsWith("//"));
}

const INTAKE_ALLAPOTOK: readonly ServiceDraftIntakeState[] = [
  "RULE_DRAFT",
  "AI_DRAFT",
  "AI_UNAVAILABLE",
  "WATCH_OFF",
  "UNKNOWN_SENDER",
];

describe("a ticket@ AI vázlat adatmodellje: séma, migráció és típus-készlet együtt", () => {
  it("a két bővített készlet minden eleme benne van a séma enumjában", () => {
    for (const ertek of NOTIFICATION_ROLE_VALUES)
      assert.ok(
        enumErtekek("NotificationRole").includes(ertek),
        `NotificationRole.${ertek} hiányzik a sémából`,
      );
    for (const ertek of SERVICE_CAPABILITY_VALUES)
      assert.ok(
        enumErtekek("ServiceCapability").includes(ertek),
        `ServiceCapability.${ertek} hiányzik a sémából`,
      );
  });

  it("a két új enum-értéket a migráció ADD VALUE-val adja hozzá", () => {
    assert.match(
      migracio,
      /ALTER TYPE "NotificationRole" ADD VALUE 'SERVICE_TICKET_AI_DRAFT';/,
    );
    assert.match(
      migracio,
      /ALTER TYPE "ServiceCapability" ADD VALUE 'TICKET_MAIL_AI_WATCH';/,
    );
  });

  it("a ServiceDraftIntakeState értékei a típusban, a sémában és a migrációban ugyanazok", () => {
    assert.deepEqual(enumErtekek("ServiceDraftIntakeState"), [
      ...INTAKE_ALLAPOTOK,
    ]);
    const migraciosEnum =
      /CREATE TYPE "ServiceDraftIntakeState" AS ENUM \(([^)]*)\);/.exec(
        migracio,
      );
    assert.ok(migraciosEnum, "a migráció nem hozza létre az enumot");
    assert.deepEqual(
      [...migraciosEnum[1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]),
      [...INTAKE_ALLAPOTOK],
    );
  });

  it("az intakeState alapértéke RULE_DRAFT a sémában és a migrációban: a meglévő sorok nem változnak", () => {
    assert.match(
      sema,
      /intakeState\s+ServiceDraftIntakeState\s+@default\(RULE_DRAFT\)/,
    );
    assert.match(
      migracio,
      /ADD COLUMN "intakeState" "ServiceDraftIntakeState" NOT NULL DEFAULT 'RULE_DRAFT'/,
    );
  });
});
