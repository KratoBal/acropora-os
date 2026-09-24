import { readFileSync } from "node:fs";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * A MENÜPONT ÉS AZ OLVASÓ VÉGPONTOK UGYANAZT A JOGOT KÉRJÉK, AZ ÍRÓK EGY
 * SZIGORÚBBAT -- ugyanaz a minta, mint az `asset-label-permission.spec.ts`.
 *
 * A LISTA/ADATLAP `AQUARIUMS_VIEW`, A LÉTREHOZÁS/MÓDOSÍTÁS/BERENDEZÉS-ÍRÁS
 * `AQUARIUMS_MANAGE`. Ha a kettő szétcsúszna, vagy egy csak-olvasó
 * felhasználó 403-at kapna a listánál, vagy egy írási végpont csendben
 * megnyílna annak is, akinek csak megtekintésre van joga.
 */
const NAV = "../../packages/types/src/navigation.ts";
const CONTROLLER = "src/aquariums/aquariums.controller.ts";

const READ_ROUTES = ["@Get()", '@Get("customers")', '@Get(":id")'];
const WRITE_ROUTES = [
  "@Post()",
  '@Patch(":id")',
  '@Post(":id/equipment")',
  '@Delete(":id/equipment/:equipmentId")',
];

function menuPermission(): string {
  const src = readFileSync(NAV, "utf8");
  const block = /id: "aquariums",([\s\S]*?)\n  \},/.exec(src);
  assert.ok(block, "az aquariums bejegyzés nincs a közös forrásban");
  const permission = /permission\(PERMISSIONS\.([A-Z_]+)\)/.exec(block[1]!);
  assert.ok(
    permission,
    "az aquariums bejegyzésnek nincs permission() alakú joga",
  );
  return permission[1]!;
}

/**
 * Egy végpont joga: a dekorátor a route UTÁN áll, ugyanúgy, mint az
 * `asset-label-permission.spec.ts`-ben (`@Get()` / `@RequirePermissions(...)`
 * / metódusnév, ebben a sorrendben).
 */
function routePermission(route: string): string {
  const src = readFileSync(CONTROLLER, "utf8");
  const i = src.indexOf(route);
  assert.notEqual(i, -1, `${route} nincs a vezérlőben`);
  const permission = /@RequirePermissions\(PERMISSIONS\.([A-Z_]+)\)/.exec(
    src.slice(i, i + 200),
  );
  assert.ok(
    permission,
    `${route} után nem találtam RequirePermissions dekorátort`,
  );
  return permission[1]!;
}

describe("az akváriumok menüpont és a végpontjai", () => {
  it("a menüpont AQUARIUMS_VIEW alatt áll", () => {
    assert.equal(menuPermission(), "AQUARIUMS_VIEW");
  });

  it("az olvasó végpontok (lista, adatlap) a menüpont jogát kérik", () => {
    const menu = menuPermission();
    const eltero = READ_ROUTES.filter((r) => routePermission(r) !== menu);
    assert.deepEqual(
      eltero,
      [],
      `ezek az olvasó végpontok más jogot kérnek, mint a menüpont (${menu})`,
    );
  });

  /**
   * TESTVÉR-KONTROLL: az íróknak SZIGORÚBB jog kell, nem ugyanaz. Ha ez az
   * állítás hiányozna, a fenti "olvasók egyeznek" állítás akkor is zöld
   * lenne, ha VÉLETLENÜL az írók is csak AQUARIUMS_VIEW-t kérnének --
   * vagyis bárki, aki csak megtekintésre jogosult, felvihetne akváriumot.
   */
  it("az író végpontok (létrehozás, módosítás, berendezés) AQUARIUMS_MANAGE-et kérnek, nem a menüpont jogát", () => {
    for (const route of WRITE_ROUTES)
      assert.equal(
        routePermission(route),
        "AQUARIUMS_MANAGE",
        `${route} nem AQUARIUMS_MANAGE-et kér`,
      );
  });
});
