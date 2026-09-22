import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { ServiceJobDocumentsController } from "./service-job-documents.controller.js";
import type { ServiceJobDocumentsService } from "./service-job-documents.service.js";
import type { UploadServiceJobDocumentDto } from "./service-job-documents.dto.js";

/**
 * A HIBAJEGY DOKUMENTUM-FELTOLTESI UT HATARAI.
 *
 * === MIERT KELL (kartya 6f2eec9c) ===
 *
 * Merve 2026-09-22 a d09a906d fejen: ezt a vegpontot NULLA spec
 * peldanyositja. A `.uploadDocument(` nev-alapu szamolas EGY hivast ad ra,
 * de az a hivas egy MASIK controller peldanyan all -- harom controller visel
 * ilyen nevu metodust, tehat a nev-alapu fedes-terkep hamis FEDVE-t ad.
 *
 * === A MULTER EGGYEL TOBBET ENGED BE, MINT AMENNYIT ELFOGADUNK ===
 *
 * A dekorator `DOCUMENT_UPLOAD_LIMITS.files + 1` darabot fogad, SZANDEKOSAN:
 * a multer a sajat korlatjat a stream szintjen vagja el, es a hibajat semmi
 * nem alakitja at, tehat a hivo 500-at kapna egy 400 helyett. A controller
 * ezert maga utasitja el a tul sok fajlt -- es EZT eddig semmi nem orizte.
 *
 * A ket szam kozotti EGY fajlnyi res pontosan az, ami egy elgepelt
 * osszehasonlitasnal (`>` kontra `>=`) csendben eltunne: a hatar egy fajllal
 * elcsuszna, es a kimenet ugyanugy 400 maradna.
 *
 * Ezert all itt KET allitas a darabszamra, ellentetes iranyban:
 * a limitnel EGGYEL TOBB elbukik, es PONTOSAN a limit atmegy. Egy tavoli
 * helyes eset (mondjuk egy fajl) csak azt bizonyitana, hogy a kapu nem mindent
 * vag el; a LEGKOZELEBBI jogos bemenet azt, hogy a hatara jo helyen van.
 */
