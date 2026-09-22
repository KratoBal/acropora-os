import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasImportController } from "./unas-import.controller.js";
import type { UnasApplyService } from "./unas-apply.service.js";
import type { UnasBrandReviewService } from "./unas-brand-review.service.js";
import type { UnasImportService } from "./unas-import.service.js";

/**
 * A DRY-RUN FELTOLTESI UT HATARA.
 *
 * === MIERT EZ AZ UT ELOSZOR (kartya 6f2eec9c) ===
 *
 * Ot fajl-feltoltesi vegpont all az api-ban, es ez az egyetlen, amit MA
 * egyetlen spec sem erint: nulla peldanyositas, nulla hivas (merve
 * 2026-09-22 a d09a906d fejen, osztaly-importra horgonyozva, nem
 * metodusnevre -- harom controller visel `uploadDocument` nevu metodust,
 * tehat a nev-alapu szamolas hamis FEDVE-t ad).
 *
 * === MIT MER EZ A SPEC, ES MIT NEM ===
 *
 * A controller TORZSE egyetlen hatart orzo: a NULLA-FAJL esetet. A tobbi
 * keret (25 MB, egy fajl, `.xlsx` plusz MIME) a multer DEKLARATIV
 * beallitasaban all, amit egy peldanyositott controlleren nem lehet
 * meghivni -- azt NEM ez a spec meri.
 *
 * Es a 25 MB-ot nem is kell: a `document-upload-limits.spec.ts` bejaroja
 * mar orzi, NEV SZERINT felsorolva ezt a fajlt mint szandekos kivetelt
 * ("ott EGY tablazat erkezik, nem kep"). Ha egy UJ nev kerul oda, az az
 * allitas szol. Amit viszont SEMMI nem orzott eddig: hogy a torzs
 * egyaltalan megall-e fajl nelkul, es hogy a kapott fajl valtozatlanul
 * megy-e tovabb.
 *
 * === A HAROM ALLITAS KULON-KULON RONTHATO, ES EZ A LENYEG ===
 *
 * Mindegyik MAS megnevezett tulajdonsagra szol, tehat egy rontas pontosan
 * egyet dont pirosra. Ha ketto pirosodna ugyanarra, az fedes lenne, es a
 * harmadik allitas nem mondana semmi ujat.
 */
describe("a UNAS dry-run feltoltesi ut hatara", () => {
  const szolgaltatas = (
    stageAndDryRun: UnasImportService["stageAndDryRun"],
  ): UnasImportController =>
    new UnasImportController(
      { stageAndDryRun } as unknown as UnasImportService,
      {} as unknown as UnasApplyService,
      {} as unknown as UnasBrandReviewService,
    );

  /**
   * NULLA-FAJL: a torzs egyetlen sajat hatara.
   *
   * === ES NEM FOLOSLEGES, PEDIG A FORDITO IS SZOL (merve 2026-09-22) ===
   *
   * A kalibracioja ELSORE nem fordult le: az orzot semlegesitve a `file`
   * `File | undefined` maradt, es a `stageAndDryRun(file)` hivas TS2345-tel
   * elhasalt. Vagyis ez az orzo EGYBEN TIPUS-SZUKITES is, es a fordito a
   * hatar egy RESZET mar orzi.
   *
   * De csak az ALAKOT, a VISELKEDEST nem: egy `if (!file) return ...` alak
   * atmegy a forditon, es a hivo csendben mas valaszt kap 400 helyett. Epp
   * ezt fogja meg ez az allitas -- a kalibralt rontas is ez volt.
   *
   * Ez a sor azert all itt, mert enelkul a kovetkezo olvaso joggal hiszi,
   * hogy a fordito ugyis fogja, es torli a tesztet.
   */
  it("fajl nelkul BadRequestException-t dob, es nem hivja a szolgaltatast", async () => {
    let hivva = false;
    const controller = szolgaltatas((async () => {
      hivva = true;
      return {} as never;
    }) as UnasImportService["stageAndDryRun"]);

    await assert.rejects(
      async () => controller.dryRun(undefined),
      (hiba: unknown) => {
        assert.ok(hiba instanceof BadRequestException);
        assert.match(String((hiba as Error).message), /XLSX fájl kötelező/);
        return true;
      },
    );
    assert.equal(hivva, false, "fajl nelkul nem szabad a szolgaltatashoz erni");
  });

  /** ATADAS: a kapott fajl VALTOZATLANUL megy tovabb. */
  it("a kapott fajlt valtozatlanul adja at a szolgaltatasnak", async () => {
    let kapott: Express.Multer.File | undefined;
    const controller = szolgaltatas((async (file: Express.Multer.File) => {
      kapott = file;
      return {} as never;
    }) as UnasImportService["stageAndDryRun"]);

    const fajl = {
      originalname: "katalogus.xlsx",
      buffer: Buffer.from("xlsx-bajtok"),
    } as Express.Multer.File;

    await controller.dryRun(fajl);

    assert.equal(kapott, fajl, "ugyanazt a peldanyt kell tovabbadni");
  });

  /** JOGOSULTSAG: HTTP hatar, kivulrol jovo fajllal. */
  it("a dry-run a termek-kezelesi jogot koveteli meg", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        UnasImportController.prototype.dryRun,
      ),
      [PERMISSIONS.PRODUCTS_MANAGE],
    );
  });
});
