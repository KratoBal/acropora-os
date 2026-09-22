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
  const kuldesek: string[] = [];
  const csomagLekeresek: string[] = [];
  const mail = {
    preview: async (id: string) => {
      hivasok.push(id);
      return elonezet;
    },
    send: async (input: { serviceJobId: string }) => {
      kuldesek.push(input.serviceJobId);
      return { kind: "sent", recipients: 1 };
    },
  } as unknown as HandoverMailService;
  const csomag = {
    download: async (id: string) => {
      csomagLekeresek.push(id);
      return { fileName: "csomag.zip", bytes: Buffer.alloc(8, 1) };
    },
  } as unknown as ServiceJobPackageService;
  return {
    controller: new HandoverMailController(csomag, mail),
    hivasok,
    kuldesek,
    csomagLekeresek,
  };
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

/**
 * A KULDES IS BELSOS HATOKORRE VAN ZARVA (acrobot dontese, 2026-09-22 02:29).
 *
 * === MIERT KULON ALLITAS, HOLOTT AZ ELONEZETRE MAR VAN ===
 *
 * A ket vegpont ket kulon kapu, es a jogi alapjuk KOZOS (`SERVICE_MANAGE`,
 * amit a `PARTNER_SERVICE` is visel). Ha csak az egyikre allna allitas, a
 * masikat egy kesobbi szerkesztes csendben kinyithatna -- es epp a SULYOSABB
 * felet, mert ott nem cim szivarog ki, hanem LEVEL MEGY KI a mi nevunkben.
 *
 * === ES A CSOMAG-LEKERES SZAMA IS ALLITAS, NEM DISZ ===
 *
 * A kapu a `download()` ELOTT all. Ha moge kerulne, a partner hivasa
 * eloallitana a teljes csomagot (PDF-generalas), mielott elutasitjuk --
 * vagyis a tiltas ugy nezne ki, mintha mukodne, es kozben minden hivas
 * elvegezne a draga munkat.
 */
describe("HandoverMailController.send", () => {
  const torzs = { message: "Köszönjük a bizalmat." };

  it("BELSOS hívó küldése végigmegy", async () => {
    const t = felallit();

    const valasz = await t.controller.send("job-1", torzs, hivo({}));

    assert.deepEqual(valasz, { kind: "sent", recipients: 1 });
    assert.deepEqual(t.kuldesek, ["job-1"]);
    assert.deepEqual(t.csomagLekeresek, ["job-1"]);
  });

  /*
    A KET KERDES KET KULON TESZT, es ez nem tagolasi izles.

    Ha az elutasitas ES a sorrend ugyanabban a tesztben allna, a kalibracio
    kimenetebol nem lehetne megmondani, MELYIK fogott: a futtato a TESZT nevet
    irja ki, nem az allitasét. Merve ugyanezen a napon: a kapu semlegesitese es
    a kapu ATHELYEZESE a csomag moge PONTOSAN UGYANAZT a ket sort adta.
  */
  it("VEVŐ hatókörű hívót elutasít", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.send("job-1", torzs, hivo({ customerId: "cus-1" })),
      ForbiddenException,
    );
    assert.deepEqual(t.kuldesek, [], "a kapu után is elment a levél");
  });

  it("SZÁLLÍTÓ hatókörű hívót elutasít", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.send("job-1", torzs, hivo({ supplierId: "sup-1" })),
      ForbiddenException,
    );
    assert.deepEqual(t.kuldesek, [], "a kapu után is elment a levél");
  });

  it("az elutasítás a csomag ELŐÁLLÍTÁSA ELŐTT történik", async () => {
    const t = felallit();
    await assert.rejects(
      t.controller.send("job-1", torzs, hivo({ customerId: "cus-1" })),
      ForbiddenException,
    );
    assert.deepEqual(
      t.csomagLekeresek,
      [],
      "a kapu a csomag-előállítás MÖGÖTT áll",
    );
  });
});
