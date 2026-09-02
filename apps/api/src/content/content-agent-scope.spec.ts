import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { ProductExtensionController } from "../products/product-extension.controller.js";

/**
 * A TARTALOM-AGENS SZEREPE NEM ER EL TERMEKET -- ES EZT A HATASAN MERJUK.
 *
 * MIERT KELL, HOLOTT MAR ALL EGY ALLITAS A JOGAIRA. A
 * `content-agent.guard.spec.ts` a LISTAT meri: ket jog, nev szerint, es a hossz
 * pontosan ketto. Az a lista akkor pirosodik, ha valaki HOZZAAD egy jogot a
 * szerephez.
 *
 * AMIT NEM FOG MEG: ha egy VEGPONT valtozik meg ugy, hogy `content.manage`
 * joggal elerhetove valik. A szerep listaja valtozatlan marad, tehat a
 * hossz-allitas HALLGAT. Ez az allitas a MASIK oldalrol nez: a szerep es egy
 * valodi, termek-modosito vegpont TALALKOZASAT.
 *
 * === A LENYEG: NEM AZ ELBUKAS, HANEM AZ OKA ===
 *
 * Egy hivas SOK MINDENTOL elbukhat: hianyzo mezo, nem letezo termek, rossz
 * alak. Mind a harom "elbukott", es EGYIK SEM mond semmit a jogrol. Ezert nem
 * a hivast futtatjuk, hanem magat a JOGOSULTSAG-ORT, es a hibauzenetet is
 * allitjuk -- az kulonbozteti meg a jogosultsagi elutasitast minden mastol.
 *
 * (Acrobot merese ma este ugyanerre: a Medusa admin vegpontjai MIND 401-et
 * adtak, akkor is, ha a vegpont nem letezett -- a hitelesito reteg elobb sult
 * el, mint a forgalomiranyito, es a meres semmit nem tudott megkulonboztetni.)
 *
 * === A KOVETELMENY IS MERT, NEM BEIRT ===
 *
 * Az ellenorzott jogot a VEZERLOBOL olvassuk ki, nem ide irjuk be. Ha valaki
 * atallitja a `PUT /product-extensions/:variantId` jogat, ez az allitas
 * automatikusan azt a jogot meri -- egy beirt `products.manage` viszont
 * csendben egy MAR NEM LETEZO kovetelmenyt mérne.
 */
const KERT_JOGOK = new Reflector().get<string[]>(
  // A KULCSOT IMPORTALJUK, NEM BEIRJUK. Elsore sztringkent irtam be
  // ("requiredPermissions"), es a valodi ertek `acropora:required-permissions`
  // -- a lenti pozitiv kontroll fogta meg, egy korrel korabban, mint hogy
  // barmit allitottam volna a jogosultsagrol.
  REQUIRED_PERMISSIONS_KEY,
  ProductExtensionController.prototype.upsert,
);

function context(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => ProductExtensionController.prototype.upsert,
    getClass: () => ProductExtensionController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function felhasznalo(role: AuthenticatedUser["role"]): AuthenticatedUser {
  return {
    id: `u-${role}`,
    email: `${role.toLowerCase()}@example.invalid`,
    displayName: role,
    role,
    // A JOGOKAT NEM ADJUK AT: a `hasAllPermissions` a SZEREPBOL vezeti le
    // oket. Ha itt kulon listat adnank, azt mernenk, amit magunk irtunk be --
    // nem azt, amit a szerep valojaban ad.
    // A KET PARTNER-MEZO KOTELEZO, NEM OPCIONALIS -- a tipus jegyzete kimondja,
    // miert: egy opcionalis mezo minden felejtő hivasi helyen `undefined`
    // lenne, es a hatokor csendben "belsos"-re esne vissza. Itt is kiirjuk.
    customerId: null,
    supplierId: null,
  };
}

describe("a tartalom-agens és a termékek", () => {
  it("a vezérlőből olvassuk ki, milyen jogot kér a végpont", () => {
    // ISMERT POZITIV KONTROLL A KIOLVASASRA. Ha a metaadat-kulcs elirodna, a
    // `KERT_JOGOK` `undefined` lenne, es akkor a jogosultsag-or MINDENKIT
    // atengedne (`if (!permissions?.length) return true`) -- vagyis a lenti
    // allitas ZOLD helyett pirosodna, de a MASIK, "atengedi" allitas
    // csendben igazza valna. Ez a sor zarja ki.
    assert.ok(KERT_JOGOK, "nem sikerült kiolvasni a végpont jogosultságát");
    assert.deepEqual(KERT_JOGOK, [PERMISSIONS.PRODUCTS_MANAGE]);
  });

  it("a tartalom-agens szerepét a jogosultság-őr utasítja el", () => {
    const guard = new PermissionGuard(new Reflector());
    assert.throws(
      () => guard.canActivate(context(felhasznalo("CONTENT_AGENT"))),
      (error: unknown) => {
        // AZ OK IS ALLITAS, NEM CSAK AZ ELBUKAS. Egy 400-as vagy egy 404-es
        // ugyanugy "elbukott" lenne, es semmit nem mondana a jogrol.
        assert.ok(error instanceof ForbiddenException);
        assert.match(String(error.message), /Nincs jogosultságod/);
        return true;
      },
    );
  });

  it("ugyanaz az őr átengedi azt, akinek VAN joga", () => {
    // A MASIK IRANY, ES NEM ELHAGYHATO. Enelkul egy or, ami MINDENKIT
    // elutasit, ugyanugy zoldre vinne a fenti allitast -- es akkor nem a
    // szerep szukseget mernenk, hanem azt, hogy a vegpont senkinek nem megy.
    const guard = new PermissionGuard(new Reflector());
    assert.equal(guard.canActivate(context(felhasznalo("ADMIN"))), true);
  });
});