describe("a hibajegy dokumentum-feltoltes hatarai", () => {
  const fajl = (nev: string) =>
    ({ originalname: nev, buffer: Buffer.from(nev) }) as Express.Multer.File;

  const hasznalo = { id: "user-1" } as AuthenticatedUser;
  const ures = {} as UploadServiceJobDocumentDto;

  /** A dupla a VALODI szerzodes tipusat kapja a varraton. */
  function controllerrel(
    addDocument: ServiceJobDocumentsService["addDocument"],
  ) {
    return new ServiceJobDocumentsController({
      addDocument,
    } as unknown as ServiceJobDocumentsService);
  }

  const semmit = (async () =>
    ({}) as never) as ServiceJobDocumentsService["addDocument"];

  /** NULLA FAJL: `undefined` es az URES TOMB ugyanaz az egy orzo. */
  it("fajl nelkul elutasit, es nem er a szolgaltatashoz", async () => {
    for (const bemenet of [undefined, []]) {
      let hivva = false;
      const controller = controllerrel((async () => {
        hivva = true;
        return {} as never;
      }) as ServiceJobDocumentsService["addDocument"]);

      await assert.rejects(
        async () => controller.uploadDocument("job-1", ures, bemenet, hasznalo),
        (hiba: unknown) => {
          assert.ok(hiba instanceof BadRequestException);
          assert.match(String((hiba as Error).message), /fájl kötelező/);
          return true;
        },
      );
      assert.equal(
        hivva,
        false,
        `${JSON.stringify(bemenet)} mellett sem szabad irni`,
      );
    }
  });

  /** DARABSZAM, FELSO IRANY: a limitnel EGGYEL tobb elbukik. */
  it("a limitnel eggyel tobb fajlt elutasit, es nem ir egyet sem", async () => {
    let hivasok = 0;
    const controller = controllerrel((async () => {
      hivasok += 1;
      return {} as never;
    }) as ServiceJobDocumentsService["addDocument"]);

    const tulSok = Array.from(
      { length: DOCUMENT_UPLOAD_LIMITS.files + 1 },
      (_, i) => fajl(`f${i}.pdf`),
    );

    await assert.rejects(
      async () => controller.uploadDocument("job-1", ures, tulSok, hasznalo),
      (hiba: unknown) => {
        assert.ok(hiba instanceof BadRequestException);
        assert.match(String((hiba as Error).message), /legfeljebb/);
        return true;
      },
    );
    assert.equal(hivasok, 0, "elutasitaskor egyetlen fajl sem mehet be");
  });

  /** DARABSZAM, ALSO IRANY: PONTOSAN a limit a legkozelebbi JOGOS bemenet. */
  it("pontosan a limitnyi fajlt atengedi, es mindet leirja", async () => {
    const irt: string[] = [];
    const controller = controllerrel((async (
      _id: string,
      _type: "PHOTO" | "OTHER",
      file: Express.Multer.File,
    ) => {
      irt.push(file.originalname);
      return {} as never;
    }) as ServiceJobDocumentsService["addDocument"]);

    const eppAnnyi = Array.from(
      { length: DOCUMENT_UPLOAD_LIMITS.files },
      (_, i) => fajl(`f${i}.pdf`),
    );

    const eredmeny = await controller.uploadDocument(
      "job-1",
      ures,
      eppAnnyi,
      hasznalo,
    );

    assert.equal(irt.length, DOCUMENT_UPLOAD_LIMITS.files);
    assert.equal((eredmeny as unknown[]).length, DOCUMENT_UPLOAD_LIMITS.files);
  });

  /** SORREND: EGYESEVEL, nem parhuzamosan -- a keret-ellenorzes emiatt helyes. */
  it("egyesevel irja a fajlokat, nem parhuzamosan", async () => {
    let egyszerre = 0;
    let legtobbEgyszerre = 0;
    const controller = controllerrel((async () => {
      egyszerre += 1;
      legtobbEgyszerre = Math.max(legtobbEgyszerre, egyszerre);
      await new Promise((kesz) => setImmediate(kesz));
      egyszerre -= 1;
      return {} as never;
    }) as ServiceJobDocumentsService["addDocument"]);

    await controller.uploadDocument(
      "job-1",
      ures,
      [fajl("a.pdf"), fajl("b.pdf"), fajl("c.pdf")],
      hasznalo,
    );

    assert.equal(legtobbEgyszerre, 1, "parhuzamos iras a keretet felulmerne");
  });

  /** A VALASZ ALAKJA: MINDIG lista, EGY fajlnal is. */
  it("egyetlen fajlra is listat ad vissza", async () => {
    const controller = controllerrel(semmit);

    const eredmeny = await controller.uploadDocument(
      "job-1",
      ures,
      [fajl("egy.pdf")],
      hasznalo,
    );

    assert.ok(
      Array.isArray(eredmeny),
      "a valasz tipusa nem fugghet a bemenettol",
    );
    assert.equal((eredmeny as unknown[]).length, 1);
  });

  /**
   * A KOZOS MERET-HATAR, VISELKEDESBOL -- nem a forras szovegebol.
   *
   * A `FilesInterceptor` egy mixin osztalyt ad vissza; peldanyositva a
   * `multer` beallitasa OLVASHATO, tehat a hatar nem "ott all a kodban",
   * hanem TENYLEG ez megy a multerbe. Merve 2026-09-22 mind az ot feltoltesi
   * vegponton: a harom dokumentum-uton 10 MB, a unas-importon es az
   * inventoryn 25 MB plusz `files: 1` (azok sajat kerete).
   */
  it("a multerbe a KOZOS meret-hatar megy", async () => {
    const interceptorok = Reflect.getMetadata(
      "__interceptors__",
      ServiceJobDocumentsController.prototype.uploadDocument,
    ) as (new () => { multer?: { limits?: { fileSize?: number } } })[];

    assert.equal(
      interceptorok.length,
      1,
      "egy feltoltesi interceptor all rajta",
    );
    const Interceptor = interceptorok[0];
    assert.ok(Interceptor, "az interceptor-osztaly megvan");
    const limits = new Interceptor().multer?.limits;

    assert.equal(limits?.fileSize, DOCUMENT_UPLOAD_LIMITS.fileSizeBytes);
  });

  /**
   * ES A DARABSZAM KULON ALLITAS, MERT MAS TENY (acrobot kikotese, msg 21738).
   *
   *   a meret-hatar   azt mondja meg, MEKKORA fajlt fogadunk el
   *   a `+ 1`         azt, hogy EGGYEL TOBBET OLVASUNK BE, hogy a hivo sajat
   *                   400-as hibauzenetet kapjon a multer 500-asa helyett
   *
   * Ha egy allitas mind a kettore pirosodna, nem tudnank, melyik romlott el.
   *
   * ES AMIERT EZ FORRAS-OLVASO, A MASIK PEDIG NEM: a `FilesInterceptor`
   * MASODIK argumentuma (a maxCount) a mixin closure-jeben marad -- a
   * peldanyon nem latszik, csak a `limits`. Merve 2026-09-22: a peldany
   * sajat mezoje egyedul a `multer`, es abban `storage`, `limits`,
   * `preservePath`, `defParamCharset`, `fileFilter` all. Tehat ezt a tenyt
   * MA csak a forrasbol lehet allitani, es ezt ki is mondom.
   */
  it("a multer EGGYEL tobbet olvas be, mint amennyit elfogadunk", () => {
    // A SPEC A `test-dist`-BOL FUT, tehat az `import.meta.url` a LEFORDITOTT
    // mappara mutat. A forrast a repo sajat alakjaval erjuk el (ugyanugy, mint
    // a `document-upload-limits.spec.ts`): az api gyokeret szamoljuk vissza.
    const API = join(new URL("../../", import.meta.url).pathname, "src");
    const forras = readFileSync(
      join(API, "service-jobs", "service-job-documents.controller.ts"),
      "utf8",
    );

    assert.match(
      forras,
      /FilesInterceptor\("file", DOCUMENT_UPLOAD_LIMITS\.files \+ 1,/,
    );
  });

  /** JOGOSULTSAG: a jegy kezelese, nem kulon dokumentum-jog. */
  it("a feltoltes a szerviz-kezelesi jogot koveteli meg", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ServiceJobDocumentsController.prototype.uploadDocument,
      ),
      [PERMISSIONS.SERVICE_MANAGE],
    );
  });
});
