import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { assetDocumentWhere } from "./asset-document-filter.js";
import { AssetListQueryDto } from "./dto/asset.dto.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";

/*
  VAN-E / NINCS-E CSATOLMÁNYA (kártya 1277394e; Feri, 2026-10-06 14:53: hány
  Astral Pool szivattyúnak nincs kézikönyve). MI PIROSÍT: ha a szűrő nem a
  kért fajtára kérdez; ha a „nincs” a „van” feltételét kapja; ha egy partner
  egy neki láthatatlan fajtáról (számla) megtudja, van-e; ha a lista tényleges
  feltételébe (`listWheres`, amit a lapozás, a szomszéd-gomb és az export is
  használ) nem kerül be.
*/
const internal = { kind: "internal" } as const;
const partner = { kind: "customer", customerId: "c-1" } as const;

describe("assetDocumentWhere", () => {
  it("no filter without `document`", () => {
    assert.deepEqual(assetDocumentWhere(undefined, "MANUAL", internal), {});
  });

  it("with and without a manual ask for exactly that type", () => {
    assert.deepEqual(assetDocumentWhere("with", "MANUAL", internal), {
      documents: { some: { type: { in: ["MANUAL"] } } },
    });
    assert.deepEqual(assetDocumentWhere("without", "MANUAL", internal), {
      documents: { none: { type: { in: ["MANUAL"] } } },
    });
  });

  it("without a type, any visible type counts", () => {
    assert.deepEqual(assetDocumentWhere("with", undefined, internal), {
      documents: {
        some: {
          type: { in: ["INVOICE", "WARRANTY", "MANUAL", "OTHER", "PHOTO"] },
        },
      },
    });
    assert.deepEqual(assetDocumentWhere("with", undefined, partner), {
      documents: { some: { type: { in: ["WARRANTY", "MANUAL", "PHOTO"] } } },
    });
  });

  it("a partner learns nothing about a type it cannot see", () => {
    assert.deepEqual(assetDocumentWhere("with", "INVOICE", partner), {
      documents: { some: { type: { in: [] } } },
    });
    assert.deepEqual(assetDocumentWhere("without", "INVOICE", partner), {
      documents: { none: { type: { in: [] } } },
    });
  });
});

describe("the asset list query", () => {
  const dto = (plain: Record<string, string>) =>
    plainToInstance(AssetListQueryDto, plain);

  it("accepts with/without and a known type, refuses anything else", async () => {
    assert.deepEqual(
      await validate(dto({ document: "without", documentType: "MANUAL" })),
      [],
    );
    assert.equal((await validate(dto({ document: "maybe" }))).length, 1);
    assert.equal((await validate(dto({ documentType: "RECEIPT" }))).length, 1);
  });

  /*
    A LISTA TÉNYLEGES FELTÉTELE, nem csak a segédfüggvény: a `listWheres`-t a
    lapozott lista, a szomszéd-gomb és az export is hívja. Ezekre a szűrőkre
    adatbázis nem kell (a részleg- és részfa-szűrő nincs megadva).
  */
  it("reaches the list's own where, for the caller's scope", async () => {
    const repository = new ServiceAssetsRepository();
    const listWheres = (
      repository as unknown as {
        listWheres(
          query: AssetListQueryDto,
          scope: typeof internal | typeof partner,
          assigned: readonly string[],
        ): Promise<{ list: unknown; counts: unknown }>;
      }
    ).listWheres.bind(repository);
    const query = dto({
      document: "without",
      documentType: "MANUAL",
      search: "Astral",
    });
    const { list, counts } = await listWheres(query, internal, []);
    const text = JSON.stringify(list);
    assert.match(
      text,
      /"documents":\{"none":\{"type":\{"in":\["MANUAL"\]\}\}\}/,
    );
    assert.match(JSON.stringify(counts), /"documents":\{"none"/);
    const asPartner = JSON.stringify(
      (
        await listWheres(
          dto({ document: "with", documentType: "INVOICE" }),
          partner,
          ["u-1"],
        )
      ).list,
    );
    assert.match(asPartner, /"documents":\{"some":\{"type":\{"in":\[\]\}\}\}/);
  });
});
