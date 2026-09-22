import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import type { ServiceAssetsService } from "./service-assets.service.js";
import type { UploadAssetDocumentDto } from "./dto/asset.dto.js";

/**
 * AZ ESZKOZ DOKUMENTUM-FELTOLTESI UT HATARAI.
 *
 * === EZ A HARMADIK UT, ES A HELYZETE MAS, MINT A MASIK KETTOE ===
 *
 * A munkalap- es a hibajegy-utnal a `partner-scope-endpoint.integration.spec.ts`
 * nev-alapu fedes-terkepe hamis FEDVE-t adott: harom controller visel
 * `uploadDocument` nevu metodust, es a nyolc hivas MIND az eszkoz-oldalin allt.
 *
 * ITT tehat a nyolc hivas VALOBAN ezt a controllert jarja, valodi Prismaval
 * (`const assets = new ServiceAssetsController(...)`). Ez a spec NEM azert
 * keszult, mert az ut fedetlen -- hanem mert a nyolc hivas MAST mer.
 *
 * === MIT MER A MEGLEVO NYOLC, ES MIT NEM (merve 2026-09-22, aba3becb) ===
 *
 * Mind a nyolc PONTOSAN EGY fajlt ad at, es az egesz spec nulla helyen emliti
 * a `DOCUMENT_UPLOAD_LIMITS`-et, a multer hatarait es a jogosultsag-metaadatot:
 *
 *     ures fajl-lista                  0 hivas
 *     multer / fileSize / Interceptor  0 talalat
 *     DOCUMENT_UPLOAD_LIMITS           0 talalat
 *     jogosultsag-metaadat             0 talalat
 *     egy fajlt atado hivas            8 / 8
 *
 * Egy fajllal a DARABSZAM-orzo, a SORREND (egyesevel kontra parhuzamosan) es a
 * KOZOS MERET-HATAR szerkezetileg nem tud elbukni: a ciklus egyszer fut le, es a
 * hatarok soha nem kerulnek szoba. Az alabbi kilencbol HET ilyen.
 *
 * === ES KETTO SZANDEKOSAN FED EGY MEGLEVO ALLITAST ===
 *
 * A "mindig lista" (a 912. sor `feltoltve.length` allitasa) es a HATOKOR-atadas
 * (a 988. sor idegen-vevo esete) viselkedes-szinten MAR fedve van, valodi
 * adatbazison -- ami erosebb bizonyitek, mint egy duplan mert argumentum.
 * Megis itt maradnak, es nem a PIROS miatt, hanem a DIAGNOZIS miatt:
 *
 *     a meglevo (integracios)   "expected NotFoundException" -- tunet, es a
 *                               SZOLGALTATAS tulajdonos-ellenorzese fele mutat
 *     az itteni (egyseg)        "az otodik argumentum a nyers felhasznalo" --
 *                               megnevezi a controller sorat
 *
 * Egy orzo erteke nem csak az, hogy szol, hanem az is, MIT MOND, amikor szol.
 * A ketto egyutt jar: ha egyszer a viselkedes-szintu par megszunik, ez marad.
 *
 * === ES EGY HARMADIK ALLITAS MAS SZINTEN VEDETT, MINT HITTEM ===
 *
 * A "mindig lista" szerzodest NEM ez az allitas tartja: a TIPUS tartja, es egy
 * MEGLEVO fogyaszto rogziti. A scope-spec a visszakapott soron `.id` mezot olvas,
 * tehat barmilyen rontas, ami egyetlen fajlnal objektumot adna vissza, EL SEM
 * FORDUL (TS2339, negy helyen, a scope-specben). Merve: a kezenfekvo rontas
 * `exit 2`-vel allt meg, `# tests` osszegzes nelkul, es csak egy dupla cast
 * (`as unknown as never`) jutott el a futtatoig.
 *
 * Ez az allitas tehat BIZTOSITEK, nem az elso vedvonal, es ezt tudni kell:
 * aki kalibralni probalja, forditasi hibaba fog futni, es azt hiszi majd, hogy
 * rosszul irta a rontast.
 *
 * A SORREND (egyesevel kontra parhuzamosan) VISZONT NEM tipus-vedett. Az `await`
 * elhagyasa ugyanugy nem fordul le, DE a `Promise.all` alak igen -- es az
 * pontosan ezt az egy allitast dontotte pirosra. Vagyis a ket tulajdonsag
 * kivulrol egyformanak latszik, es MAS szinten all.
 */
