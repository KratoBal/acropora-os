import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException } from "@nestjs/common";

import type { AuthenticatedUser } from "@acropora/types";

import { ServiceAssetsController } from "./service-assets.controller.js";
import type { ServiceAssetsService } from "./service-assets.service.js";

/**
 * A DOKUMENTUM-TAROLO ALLAPOTA BELSOS HATOKORRE VAN ZARVA (e59a0608).
 *
 * === A MERT RES ===
 *
 * A harom szerviz-kontroller HARMINC partner-jog alatti utvonalabol EZ AZ EGY
 * nem kapta meg a kerot, tehat szerkezetileg nem is tudott hatokort szukiteni.
 * A `PARTNER_SERVICE` viszont VISELI a `SERVICE_MANAGE` jogot
 * (`packages/types/src/auth.ts:388`), es a `PermissionGuard` jogot nez, nem
 * hatokort.
 *
 * A valasz `reason` mezoje a tarolo gyokerenek ABSZOLUT UTVONALAT viszi, amint
 * a kotet be van kapcsolva. A reszletes indok es az idozites a kontroller
 * fejlecében all.
 *
 * === MIERT KELL A ZOLD KONTROLL IS, ES EZ A FONTOSABB FELE ===
 *
 * Az elutasitas ONMAGABAN akkor is zold lenne, ha a vegpont SENKINEK nem
 * valaszol -- vagy ha egy utvonal- vagy hitelesitesi hiba miatt dobna. A
 * belsos hivo atmenese az, ami megmutatja, hogy a kapu a HATAROT huzza meg, es
 * nem mindenkit zar ki.
 */
function felallit() {
  const hivasok: number[] = [];
  const service = {
    documentStoreStatus: async () => {
      hivasok.push(1);
      return { enabled: false, status: { state: "not-enabled" as const } };
    },
  } as unknown as ServiceAssetsService;
  return { controller: new ServiceAssetsController(service), hivasok };
}

function hivo(be: {
  customerId?: string | null;
  supplierId?: string | null;
}): AuthenticatedUser {
  return {
    id: "user-1",
    customerId: be.customerId ?? null,
    supplierId: be.supplierId ?? null,
  } as unknown as AuthenticatedUser;
}

describe("a dokumentum-tároló állapota", () => {
  it("BELSŐS hívónak megválaszolja", async () => {
    const t = felallit();

    const valasz = await t.controller.documentStoreStatus(hivo({}));

    assert.equal((valasz as { enabled: boolean }).enabled, false);
    assert.deepEqual(t.hivasok, [1]);
  });

  /*
    A KET PARTNER-ALAK KULON ALL, mert a `partnerScopeOf` KET agon ad nem-belsos
    hatokort (`customer` es `supplier`), es egy vevo-oldali ellenorzes a
    szallitot atengedne. A szerviz partner epp a `supplierId` agon jon.
  */
  it("VEVŐ hatókörű hívót elutasít", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.documentStoreStatus(hivo({ customerId: "cus-1" })),
      ForbiddenException,
    );
  });

  it("SZÁLLÍTÓ hatókörű hívót elutasít", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.documentStoreStatus(hivo({ supplierId: "sup-1" })),
      ForbiddenException,
    );
  });

  /*
    ES A TAROLOT MEG SEM KERDEZI MEG -- KULON ALLITAS, KULON KERDES.

    A `documentStoreStatus` a lemezt olvassa (`stat`, `access`). Ha a kapu a
    hivas MOGE kerulne, minden partner-keres elvegezne ezt a munkat, mielott
    nemet mondunk -- es a tiltas ugy nezne ki, mintha mukodne.

    A ket kerdest azert NEM egy tesztbe irom, mert a futtato a TESZT nevet irja
    ki, nem az allitasét: egy kapu-semlegesito es egy kapu-athelyezo rontas
    kulonben UGYANAZT a sort adna, es a kalibracio nem kulonboztetne.
  */
  it("az elutasítás a tároló MEGKÉRDEZÉSE ELŐTT történik", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.documentStoreStatus(hivo({ customerId: "cus-1" })),
      ForbiddenException,
    );
    assert.deepEqual(t.hivasok, [], "a kapu a tároló-lekérdezés MÖGÖTT áll");
  });
});
