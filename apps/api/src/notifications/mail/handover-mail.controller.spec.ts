import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, NotFoundException } from "@nestjs/common";

import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobPackageService } from "../../service-jobs/service-job-package.service.js";
import { HandoverMailController } from "./handover-mail.controller.js";
import type { HandoverMailService } from "./handover-mail.service.js";

/**
 * A KIKULDES ELONEZETE BELSOS HATOKORRE VAN ZARVA.
 *
 * === MIERT KELL RA ALLITAS, HOLOTT A JOG MAR OTT ALL A VEGPONTON ===
 *
 * A `SERVICE_MANAGE` jogot a `PARTNER_SERVICE` szerep IS VISELI (a jog-tabla
 * merve: `packages/types/src/auth.ts`). A `@RequirePermissions` tehat NEM
 * szukit hatokorre -- ugyanaz a lelet, ami 2026-09-21-en harom munkalap-iro
 * vegpontot erintett.
 *
 * Ez a valasz E-MAIL CIMEKET szallit. A rendszer tobbi resze ezt a hatart
 * tartja (a jegy naplo-sora cim nelkuli, a `customerContacts` valaszto csak
 * nevet ad), tehat egy tagabb vegpont nem egy uj kepesseg lenne, hanem a
 * meglevo dontes megkerulese.
 *
 * === ES A KET ALLITAS EGYUTT MER, KULON-KULON EGYIK SEM ===
 *
 * A tiltas ONMAGABAN akkor is zold lenne, ha a vegpont SENKINEK nem valaszol.
 * Ezert all mellette a belsos hivo ismert pozitiv kontrollja.
 */
function felallit(elonezet: unknown = { kind: "skip", reason: "mode-off" }) {
  const hivasok: string[] = [];
  const mail = {
    preview: async (id: string) => {
      hivasok.push(id);
      return elonezet;
    },
  } as unknown as HandoverMailService;
  const csomag = {} as unknown as ServiceJobPackageService;
  return { controller: new HandoverMailController(csomag, mail), hivasok };
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

describe("HandoverMailController.preview", () => {
  it("BELSOS hívónak megadja az előnézetet", async () => {
    const t = felallit({
      kind: "send",
      recipients: [{ name: "Üzemeltető Ubul", email: "uzem@partner.hu" }],
      subject: "A HJ-2026-009 számú hibajegyet lezártuk.",
    });

    const valasz = await t.controller.preview("job-1", hivo({}));

    assert.equal((valasz as { kind: string }).kind, "send");
    assert.deepEqual(t.hivasok, ["job-1"]);
  });

  /*
    A KET PARTNER-ALAK KULON ALL, mert a `partnerScopeOf` KET AGON ad
    nem-belsos hatokort (`customer` es `supplier`), es egy vevo-oldali
    ellenorzes a szallitot atengedne. A szerviz partner epp a `supplierId`
    agon jon.
  */
  it("VEVŐ hatókörű hívót elutasít, és a szolgáltatást meg sem hívja", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.preview("job-1", hivo({ customerId: "cus-1" })),
      ForbiddenException,
    );
    assert.deepEqual(t.hivasok, [], "a kapu után is lefutott a lekérdezés");
  });

  it("SZÁLLÍTÓ hatókörű hívót elutasít, és a szolgáltatást meg sem hívja", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.preview("job-1", hivo({ supplierId: "sup-1" })),
      ForbiddenException,
    );
    assert.deepEqual(t.hivasok, [], "a kapu után is lefutott a lekérdezés");
  });

  /*
    A NEM LETEZO JEGY 404, NEM URES VALASZ.

    A szolgaltatas `null`-t ad vissza, es ha az valtozatlanul kimenne, a
    felulet egy ures cimzett-listat latna -- megkulonboztethetetlenul attol,
    hogy a vevonek nincs aktiv portal-fiokja. Ket teljesen mas teendo, egy
    kepernyokep.
  */
  it("nem létező jegyre 404, nem üres válasz", async () => {
    const t = felallit(null);
    await assert.rejects(
      t.controller.preview("nincs-ilyen", hivo({})),
      NotFoundException,
    );
  });
});