describe("az eszkoz dokumentum-feltoltes hatarai", () => {
  const fajl = (nev: string) =>
    ({ originalname: nev, buffer: Buffer.from(nev) }) as Express.Multer.File;

  const hasznalo = {
    id: "user-1",
    customerId: null,
    supplierId: null,
  } as unknown as AuthenticatedUser;
  const ures = {} as UploadAssetDocumentDto;

  function controllerrel(addDocument: ServiceAssetsService["addDocument"]) {
    return new ServiceAssetsController({
      addDocument,
    } as unknown as ServiceAssetsService);
  }

  /** NULLA FAJL: `undefined` es az URES TOMB ugyanaz az egy orzo. */
  it("fajl nelkul elutasit, es nem er a szolgaltatashoz", async () => {
    for (const bemenet of [undefined, []]) {
      let hivva = false;
      const controller = controllerrel((async () => {
        hivva = true;
        return {} as never;
      }) as ServiceAssetsService["addDocument"]);

      await assert.rejects(
        async () =>
          controller.uploadDocument("eszkoz-1", ures, bemenet, hasznalo),
        (hiba: unknown) => {
          assert.ok(hiba instanceof BadRequestException);
          assert.match(String((hiba as Error).message), /fájl kötelező/);
          return true;
        },
      );
      assert.equal(hivva, false);
    }
  });

  /** DARABSZAM, FELSO IRANY. */
  it("a limitnel eggyel tobb fajlt elutasit, es nem ir egyet sem", async () => {
    let hivasok = 0;
    const controller = controllerrel((async () => {
      hivasok += 1;
      return {} as never;
    }) as ServiceAssetsService["addDocument"]);

    const tulSok = Array.from(
      { length: DOCUMENT_UPLOAD_LIMITS.files + 1 },
      (_, i) => fajl(`f${i}.pdf`),
    );

    await assert.rejects(
      async () => controller.uploadDocument("eszkoz-1", ures, tulSok, hasznalo),
      (hiba: unknown) => {
        assert.ok(hiba instanceof BadRequestException);
        assert.match(String((hiba as Error).message), /legfeljebb/);
        return true;
      },
    );
    assert.equal(hivasok, 0);
  });

  /** DARABSZAM, ALSO IRANY: a LEGKOZELEBBI jogos bemenet. */
  it("pontosan a limitnyi fajlt atengedi, es mindet leirja", async () => {
    const irt: string[] = [];
    const controller = controllerrel((async (...args: unknown[]) => {
      irt.push((args[2] as Express.Multer.File).originalname);
      return {} as never;
    }) as unknown as ServiceAssetsService["addDocument"]);

    const eppAnnyi = Array.from(
      { length: DOCUMENT_UPLOAD_LIMITS.files },
      (_, i) => fajl(`f${i}.pdf`),
    );

    const eredmeny = await controller.uploadDocument(
      "eszkoz-1",
      ures,
      eppAnnyi,
      hasznalo,
    );

    assert.equal(irt.length, DOCUMENT_UPLOAD_LIMITS.files);
    assert.equal((eredmeny as unknown[]).length, DOCUMENT_UPLOAD_LIMITS.files);
  });

  /** SORREND: egyesevel, nem parhuzamosan. */
  it("egyesevel irja a fajlokat, nem parhuzamosan", async () => {
    let egyszerre = 0;
    let legtobbEgyszerre = 0;
    const controller = controllerrel((async () => {
      egyszerre += 1;
      legtobbEgyszerre = Math.max(legtobbEgyszerre, egyszerre);
      await new Promise((kesz) => setImmediate(kesz));
      egyszerre -= 1;
      return {} as never;
    }) as ServiceAssetsService["addDocument"]);

    await controller.uploadDocument(
      "eszkoz-1",
      ures,
      [fajl("a.pdf"), fajl("b.pdf"), fajl("c.pdf")],
      hasznalo,
    );

    assert.equal(legtobbEgyszerre, 1);
  });

  /** A VALASZ ALAKJA: MINDIG lista. FED egy meglevo integracios allitast. */
  it("egyetlen fajlra is listat ad vissza", async () => {
    const controller = controllerrel(
      (async () => ({}) as never) as ServiceAssetsService["addDocument"],
    );

    const eredmeny = await controller.uploadDocument(
      "eszkoz-1",
      ures,
      [fajl("egy.pdf")],
      hasznalo,
    );

    assert.ok(Array.isArray(eredmeny));
    assert.equal((eredmeny as unknown[]).length, 1);
  });

  /** A HATOKOR ATMEGY. FED egy meglevo integracios allitast -- lasd a fejlecet. */
  it("az aktor azonositojat ES a hatokorét adja at, kulon", async () => {
    let kapott: unknown[] = [];
    const controller = controllerrel((async (...args: unknown[]) => {
      kapott = args;
      return {} as never;
    }) as unknown as ServiceAssetsService["addDocument"]);

    await controller.uploadDocument(
      "eszkoz-1",
      ures,
      [fajl("egy.pdf")],
      hasznalo,
    );

    assert.equal(
      kapott[3],
      "user-1",
      "a negyedik argumentum az aktor azonositoja",
    );
    assert.ok(
      kapott[4] && typeof kapott[4] === "object",
      "az otodik a hatokor-objektum, nem a nyers felhasznalo",
    );
    assert.equal(
      (kapott[4] as { id?: string }).id,
      undefined,
      "a hatokor NEM a felhasznalo objektuma",
    );
  });

  /** A KOZOS MERET-HATAR, VISELKEDESBOL. */
  it("a multerbe a KOZOS meret-hatar megy", () => {
    const interceptorok = Reflect.getMetadata(
      "__interceptors__",
      ServiceAssetsController.prototype.uploadDocument,
    ) as (new () => { multer?: { limits?: { fileSize?: number } } })[];

    assert.equal(interceptorok.length, 1);
    const Interceptor = interceptorok[0];
    assert.ok(Interceptor);
    assert.equal(
      new Interceptor().multer?.limits?.fileSize,
      DOCUMENT_UPLOAD_LIMITS.fileSizeBytes,
    );
  });

  /** ES A DARABSZAM KULON: a `maxCount` a mixin closure-jeben marad. */
  it("a multer EGGYEL tobbet olvas be, mint amennyit elfogadunk", () => {
    const API = join(new URL("../../", import.meta.url).pathname, "src");
    const forras = readFileSync(
      join(API, "service-assets", "service-assets.controller.ts"),
      "utf8",
    );

    assert.match(
      forras,
      /FilesInterceptor\("file", DOCUMENT_UPLOAD_LIMITS\.files \+ 1,/,
    );
  });

  /** JOGOSULTSAG. */
  it("a feltoltes a szerviz-kezelesi jogot koveteli meg", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ServiceAssetsController.prototype.uploadDocument,
      ),
      [PERMISSIONS.SERVICE_MANAGE],
    );
  });
});
