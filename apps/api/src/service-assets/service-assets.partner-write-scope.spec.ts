import {
  belsosUser,
  szallitoUser,
  vevoUser,
} from "../testing/scope-user.fixture.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";
import type { AssetDetail } from "@acropora/types";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";

/**
 * A PARTNER CSAK A SAJAT ESZKOZET SZERKESZTHETI, ES CSAK ANNAK A QR-KODJAT.
 *
 * === A RES, AMIT EZ BEZAR, ES MIERT VOLT CSENDES ===
 *
 * A `PATCH :id` es a `POST :id/qr/rotate` a `SERVICE_MANAGE` jog alatt all.
 * Ez a jog NEM belsos jelolo: a `PARTNER_SERVICE` szerep MEGKAPJA
 * (`ROLE_PERMISSIONS`, merve 2026-09-21). 2026-09-21-ig az `update` SEMMILYEN
 * hatokort nem kapott, a `rotateQr` pedig `{ kind: "internal" }` hatokorrel
 * kereste meg a sort -- tehat mind a ketto a TELJES tablan dolgozott.
 *
 * A felulet ezt nem kinalta fel, ezert nem latszott. Aki viszont az API-t
 * kozvetlenul hivja, egy IDEGEN eszkozt is atirhatott, es lecserelhette a
 * QR-kodjat. Egy lecserelt kod a helyszinen allo matricat ervenytelenne teszi.
 *
 * === AMIT A JAVITAS NEM VESZ EL, ES EZ KIKOTES VOLT ===
 *
 * A dokumentum-feltoltes az eszkozre UGYANEZEN a `SERVICE_MANAGE` jogon all,
 * es azt Balazs KIFEJEZETTEN kerte a partnernek. Ezert nem a JOGOT szukitjuk,
 * hanem a HATOKORT: a partner a sajat eszkozet tovabbra is szerkeszti.
 *
 * === A CSONK HATOKORT TARTO `detail`-T KAP, ES EZ A LENYEG ===
 *
 * A szomszed spec csonkja `detail: async () => asset` alaku: MINDIG ad sort,
 * barmilyen hatokorrel. Egy ilyen csonkon a lenti tagadasok SOHA nem tudnanak
 * elbukni -- zoldek lennenek a javitas nelkul is. Itt a csonk a hatokorbol
 * dont, tehat a mérés arrol szol, amirol az allitas.
 */

const ESZKOZ = {
  id: "asset-1",
  assetNumber: "ESZK-1",
  qrToken: "550e8400-e29b-41d4-a716-446655440000",
  name: "Fóka felnyomó szivattyú",
  kind: "COMPONENT",
  status: "ACTIVE",
  criticality: "HIGH",
  owner: {
    type: "CUSTOMER",
    id: "customer-1",
    code: "VEVO-1",
    displayName: "Fóka",
  },
  childCount: 0,
  updatedAt: "2026-08-15T10:00:00.000Z",
  ancestors: [],
  children: [],
  events: [],
  documents: [],
  createdAt: "2026-08-15T10:00:00.000Z",
} satisfies AssetDetail;

/** A sor a `customer-1` vevoe. Aki mas hatokorbol nez, nem latja. */
function lathato(scope: PartnerScope): boolean {
  if (scope.kind === "internal") return true;
  if (scope.kind === "customer") return scope.customerId === "customer-1";
  return false;
}

function tarolo(overrides: Record<string, unknown> = {}) {
  const irasok: string[] = [];
  const repo = {
    /*
      A HOZZARENDELT HELYSZINEK a dupla szamara allandok: ez a fajl a TULAJDON
      tengelyet meri, nem a helyszinet. A helyszin-tengelyt a
      `asset-visibility-scope.integration.spec.ts` meri, valodi sorokon -- egy
      hamis tarolon a szures amugy sem lenne merheto.
    */
    assignedUnitIds: async () => ["dept-1"],
    detail: async (_id: string, scope: PartnerScope) =>
      lathato(scope) ? ESZKOZ : null,
    basic: async () => ({
      id: "asset-1",
      customerId: "customer-1",
      supplierId: null,
      customerAddressId: null,
      aquariumId: null,
      parentAssetId: null,
      productVariantId: null,
      status: "ACTIVE",
      updatedAt: new Date(ESZKOZ.updatedAt),
      _count: { childAssets: 0 },
    }),
    validationContext: async () => ({
      customer: { id: "customer-1", isActive: true },
      supplier: null,
      address: null,
      aquarium: null,
      parent: null,
      productVariant: null,
    }),
    wouldCreateCycle: async () => false,
    update: async () => {
      irasok.push("update");
      return ESZKOZ;
    },
    rotateQr: async () => {
      irasok.push("rotateQr");
      return ESZKOZ;
    },
    ...overrides,
  } as unknown as ServiceAssetsRepository;
  return { repo, irasok };
}

