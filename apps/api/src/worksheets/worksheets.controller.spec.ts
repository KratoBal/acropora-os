import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { WorksheetsController } from "./worksheets.controller.js";
import type { WorksheetsService } from "./worksheets.service.js";
import type { UploadWorksheetDocumentDto } from "./dto/worksheet.dto.js";

/**
 * A MUNKALAP DOKUMENTUM-FELTOLTESI UT HATARAI.
 *
 * === MIERT KELL (kartya 6f2eec9c) ===
 *
 * Merve 2026-09-22 a d09a906d fejen: ezt a vegpontot NULLA spec hivja. A
 * `partner-scope-endpoint.integration.spec.ts` PELDANYOSITJA ugyan a
 * controllert, de a nyolc `.uploadDocument(` hivasa MIND az eszkoz-oldali
 * peldanyon all -- harom controller visel ilyen nevu metodust, tehat a
 * nev-alapu fedes-terkep itt hamis FEDVE-t ad.
 *
 * === ES EGY TULAJDONSAG, AMI A TESTVER-UTON NINCS ===
 *
 * A hibajegy utja a teljes `user`-t adja at; ez az ut `user.id`-t ES
 * `partnerScopeOf(user)`-t. A HATOKOR tehat itt a controller torzsen megy
 * keresztul, es sajat allitast kap -- kulonben egy elcsuszott hatokor
 * csendben mas lapot erne el.
 */
describe("a munkalap dokumentum-feltoltes hatarai", () => {
  const fajl = (nev: string) =>
    ({ originalname: nev, buffer: Buffer.from(nev) }) as Express.Multer.File;

  const hasznalo = {
    id: "user-1",
    partnerId: null,
  } as unknown as AuthenticatedUser;
  const ures = {} as UploadWorksheetDocumentDto;

  function controllerrel(addDocument: WorksheetsService["addDocument"]) {
    return new WorksheetsController({
      addDocument,
    } as unknown as WorksheetsService);
  }

  /** NULLA FAJL: `undefined` es az URES TOMB ugyanaz az egy orzo. */
  it("fajl nelkul elutasit, es nem er a szolgaltatashoz", async () => {
    for (const bemenet of [undefined, []]) {
      let hivva = false;
      const controller = controllerrel((async () => {
        hivva = true;
        return {} as never;
      }) as WorksheetsService["addDocument"]);

      await assert.rejects(
        async () => controller.uploadDocument("lap-1", ures, bemenet, hasznalo),
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
    }) as WorksheetsService["addDocument"]);

    const tulSok = Array.from(
      { length: DOCUMENT_UPLOAD_LIMITS.files + 1 },
      (_, i) => fajl(`f${i}.pdf`),
    );

    await assert.rejects(
      async () => controller.uploadDocument("lap-1", ures, tulSok, hasznalo),
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
    const controller = controllerrel((async (
      _id: string,
      _type: "PHOTO" | "OTHER",
      file: Express.Multer.File,
    ) => {
      irt.push(file.originalname);
      return {} as never;
    }) as WorksheetsService["addDocument"]);

    const eppAnnyi = Array.from(
      { length: DOCUMENT_UPLOAD_LIMITS.files },
      (_, i) => fajl(`f${i}.pdf`),
    );

    const eredmeny = await controller.uploadDocument(
      "lap-1",
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
    }) as WorksheetsService["addDocument"]);

    await controller.uploadDocument(
      "lap-1",
      ures,
      [fajl("a.pdf"), fajl("b.pdf"), fajl("c.pdf")],
      hasznalo,
    );

    assert.equal(legtobbEgyszerre, 1);
  });

  /** A VALASZ ALAKJA: MINDIG lista. */
  it("egyetlen fajlra is listat ad vissza", async () => {
    const controller = controllerrel(
      (async () => ({}) as never) as WorksheetsService["addDocument"],
    );

    const eredmeny = await controller.uploadDocument(
      "lap-1",
      ures,
      [fajl("egy.pdf")],
      hasznalo,
    );

    assert.ok(Array.isArray(eredmeny));
    assert.equal((eredmeny as unknown[]).length, 1);
  });

  /**
   * A HATOKOR ATMEGY, ES EZ A TESTVER-UTON NINCS.
   *
   * A hibajegy utja a teljes `user`-t adja at, ez `user.id`-t ES a belole
   * kepzett hatokort. Ha a hatokor elcsuszna, a lap-lekerdezes MAS lapot
   * erne el -- es a feltoltes attol meg sikeresnek latszana.
   */
  it("az aktor azonositojat ES a hatokorét adja at, kulon", async () => {
    let kapott: unknown[] = [];
    const controller = controllerrel((async (...args: unknown[]) => {
      kapott = args;
      return {} as never;
    }) as unknown as WorksheetsService["addDocument"]);

    await controller.uploadDocument("lap-1", ures, [fajl("egy.pdf")], hasznalo);

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
      WorksheetsController.prototype.uploadDocument,
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
      join(API, "worksheets", "worksheets.controller.ts"),
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
        WorksheetsController.prototype.uploadDocument,
      ),
      [PERMISSIONS.SERVICE_MANAGE],
    );
  });
});
