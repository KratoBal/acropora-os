import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CreateWorksheetDto } from "./dto/worksheet.dto.js";
import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/**
 * A LAP ALTAL ERINTETT ESZKOZOK: A HATOKOR AZ IRAS ELOTT DOL EL.
 *
 * Balazs kerese (2026-09-15): a hibajegynel kivalasztott eszkozok jelenjenek
 * meg a belole nyitott lapon is.
 *
 * === AMIT EZ A FAJL MER, ES AMIT NEM ===
 *
 * NEM a valaszkodot. Egy 400-ra tett allitas akkor is zold lenne, ha az
 * ellenorzes a LETREHOZAS UTAN futna -- es epp az a sorrend a lenyeg: egy
 * idegen helyszin eszkozevel indulo lap mar LETEZNE, mire a hivo hibat kap.
 * Ezert az allitas a TAROLON all: a `createDraft` el sem indulhat.
 *
 * Mindegyik melle jar egy KONTROLL, ami megmutatja, hogy a `createDraft`
 * egyaltalan meghivodik -- enelkul egy elrontott hamis tarolo ugyanezt a
 * zoldet adna.
 */

function serviceWith(kieso: string[]) {
  const hivasok: { assetIds?: readonly string[] }[] = [];
  const repository = {
    customer: async () => ({ id: "vevo-1" }),
    department: async () => ({
      id: "unit-1",
      customerId: "vevo-1",
      isActive: true,
    }),
    existingAssetIds: async () => new Set<string>(),
    assetsOutsideDepartment: async () => kieso,
    createDraft: async (input: { assetIds?: readonly string[] }) => {
      hivasok.push(input);
      return "worksheet-1";
    },
  } as unknown as WorksheetsRepository;
  const service = new WorksheetsService(repository);
  return { service, hivasok };
}

/**
 * A FELVITEL ELINDITASA, A LETREHOZAS UTANI RESZ NELKUL.
 *
 * A `create` a vegen VISSZAOLVASSA a friss lapot (`detailAfterWrite`), es ahhoz
 * egy teljes reszletlap-sor kellene a hamis taroloban. Ez az allitas viszont
 * NEM arrol szol: azt meri, MI JUTOTT EL a taroloig. A visszaolvasas sajat
 * specekkel rendelkezik.
 *
 * A HIBAT ITT SZANDEKOSAN ELNYELJUK, es ez NEM "hatha atmegy": a kovetkezo sor
 * mindig egy KIMONDOTT allitas a `hivasok` tartalmarol. Ha a `createDraft` el
 * sem indulna, az az allitas bukna el -- nem ez a `catch`.
 */
async function felvitel(
  service: WorksheetsService,
  dto: CreateWorksheetDto,
): Promise<void> {
  try {
    await service.create(dto, "user-1");
  } catch {
    // a letrehozas UTANI visszaolvasas hianyzik a duplabol; lasd fent
  }
}

function input(assetIds?: string[]): CreateWorksheetDto {
  return {
    customerId: "vevo-1",
    departmentId: "unit-1",
    subject: "Szivattyú csere",
    lines: [],
    assetIds,
  } as unknown as CreateWorksheetDto;
}

describe("a munkalap eszközei és a helyszín", () => {
  it("idegen helyszín eszközénél EL SEM INDUL a létrehozás", async () => {
    const { service, hivasok } = serviceWith(["asset-idegen"]);

    await assert.rejects(
      () => service.create(input(["asset-idegen"]), "user-1"),
      (hiba: { status?: number; message?: string }) =>
        hiba.status === 400 && /nem ezen a helyszínen/.test(hiba.message ?? ""),
    );
    // EZ A LENYEG, NEM A 400: a tarolohoz el sem jutott a keres.
    assert.deepEqual(hivasok, []);
  });

  it("több kieső eszköznél a darabszámot is megnevezi", async () => {
    const { service } = serviceWith(["a", "b"]);

    await assert.rejects(
      () => service.create(input(["a", "b"]), "user-1"),
      (hiba: { message?: string }) =>
        /2 megadott eszköz/.test(hiba.message ?? ""),
    );
  });

  /**
   * A KONTROLL. Enelkul a fenti allitasok akkor is zoldek lennenek, ha a hamis
   * tarolo SOHA nem hivna -- vagyis ha a mero maga romlott el.
   */
  it("a helyszínen álló eszközök eljutnak a tárolóig", async () => {
    const { service, hivasok } = serviceWith([]);

    await felvitel(service, input(["asset-1", "asset-2"]));

    assert.equal(hivasok.length, 1);
    assert.deepEqual(hivasok[0]?.assetIds, ["asset-1", "asset-2"]);
  });

  /**
   * AZ ISMETLODES ITT ESIK KI, NEM AZ ADATBAZISBAN. A `@@unique` megfogna, de
   * HIBAVAL -- a felulet tobbszoros valasztast enged, es egy ketszer bekuldott
   * azonosito nem a felhasznalo hibaja.
   */
  it("az ismétlődő azonosító egyszer megy tovább", async () => {
    const { service, hivasok } = serviceWith([]);

    await felvitel(service, input(["asset-1", "asset-1"]));

    assert.deepEqual(hivasok[0]?.assetIds, ["asset-1"]);
  });

  it("eszköz nélkül üres listával megy tovább", async () => {
    const { service, hivasok } = serviceWith([]);

    await felvitel(service, input(undefined));

    assert.deepEqual(hivasok[0]?.assetIds, []);
  });
});
