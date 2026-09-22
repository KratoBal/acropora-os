import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AssetCategoriesService } from "./asset-categories.service.js";
import {
  AssetCategoriesRepository,
  AssetCategoryDuplicateError,
} from "./asset-categories.repository.js";

/**
 * A KATEGORIA-TORZSADAT KET SZABALYA, amit a taroloban NEM lehet merni (az a
 * `prisma` peldanyt hasznalja kozvetlenul).
 *
 * A VARRAT A VALODI SZERZODES TIPUSAT KAPJA: ha barmelyik tarolo-metodus
 * szignaturaja elmozdul, a fordito szoljon, ne a felhasznalo.
 */

type Hivas = { id: string };

function keszit(be?: { duplikatum?: boolean; letezik?: boolean }) {
  const kivezetettek: Hivas[] = [];
  const repository: Pick<
    AssetCategoriesRepository,
    "list" | "create" | "update" | "retire"
  > = {
    list: async () => [],
    create: async (input) => {
      if (be?.duplikatum) throw new AssetCategoryDuplicateError();
      return { id: "cat-1", isActive: true, ...input };
    },
    update: async () => null,
    retire: async (id) => {
      kivezetettek.push({ id });
      return be?.letezik ?? true;
    },
  };
  return {
    service: new AssetCategoriesService(
      repository as AssetCategoriesRepository,
    ),
    kivezetettek,
  };
}

describe("a kategória-törzsadat", () => {
  /**
   * C1: A NEV KORULVAGVA MEGY EL.
   *
   * MI PIROSIT: ha a nyers ertek megy. Akkor a „ Vízkezelés" es a
   * „Vízkezelés" KET kulonbozo sor lenne -- pontosan az, ami miatt ez a tabla
   * letrejott.
   */
  it("C1: a nevet körülvágja mentés előtt", async () => {
    const { service } = keszit();

    const created = await service.create({ name: "  Vízkezelés  " });

    assert.equal(created?.name, "Vízkezelés");
  });

  /**
   * C2: A DUPLIKATUM 400, ES A MONDAT A KIVEZETETTEK FELE MUTAT.
   *
   * MI PIROSIT: ha a nyers adatbazis-hiba szall fel. Akkor a felhasznalo egy
   * `P2002` kodot latna, es nem tudna, hogy a nev MAR SZEREPEL -- esetleg a
   * kivezetettek kozott, ahonnan vissza lehet hozni.
   */
  it("C2: a duplikátum 400, és megnevezi a kivezetetteket", async () => {
    const { service } = keszit({ duplikatum: true });

    await assert.rejects(
      () => service.create({ name: "Vízkezelés" }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /kivezetettek/i.test(error.message),
    );
  });

  /**
   * C3: A `DELETE` KIVEZET, NEM TOROL -- ES A VALASZ EZT KIMONDJA.
   *
   * MI PIROSIT: ha a valasz `{ ok: true }` lenne. Az azt sugallna, hogy a sor
   * eltunt -- holott eszkozok hivatkoznak ra, es a nev a mar felvitt eszkozok
   * mellett olvashato marad.
   */
  it("C3: a törlés kivezetés, és a válasz ezt mondja", async () => {
    const { service, kivezetettek } = keszit();

    const valasz = await service.retire("cat-1");

    assert.deepEqual(valasz, { retired: true });
    assert.deepEqual(kivezetettek, [{ id: "cat-1" }]);
  });

  /**
   * C4: KONTROLL -- a nem letezo sor 404.
   *
   * E nelkul a C3 zold maradna egy olyan megvalositason is, ami MINDIG
   * `{ retired: true }`-t ad, akkor is, ha semmit nem talalt.
   */
  it("C4: KONTROLL: a nem létező kategória 404", async () => {
    const { service } = keszit({ letezik: false });

    await assert.rejects(() => service.retire("nincs"), NotFoundException);
  });
});
