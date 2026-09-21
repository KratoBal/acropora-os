import assert from "node:assert/strict";
import { describe, it } from "node:test";

const BELSOS_KERO = {
  id: "user-1",
  customerId: null,
  supplierId: null,
} as never;

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

/**
 * === ES A FELVITEL UTAN: A LAP ESZKOZEINEK BEALLITASA ===
 *
 * Balazs kerese (2026-09-16): "munkalapnal is jo lenne ha lehetne a helyszinhez
 * rogzitett eszkozoket csatolni". A felvitelen mar ment; egy MEGLEVO lapon nem
 * volt ut ra.
 *
 * A HELYSZINT A LAP ADJA, NEM A KERES: a lape a felvitelkor eldolt, es nincs
 * ut, ami megvaltoztatna. Ez elter a hibajegytol, ahol a helyszin ES az
 * eszkozok EGY muveletben mozognak -- epp azert, mert ott a helyszin valtozhat.
 */
function beallitoServiceWith(kieso: string[], lapHelyszine = "unit-1") {
  const hivasok: { worksheetId: string; assetIds: readonly string[] }[] = [];
  const kerdezettHelyszinek: string[] = [];
  const repository = {
    detail: async () => ({
      id: "worksheet-1",
      departmentId: lapHelyszine,
      versions: [{ status: "DRAFT" }],
    }),
    assetsOutsideDepartment: async (
      _assetIds: readonly string[],
      departmentId: string,
    ) => {
      kerdezettHelyszinek.push(departmentId);
      return kieso;
    },
    setAssets: async (input: {
      worksheetId: string;
      assetIds: readonly string[];
    }) => {
      hivasok.push(input);
      return true;
    },
  } as unknown as WorksheetsRepository;
  const service = new WorksheetsService(repository);
  return { service, hivasok, kerdezettHelyszinek };
}

/**
 * A BEALLITAS ELINDITASA, A VISSZAOLVASAS NELKUL -- ugyanaz az alak, mint a
 * `felvitel` fent, es ugyanazzal a kikotessel: a `catch` NEM "hatha atmegy",
 * mert a kovetkezo sor mindig egy KIMONDOTT allitas a `hivasok` tartalmarol.
 */
async function beallitas(
  service: WorksheetsService,
  assetIds: string[],
): Promise<void> {
  try {
    await service.setAssets("worksheet-1", { assetIds }, BELSOS_KERO);
  } catch {
    // a visszaolvasashoz teljes reszletlap-sor kellene; lasd a `felvitel`-t
  }
}

describe("a meglévő munkalap eszközei", () => {
  it("a LAP saját helyszínére ellenőriz, nem a kérésből vett értékre", async () => {
    const { service, kerdezettHelyszinek } = beallitoServiceWith(
      [],
      "unit-lape",
    );

    await beallitas(service, ["asset-1"]);

    // EZ A LENYEG: a hivo NEM tud masik helyszint megadni -- a mezo nincs is a
    // DTO-ban --, es a szerver a lap sajatjat kerdezi.
    assert.deepEqual(kerdezettHelyszinek, ["unit-lape"]);
  });

  it("idegen helyszín eszközénél EL SEM INDUL az írás", async () => {
    const { service, hivasok } = beallitoServiceWith(["asset-idegen"]);

    await assert.rejects(
      () =>
        service.setAssets(
          "worksheet-1",
          { assetIds: ["asset-idegen"] },
          BELSOS_KERO,
        ),
      (hiba: { status?: number; message?: string }) =>
        hiba.status === 400 && /nem ezen a helyszínen/.test(hiba.message ?? ""),
    );
    // Nem a 400 a lenyeg: a tarolohoz el sem jutott a keres.
    assert.deepEqual(hivasok, []);
  });

  /**
   * A KONTROLL. Enelkul a fenti tagadas akkor is zold lenne, ha a hamis tarolo
   * SOHA nem hivna -- vagyis ha a mero maga romlott el.
   */
  it("a helyszínen álló eszközök eljutnak a tárolóig", async () => {
    const { service, hivasok } = beallitoServiceWith([]);

    await beallitas(service, ["asset-1", "asset-2"]);

    assert.equal(hivasok.length, 1);
    assert.deepEqual(hivasok[0]?.assetIds, ["asset-1", "asset-2"]);
  });

  /**
   * URES LISTA SZABAD: az a "mindet leveszem" szandek, nem elgepeles -- es a
   * DTO mezoje epp ezert kotelezo.
   *
   * ES EZ EGYBEN ISMERT POZITIV KONTROLL a fenti elutasitashoz: enelkul az az
   * allitas akkor is zold lenne, ha a vegpont MINDEN listat elutasitana.
   */
  it("üres listával is lemegy, és mindent levesz", async () => {
    const { service, hivasok } = beallitoServiceWith([]);

    await beallitas(service, []);

    assert.equal(hivasok.length, 1);
    assert.deepEqual(hivasok[0]?.assetIds, []);
  });

  it("az ismétlődő azonosító egyszer megy tovább", async () => {
    const { service, hivasok } = beallitoServiceWith([]);

    await beallitas(service, ["asset-1", "asset-1"]);

    assert.deepEqual(hivasok[0]?.assetIds, ["asset-1"]);
  });
});
