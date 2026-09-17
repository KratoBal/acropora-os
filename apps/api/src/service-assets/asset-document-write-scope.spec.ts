import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * AZ ESZKÖZ-CSATOLMÁNYOK HÁROM ÍRÓ ÚTJA A HÍVÓ HATÓKÖRÉVEL MEGY.
 *
 * === MI VOLT ELŐTTE, ÉS MIÉRT NEM SZÓLT SEMMI ===
 *
 * Mind a három út `{ kind: "internal" }` hatókörrel dolgozott, arra hivatkozva,
 * hogy a `SERVICE_MANAGE` jogot partner-oldali fiók nem kapja meg. MEGKAPJA:
 * `PARTNER_SERVICE: [SERVICE_VIEW, SERVICE_MANAGE]`. A hivatkozás egy MÁSIK
 * jogra igaz (`SERVICE_ASSET_DELETE`), és oda is került át egy igaz mondat.
 *
 * A `partner-scope-usage.spec.ts` ezt nem láthatta: az azt méri, hogy amelyik
 * metódus hatókört VESZ ÁT, az használja is. A `deleteDocument` sosem vett át,
 * tehát a látóterén kívül állt.
 *
 * === MIT MÉR EZ A FÁJL, ÉS MIT NEM ===
 *
 * Itt hamis tároló van, tehát a SZŰRÉS nem mérhető -- azt valódi sorokon a
 * `partner-scope-endpoint.integration.spec.ts` méri, a CI adatbázisán. Amit
 * ITT lehet: hogy a hívó hatóköre egyáltalán ELJUT a szűrésig, mind a három
 * úton. Ez az a hely, ahol a hiba keletkezett.
 */

const ASSET = "asset-1";
const VEVO: PartnerScope = { kind: "customer", customerId: "customer-1" };
const BELSOS: PartnerScope = { kind: "internal" };

const PDF = Buffer.concat([Buffer.from("%PDF-"), Buffer.from([1, 2, 3])]);

function upload(): Express.Multer.File {
  return {
    mimetype: "application/pdf",
    originalname: "szamla.pdf",
    buffer: PDF,
  } as unknown as Express.Multer.File;
}

/** Elteszi, MILYEN hatókörrel hívták a tároló egyes metódusait. */
function szolgaltatas(options: { lathatoE?: boolean } = {}) {
  const kapott: {
    detail: PartnerScope[];
    setCaption: PartnerScope[];
    torles: PartnerScope[];
    feltoltve: number;
  } = { detail: [], setCaption: [], torles: [], feltoltve: 0 };

  const repository = {
    detail: async (id: string, scope: PartnerScope) => {
      kapott.detail.push(scope);
      // A NEM LATHATO ESZKOZ `null`, pontosan ugy, ahogy a valodi tarolo adja:
      // a szolgaltatas ebbol csinal 404-et.
      return options.lathatoE === false ? null : { id };
    },
    documentBytesInUse: async () => 0,
    addDocument: async () => {
      kapott.feltoltve += 1;
      return { id: "doc-1" };
    },
    setDocumentCaption: async (
      _assetId: string,
      _documentId: string,
      _caption: string | null,
      scope: PartnerScope,
    ) => {
      kapott.setCaption.push(scope);
      return 1;
    },
    deleteDocument: async (
      _assetId: string,
      _documentId: string,
      _actorUserId: string,
      scope: PartnerScope,
    ) => {
      kapott.torles.push(scope);
      return true;
    },
  } as unknown as ServiceAssetsRepository;

  return {
    kapott,
    service: new ServiceAssetsService(repository, new InMemoryDocumentStore()),
  };
}

describe("az eszköz-csatolmányok írása a hívó hatókörével megy", () => {
  it("a feltöltés a hívó hatókörét adja tovább, nem belsőst", async () => {
    const { service, kapott } = szolgaltatas();
    await service.addDocument(ASSET, "INVOICE", upload(), "user-1", VEVO);

    assert.deepEqual(kapott.detail, [VEVO]);
  });

  it("a felirat átírása a hívó hatókörét adja tovább, mindkét lépésnek", async () => {
    const { service, kapott } = szolgaltatas();
    await service.setDocumentCaption(ASSET, "doc-1", "Szivattyú", VEVO);

    // AZ ESZKOZ-ELLENORZES...
    assert.deepEqual(kapott.detail, [VEVO]);
    // ...ES A SOR IRASA IS. Eleg lenne az egyik atvezetese ahhoz, hogy a hiba
    // "javitottnak" lassek, es a masik agon tovabb alljon.
    assert.deepEqual(kapott.setCaption, [VEVO]);
  });

  it("a törlés a hívó hatókörét adja tovább a tárolónak", async () => {
    const { service, kapott } = szolgaltatas();
    await service.deleteDocument(ASSET, "doc-1", "user-1", VEVO);

    assert.deepEqual(kapott.torles, [VEVO]);
  });

  /**
   * ISMERT POZITÍV KONTROLL: belsős hívóval mind a három VÉGIGMEGY.
   *
   * Enélkül a fenti három állítás egy olyan szolgáltatástól is zöld lenne, ami
   * minden bemenetre hibát dob -- és akkor a szerviz-kollégák sem tudnának
   * csatolmányt feltölteni.
   */
  it("belsős hívóval mind a három út végigmegy", async () => {
    const { service, kapott } = szolgaltatas();
    await service.addDocument(ASSET, "INVOICE", upload(), "user-1", BELSOS);
    await service.setDocumentCaption(ASSET, "doc-1", "Szivattyú", BELSOS);
    await service.deleteDocument(ASSET, "doc-1", "user-1", BELSOS);

    assert.equal(kapott.feltoltve, 1);
    assert.deepEqual(kapott.setCaption, [BELSOS]);
    assert.deepEqual(kapott.torles, [BELSOS]);
  });

  /**
   * A NEM LÁTHATÓ ESZKÖZRE NEM ÍRUNK, ÉS NEM IS "SIKERÜL".
   *
   * A feltöltés és a felirat a `detail`-en áll meg, tehát a tároló íráshoz
   * HOZZÁ SEM ÉR. Ez nem stílus: egy sor, ami létrejön és utána láthatatlan,
   * rosszabb, mint egy elutasított kérés.
   */
  it("idegen eszközre a feltöltés és a felirat meg sem próbál írni", async () => {
    const { service, kapott } = szolgaltatas({ lathatoE: false });

    await assert.rejects(
      () => service.addDocument(ASSET, "INVOICE", upload(), "user-1", VEVO),
      NotFoundException,
    );
    await assert.rejects(
      () => service.setDocumentCaption(ASSET, "doc-1", "Szivattyú", VEVO),
      NotFoundException,
    );

    assert.equal(kapott.feltoltve, 0);
    assert.deepEqual(kapott.setCaption, []);
  });
});