function szolgaltatas(repo: ServiceAssetsRepository) {
  return new ServiceAssetsService(repo, new InMemoryDocumentStore());
}

/*
  A HIVO MOSTANTOL FELHASZNALO (2026-09-22): a szolgaltatas belole oldja fel a
  hatokort ES a hozzarendelt helyszineket. A nevek valtozatlanok, hogy az
  allitasok szovege ugyanazt mondja, mint eddig.
*/
const SAJAT = vevoUser("customer-1");
const IDEGEN = vevoUser("customer-2");
const SZALLITO = szallitoUser("supplier-1");
const BELSOS = belsosUser();

const MODOSITAS = { name: "Új név", expectedUpdatedAt: ESZKOZ.updatedAt };

describe("a partner szerkesztése csak a saját eszközére szól", () => {
  /*
    A POZITIV IRANY ELSO, ES NEM UDVARIASSAGBOL: e nelkul egy "mindent
    elutasitunk" javitas is zold lenne. Ez a sor bizonyitja, hogy a kapu
    ATENGEDI azt, akinek at kell engednie.
  */
  it("a SAJÁT eszközét szerkesztheti", async () => {
    const { repo, irasok } = tarolo();
    await szolgaltatas(repo).update("asset-1", MODOSITAS, "user-1", SAJAT);
    assert.deepEqual(irasok, ["update"]);
  });

  /*
    A KAPU BIZONYITEKA AZ, HOGY NEM TORTENT SEMMI -- nem a kivetel. Egy orzo,
    ami dob ES kozben ir, kivulrol pontosan igy nezne ki: a hivo hibat kap, a
    sor megis megvaltozik.
  */
  it("IDEGEN eszközt nem szerkeszthet, és nem is ír semmit", async () => {
    const { repo, irasok } = tarolo();
    await assert.rejects(
      () => szolgaltatas(repo).update("asset-1", MODOSITAS, "user-1", IDEGEN),
      NotFoundException,
    );
    assert.deepEqual(irasok, []);
  });

  it("a SAJÁT eszköze QR-kódját cserélheti", async () => {
    const { repo, irasok } = tarolo();
    await szolgaltatas(repo).rotateQr("asset-1", "user-1", SAJAT);
    assert.deepEqual(irasok, ["rotateQr"]);
  });

  it("IDEGEN eszköz QR-kódját nem cserélheti, és nem is ír semmit", async () => {
    const { repo, irasok } = tarolo();
    await assert.rejects(
      () => szolgaltatas(repo).rotateQr("asset-1", "user-1", IDEGEN),
      NotFoundException,
    );
    assert.deepEqual(irasok, []);
  });

  /*
    A SZALLITOI AG KONTROLL, NEM UJ SZABALY.

    acrobot kikotese a testver-kartyarol: ott a ket oldal MA IS egyezik, tehat
    a javitasnak NEM szabad elmozditania. Ez a sor azt meri, hogy a szukites
    nem nyult tul a cel-halmazon -- ha a szallitoi ag is mozdulna, tul sokat
    nyitottunk vagy tul sokat zartunk.
  */
  it("a szállítói hatókör a saját szabályán marad (kontroll)", async () => {
    const { repo, irasok } = tarolo();
    await assert.rejects(
      () => szolgaltatas(repo).update("asset-1", MODOSITAS, "user-1", SZALLITO),
      NotFoundException,
    );
    assert.deepEqual(irasok, []);
  });

  /*
    ES A BELSOS UT VALTOZATLAN. A sajat kollegank barmelyik eszkozt kezeli --
    ez a masodik pozitiv kontroll, es azt zarja ki, hogy a javitas csendben a
    belso munkat is szukitse.
  */
  it("a belsős kolléga továbbra is szerkeszt (kontroll)", async () => {
    const { repo, irasok } = tarolo();
    await szolgaltatas(repo).update("asset-1", MODOSITAS, "user-1", BELSOS);
    assert.deepEqual(irasok, ["update"]);
  });
});
