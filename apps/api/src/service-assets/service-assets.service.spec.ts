import type { PartnerScope } from "../auth/partner-scope.util.js";
import { belsosUser } from "../testing/scope-user.fixture.js";
import assert from "node:assert/strict";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import test from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import type { AssetDetail } from "@acropora/types";

import {
  AssetLabelUnavailableError,
  AssetPerformancePairError,
  AssetVolumeMalformedError,
  AssetPowerConsumptionMalformedError,
} from "./service-assets.repository.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import {
  SERVICE_OWNER_PICKABLE_WHERE,
  SERVICE_OWNER_WHERE,
  assetOwnerScopeWhere,
} from "./service-assets.types.js";

/**
 * BELSOS HATOKOR, KIIRVA. Ezek az allitasok a `keep` paros KEZELESET merik, nem
 * a jogosultsagot -- azt kulon suite meri, adatbazison.
 */
/*
  A HATOKORT MOSTANTOL A SZOLGALTATAS OLDJA FEL A FELHASZNALOBOL (2026-09-22),
  mert a lathatosag mar nem csak a tulajdonrol szol, hanem a hozzarendelt
  helyszinekrol is. A spec ezert USERT ad at (`belsosUser()`), nem kesz hatokort.

  AZ `owners` NEM VALTOZOTT, ES EZ SZANDEKOS: az nem eszkoz-sorokat listaz,
  hanem a tulajdonos-valaszto partnereit. A hozzarendelt helyszin fogalma ott
  nem ertelmes, tehat az a metodus tovabbra is kesz hatokort vesz at.
*/
const INTERNAL_HATOKOR: PartnerScope = { kind: "internal" };

const asset = {
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

function repository(
  overrides: Partial<Record<keyof ServiceAssetsRepository, unknown>> = {},
) {
  return {
    detail: async () => asset,
    detailByQrToken: async () => asset,
    validationContext: async () => ({
      customer: { id: "customer-1", isActive: true },
      supplier: null,
      address: null,
      aquarium: null,
      parent: null,
      productVariant: null,
    }),
    basic: async () => ({
      id: "asset-1",
      customerId: "customer-1",
      supplierId: null,
      customerAddressId: null,
      aquariumId: null,
      parentAssetId: null,
      productVariantId: null,
      status: "ACTIVE",
      updatedAt: new Date(asset.updatedAt),
      _count: { childAssets: 0 },
    }),
    wouldCreateCycle: async () => false,
    ...overrides,
  } as unknown as ServiceAssetsRepository;
}

/**
 * A NEM LETEZO KOTEG NEM URES LISTA.
 *
 * A ket eset TEENDOJE mas: egy elgepelt azonositora a felulet ures fajlt toltene
 * le, hibauzenet nelkul -- a kezelo pedig azt hinne, hogy a koteg ures. Az ures
 * koteg viszont letezo allapot (kod nelkuli koteg), es arra a valasz egy ures
 * lista, nem hiba.
 */
test("a nem letezo matrica-koteg nem talalhato, nem ures lista", async () => {
  const service = new ServiceAssetsService(
    repository({ labelBatchCodes: async () => null }),
    new InMemoryDocumentStore(),
  );

  await assert.rejects(
    () => service.labelBatchCodes("hianyzik"),
    /nem található/,
  );
});

/**
 * TESTVER-KONTROLL: A LETEZO, DE URES KOTEG ATMEGY.
 *
 * Enelkul az elso allitas akkor is zold lenne, ha a metodus MINDEN bemenetre
 * hibat dobna -- es akkor egy valodi, ures koteg letoltese is elhasalna.
 */
test("a letezo koteg kodjai atmennek, ures listaval is", async () => {
  const ures = new ServiceAssetsService(
    repository({ labelBatchCodes: async () => [] }),
    new InMemoryDocumentStore(),
  );
  assert.deepEqual(await ures.labelBatchCodes("koteg-1"), { codes: [] });

  const teli = new ServiceAssetsService(
    repository({ labelBatchCodes: async () => ["V2196", "A0001"] }),
    new InMemoryDocumentStore(),
  );
  assert.deepEqual(await teli.labelBatchCodes("koteg-2"), {
    codes: ["V2196", "A0001"],
  });
});

test("rejects a parent asset owned by a different customer", async () => {
  const service = new ServiceAssetsService(
    repository({
      validationContext: async () => ({
        customer: { id: "customer-1", isActive: true },
        supplier: null,
        address: null,
        aquarium: null,
        parent: {
          id: "parent-1",
          customerId: "customer-2",
          supplierId: null,
          customerAddressId: null,
          aquariumId: null,
          status: "ACTIVE",
        },
        productVariant: null,
      }),
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "CUSTOMER",
          ownerId: "customer-1",
          parentAssetId: "parent-1",
          kind: "COMPONENT",
          name: "Szivattyú",
        },
        "user-1",
        { kind: "internal" },
      ),
    BadRequestException,
  );
});

/**
 * A `service-assets.repository.ts` VEVŐ-TULAJDONOSNÁL MINDIG `null`-t ír a
 * `departmentId` mezőbe -- létrehozáskor is --, és a hívó SOSEM küld
 * `departmentId`-t egy vevő-tulajdonú eszközhöz (a vevőknek sosem volt
 * alegységük). A `requested` ezért `false` marad, és a régi kód -- amíg a
 * `CUSTOMER_OWNER` ág a `requested` ellenőrzés MÖGÖTT állt -- ezt az esetet
 * NEM fogta meg: a kérés átment a validáción, és a `NOT NULL` megkötés alatt
 * (2026-09-22-től) nyers, megnevezetlen adatbázis-hibával végződött volna.
 *
 * Ez itt a VISELKEDÉST méri (a `service.create` hív-e `BadRequestException`-t
 * megnevezett üzenettel), nem azt, hogy a validáció TÍPUSA létezik -- acrobot
 * kikötése, msg 22200.
 */
test("rejects creating a customer-owned asset, even when the request never mentions a department", async () => {
  const service = new ServiceAssetsService(
    repository({
      validationContext: async () => ({
        customer: { id: "customer-1", isActive: true },
        supplier: null,
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "CUSTOMER",
          ownerId: "customer-1",
          kind: "COMPONENT",
          name: "Szivattyú",
        },
        "user-1",
        { kind: "internal" },
      ),
    (error: unknown) => {
      assert.ok(
        error instanceof BadRequestException,
        `400-at vartam, ez jott: ${String(error)}`,
      );
      assert.match(String(error.message), /alegysége kötelező/);
      return true;
    },
  );
});

/**
 * UGYANEZ A MÁSODIK ÍRÁSI ÚT: A SZÁLLÍTÓRÓL VEVŐRE VÁLTÁS.
 *
 * A `repository.ts` update-ágán (kb. 1652. sor) a `departmentId:
 * input.ownerType === "CUSTOMER" ? null : input.departmentId` UGYANÚGY
 * explicit `null`-t ír, amikor a hívó SUPPLIER-ről CUSTOMER-re vált -- és a
 * váltás kérése SOSEM küld `departmentId`-t (a vevőnek nem lehet alegysége).
 */
test("rejects switching an asset from supplier to customer ownership, even without a department in the request", async () => {
  const service = new ServiceAssetsService(
    repository({
      basic: async () => ({
        id: "asset-1",
        customerId: null,
        supplierId: "supplier-1",
        customerAddressId: null,
        aquariumId: null,
        parentAssetId: null,
        productVariantId: null,
        status: "ACTIVE",
        updatedAt: new Date(asset.updatedAt),
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
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.update(
        "asset-1",
        {
          ownerType: "CUSTOMER",
          ownerId: "customer-1",
          expectedUpdatedAt: asset.updatedAt,
        },
        "user-1",
        belsosUser(),
      ),
    (error: unknown) => {
      assert.ok(
        error instanceof BadRequestException,
        `400-at vartam, ez jott: ${String(error)}`,
      );
      assert.match(String(error.message), /alegysége kötelező/);
      return true;
    },
  );
});

test("rejects a cyclic parent update before writing", async () => {
  let updateCalled = false;
  const service = new ServiceAssetsService(
    repository({
      wouldCreateCycle: async () => true,
      update: async () => {
        updateCalled = true;
        return asset;
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.update(
        "asset-1",
        {
          parentAssetId: "child-1",
          expectedUpdatedAt: asset.updatedAt,
        },
        "user-1",
        // BELSOS UT: ezek a tesztek a sajat kollegank altali szerkesztest merik.
        belsosUser(),
      ),
    BadRequestException,
  );
  assert.equal(updateCalled, false);
});

test("generates an app deep link QR without exposing database ids", async () => {
  const previous = process.env.ASSET_QR_BASE_URL;
  process.env.ASSET_QR_BASE_URL = "acropora-os://assets/scan";
  try {
    const result = await new ServiceAssetsService(
      repository(),
      new InMemoryDocumentStore(),
    ).qrCode("asset-1", belsosUser());
    assert.equal(
      result.value,
      "acropora-os://assets/scan/550e8400-e29b-41d4-a716-446655440000",
    );
    assert.doesNotMatch(result.value, /asset-1/);
    assert.match(result.svg, /^<svg /);
    assert.equal(result.labelSizeMm, 30);
  } finally {
    if (previous === undefined) delete process.env.ASSET_QR_BASE_URL;
    else process.env.ASSET_QR_BASE_URL = previous;
  }
});

/**
 * A TULAJDONOS-VÁLASZTÓ, és amiért ez a három állítás létezik.
 *
 * A lista korábban MINDEN aktív vevőt és MINDEN aktív partnert visszaadott,
 * tehát az új eszköz űrlap első mezőjében a webshopos vevők jelentek meg
 * (Balázs bejelentése, 2026-08-25). A szűrés maga a tárolóban van, ezért a
 * feltétel külön konstans: adatbázis nélkül is állítható, és pont ez az a sor,
 * amit el lehet rontani.
 */
test("asks for service partners only, and says so in one place", () => {
  assert.deepEqual(SERVICE_OWNER_WHERE, { isActive: true, isService: true });
});

/**
 * A VÁLASZTÓ SZŰKEBB, MINT A LISTA HATÓKÖRE, ÉS EZ A KÜLÖNBSÉG A LÉNYEG.
 *
 * A törölt partnerhez ÚJ eszközt nem rendelhetünk (a tulajdonos kérése,
 * 2026-08-21: a törölt partner ne jelenjen meg a választókban). A nála ÁLLÓ
 * eszközök viszont fizikailag ott vannak, tehát a szerelő listájáról nem
 * tűnhetnek el -- ha a két szabály egy konstansba kerülne, az egyik oldalon
 * mindig rossz lenne, és némán.
 */
test("offers no deleted partner, but keeps their assets on the list", () => {
  assert.deepEqual(SERVICE_OWNER_PICKABLE_WHERE, {
    isActive: true,
    isService: true,
    deletedAt: null,
  });

  const scope = assetOwnerScopeWhere("SERVICE_PARTNER");
  assert.deepEqual(scope.supplier, { is: { ...SERVICE_OWNER_WHERE } });
  assert.equal(
    "deletedAt" in (scope.supplier as { is: Record<string, unknown> }).is,
    false,
    "A lista hatóköre NEM kaphatja meg a törölt-szűrőt: az eszköz ott áll.",
  );
});

test("keeps the owner an existing asset already has", async () => {
  let asked: unknown = "nem hívták meg";
  const service = new ServiceAssetsService(
    repository({
      owners: async (keep: unknown) => {
        asked = keep;
        return { items: [] };
      },
    }),
    new InMemoryDocumentStore(),
  );

  await service.owners(
    { ownerType: "CUSTOMER", ownerId: "customer-9" },
    INTERNAL_HATOKOR,
  );

  assert.deepEqual(asked, { type: "CUSTOMER", id: "customer-9" });
});

test("passes nothing to keep when the caller is creating a new asset", async () => {
  let asked: unknown = "nem hívták meg";
  const service = new ServiceAssetsService(
    repository({
      owners: async (keep: unknown) => {
        asked = keep;
        return { items: [] };
      },
    }),
    new InMemoryDocumentStore(),
  );

  await service.owners({}, INTERNAL_HATOKOR);

  assert.equal(asked, null);
});

/**
 * A FÉL PÁROS nem értelmezhető, és csendben elhagyva pont azt a sort ejtenénk
 * ki, amiért a hívás történt: a szerkesztő üres mezőt látna a tulajdonos
 * helyén, és nem tudná meg, miért.
 */
test("refuses half of an owner reference instead of ignoring it", () => {
  const service = new ServiceAssetsService(
    repository(),
    new InMemoryDocumentStore(),
  );

  // A visszautasítás AZONNAL történik, még a tároló hívása előtt: nem
  // elutasított ígéret, hanem dobott hiba.
  assert.throws(
    () => service.owners({ ownerType: "CUSTOMER" }, INTERNAL_HATOKOR),
    BadRequestException,
  );
  assert.throws(
    () => service.owners({ ownerId: "customer-9" }, INTERNAL_HATOKOR),
    BadRequestException,
  );
});

/**
 * A TULAJDONOS FAJTÁJA SZERINTI SZŰKÍTÉS, és amiért KÉT állítás tartozik hozzá.
 *
 * A telefonon a szerelő listája a szerviz-partnerek eszközeié; a webes
 * nyilvántartásé viszont MINDEN eszköz, mert ott a teljesség az érték.
 * Ugyanaz a végpont szolgálja ki a kettőt, tehát a szűrés csak akkor lehet
 * helyes, ha KÉRNI kell -- és az a fontosabbik állítás, hogy kérés nélkül nem
 * történik semmi. Egy teszt, ami csak az új viselkedést méri, nem védi meg
 * azt, amit nem akartunk megváltoztatni.
 */
test("narrows to service partners only when the caller asks for it", () => {
  assert.deepEqual(assetOwnerScopeWhere("SERVICE_PARTNER"), {
    supplier: { is: { isActive: true, isService: true } },
  });
});

test("leaves the list untouched when no scope is given", () => {
  // A WEBES ALAPÉRTELMEZÉS. Üres feltétel: se vevő-tulajdonosú, se nem
  // szerviz-jelölt partneré nem esik ki.
  assert.deepEqual(assetOwnerScopeWhere(undefined), {});
});

/**
 * ÉS UGYANAZ A FELTÉTEL, mint a tulajdonos-választón. Ha a kettő elválna, a
 * szerelő olyan eszközt látna, aminek a gazdáját már nem lehetne kiválasztani
 * -- vagy fordítva, és egyik irányban sem szólna semmi.
 */
test("uses the same condition as the owner picker", () => {
  const scoped = assetOwnerScopeWhere("SERVICE_PARTNER");
  assert.deepEqual(scoped.supplier, { is: { ...SERVICE_OWNER_WHERE } });
});

/**
 * A MATRICA-UZENET KET AGA, MINDKETTO ALLITASSAL.
 *
 * Balazs dontese (2026-09-02): "a sajat embereinknek mondjuk meg melyik eset
 * all fenn". A partnernek marad az osszevont uzenet, mert nala a ket eset
 * kulonvalasztasa felterkepezhetove tenne a kiadott keszletet.
 *
 * MIERT KELL MINDKET AGRA ALLITAS: ha csak a belsos agat merjuk, egy kesobbi
 * "egysegesites" a BOVEBB uzenetet adna a partnernek is -- es az a valtozas
 * MUKODONEK latszana, mert a hibauzenet tovabbra is megjelenik.
 */
test("a belsős felhasználó megtudja, melyik eset áll fenn", async () => {
  const service = new ServiceAssetsService(
    repository({
      // SUPPLIER, NEM CUSTOMER: ez az állítás a matricakód-üzenetről szól,
      // nem a tulajdonos-alegység szabályról. CUSTOMER ownerType-tal a
      // `validateReferences` MOST MÁR mindig elutasítana, mielőtt a
      // `create()` egyáltalán meghívódna -- lásd asset-department.ts.
      validationContext: async () => ({
        customer: null,
        supplier: { id: "supplier-1", isActive: true },
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
      create: async () => {
        throw new AssetLabelUnavailableError("V2196");
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "SUPPLIER",
          ownerId: "supplier-1",
          kind: "COMPONENT",
          name: "Szivattyú",
          labelCode: "V2196",
        },
        "user-1",
        { kind: "internal" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.match(String(error.message), /nincs kiadva/);
      return true;
    },
  );
});

/**
 * A SZERKESZTO AG IS A BELSOS UZENETET KAPJA.
 *
 * A vegpont `SERVICE_MANAGE` jog alatt all, tehat aki ide eljut, LATJA a
 * kiadott kodok listajat -- neki a ket eset kulonvalasztasa ("nincs kiadva"
 * kontra "mas eszkozon all") hasznos, nem szivargas.
 *
 * MIERT KELL RA ALLITAS: a `map` a hatokort OPCIONALIS parameterkent veszi, es
 * ha elhagyjuk, CSENDBEN a partnernek szant, osszevont mondatot adja. Semmi nem
 * hibazik tole: a hivo 409-et kap, csak kevesebbet tud meg, mint amennyi jar
 * neki. Pontosan ez volt a hiba, amit ez az allitas megfog.
 */
test("a szerkesztő ág a BELSŐS üzenetet adja, nem a partnerét", async () => {
  const service = new ServiceAssetsService(
    repository({
      // SUPPLIER: a meglévő eszköz a DEFAULT stub szerint CUSTOMER-tulajdonú
      // (lásd `basic()` a fájl elején), és a `validateReferences` MOST MÁR
      // mindig elutasítja a CUSTOMER esetet -- ez az állítás viszont a
      // matricakód-üzenetről szól, nem a tulajdonos-alegység szabályról.
      basic: async () => ({
        id: "asset-1",
        customerId: null,
        supplierId: "supplier-1",
        customerAddressId: null,
        aquariumId: null,
        parentAssetId: null,
        productVariantId: null,
        status: "ACTIVE",
        updatedAt: new Date(asset.updatedAt),
        _count: { childAssets: 0 },
      }),
      validationContext: async () => ({
        customer: null,
        supplier: { id: "supplier-1", isActive: true },
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
      update: async () => {
        throw new AssetLabelUnavailableError("V2196");
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.update(
        "asset-1",
        { labelCode: "V2196", expectedUpdatedAt: asset.updatedAt },
        "user-1",
        // BELSOS UT: ezek a tesztek a sajat kollegank altali szerkesztest merik.
        belsosUser(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.match(String(error.message), /nincs kiadva/);
      return true;
    },
  );
});

/**
 * ES AZ ALAK-HIBA A SZERKESZTO AGON IS 400, NEM 409.
 *
 * A ket eset TEENDOJE mas: egy rossz alakot a KERESEN kell javitani, egy
 * foglalt kodnal viszont masik matricat kell olvasni. A tarolo mind a kettot
 * ugyanazon az osztalyon adja vissza (a nyers koddal), es a szetvalasztas a
 * `map`-ben tortenik -- ez az allitas azt orzi, hogy a szerkeszto ut is
 * ATMEGY ezen a szetvalasztason, nem csak a felvitel.
 */
test("a szerkesztő ágon a rossz ALAK 400-at ad, nem 409-et", async () => {
  const service = new ServiceAssetsService(
    repository({
      // SUPPLIER, ugyanazért, mint a szomszéd állításban: a DEFAULT `basic()`
      // CUSTOMER-tulajdonost adna, ami a mai szigorítás mellett elutasítást
      // okozna, mielőtt az alak-hiba egyáltalán sülne.
      basic: async () => ({
        id: "asset-1",
        customerId: null,
        supplierId: "supplier-1",
        customerAddressId: null,
        aquariumId: null,
        parentAssetId: null,
        productVariantId: null,
        status: "ACTIVE",
        updatedAt: new Date(asset.updatedAt),
        _count: { childAssets: 0 },
      }),
      validationContext: async () => ({
        customer: null,
        supplier: { id: "supplier-1", isActive: true },
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
      update: async () => {
        throw new AssetLabelUnavailableError("nem-jo-alak");
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.update(
        "asset-1",
        { labelCode: "nem-jo-alak", expectedUpdatedAt: asset.updatedAt },
        "user-1",
        // BELSOS UT: ezek a tesztek a sajat kollegank altali szerkesztest merik.
        belsosUser(),
      ),
    (error: unknown) => {
      assert.ok(
        error instanceof BadRequestException,
        "alak-hibára a kérésen kell javítani, tehát 400",
      );
      assert.match(String(error.message), /egy betű és négy szám/);
      return true;
    },
  );
});

test("a partner az összevont üzenetet kapja", async () => {
  const service = new ServiceAssetsService(
    repository({
      // SUPPLIER: az eszköz tulajdonosa, nem a hívó -- a hívó továbbra is
      // partner-scope-ú ("customer" lent), csak az eszköz nem vevő-tulajdonú,
      // mert a mai szigorítás azt mindig elutasítaná a matricakód-üzenet
      // előtt.
      validationContext: async () => ({
        customer: null,
        supplier: { id: "supplier-1", isActive: true },
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
      create: async () => {
        throw new AssetLabelUnavailableError("V2196");
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "SUPPLIER",
          ownerId: "supplier-1",
          kind: "COMPONENT",
          name: "Szivattyú",
          labelCode: "V2196",
        },
        "user-1",
        { kind: "customer", customerId: "customer-1" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        /nincs kiadva/.test(String(error.message)),
        false,
        "a partner NEM tudhatja meg, hogy a kód ki van-e adva",
      );
      assert.match(String(error.message), /nem köthető/);
      return true;
    },
  );
});

/**
 * A FEL TELJESITMENY-PAR 400-AT AD, ES A MONDAT MEGNEVEZI A HIANYZO FELET.
 *
 * MIERT KELL ERRE ALLITAS, HOLOTT A TAROLO MAR DOB: mert a ket dontes KET
 * HELYEN all. A tarolo azt mondja meg, MI nem all; a szolgaltatas azt, KINEK
 * szol a mondat es milyen valaszkoddal. Ha ez a leképezes kimaradna, a hiba a
 * `map` vegen levo `throw error`-ig futna, es 500 lenne belole -- pontosan az
 * az alak, ami a matricakod `null` eseteben mar egyszer elofordult.
 *
 * ES A 400 NEM UGYANAZ, MINT A MATRICAE (409): ott a keres alakja jo volt es a
 * VILAG allapota nem allt (a kod mason ul), itt maga a keres hianyos.
 */
test("a fél teljesítmény-pár 400-at ad, és megnevezi a hiányzó felet", async () => {
  const service = new ServiceAssetsService(
    repository({
      // SUPPLIER: ez az állítás a teljesítmény-pár üzenetről szól, nem a
      // tulajdonos-alegység szabályról -- CUSTOMER-rel a mai szigorítás
      // mindig elutasítaná, mielőtt a `create()` meghívódna.
      validationContext: async () => ({
        customer: null,
        supplier: { id: "supplier-1", isActive: true },
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
      create: async () => {
        throw new AssetPerformancePairError("unit");
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "SUPPLIER",
          ownerId: "supplier-1",
          kind: "COMPONENT",
          name: "Szivattyú",
          performance: "500",
        },
        "user-1",
        { kind: "internal" },
      ),
    (error: unknown) => {
      // A VALASZKOD: 400, nem 409 es nem 500.
      assert.ok(
        error instanceof BadRequestException,
        `400-at vartam, ez jott: ${String(error)}`,
      );
      // ES A MONDAT: a kezelonek tudnia kell, MELYIK oldal ures -- a ket eset
      // KET kulon teendo (legordulot valasztani kontra szamot irni).
      assert.match(String(error.message), /mértékegységet is kell választani/);
      return true;
    },
  );
});

/**
 * A TESTVER-ALLITAS A MASIK FELRE.
 *
 * Enelkul a fenti akkor is zold lenne, ha a leképezes MINDIG ugyanazt a
 * mondatot adna -- es akkor a kezelo a hianyzo SZAM eseten is azt olvasna,
 * hogy mertekegyseget kell valasztani.
 */
test("a másik fél hiányára a MÁSIK mondat jön", async () => {
  const service = new ServiceAssetsService(
    repository({
      // SUPPLIER, ugyanazért, mint a szomszéd állításban.
      validationContext: async () => ({
        customer: null,
        supplier: { id: "supplier-1", isActive: true },
        address: null,
        aquarium: null,
        parent: null,
        productVariant: null,
      }),
      create: async () => {
        throw new AssetPerformancePairError("szam");
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "SUPPLIER",
          ownerId: "supplier-1",
          kind: "COMPONENT",
          name: "Szivattyú",
          performanceUnitId: "uom-1",
        },
        "user-1",
        { kind: "internal" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(String(error.message), /teljesítmény-értéket is kell írni/);
      return true;
    },
  );
});

/**
 * A TERFOGAT ROSSZ ALAKJA IS 400-AT AD, UGYANAZZAL A LEKEPEZESSEL, MINT A
 * TELJESITMENY -- de par nelkul: a `volume`-nak nincs mertekegyseg-tarsa.
 */
test("a rossz alakú térfogat 400-at ad", async () => {
  const service = new ServiceAssetsService(
    repository({
      create: async () => {
        throw new AssetVolumeMalformedError();
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "CUSTOMER",
          ownerId: "customer-1",
          kind: "COMPONENT",
          name: "Medence",
          volume: "abc",
        },
        "user-1",
        { kind: "internal" },
      ),
    (error: unknown) => {
      assert.ok(
        error instanceof BadRequestException,
        `400-at vartam, ez jott: ${String(error)}`,
      );
      assert.match(String(error.message), /A térfogat csak szám lehet/);
      return true;
    },
  );
});

/**
 * A FOGYASZTAS ROSSZ ALAKJA IS 400-AT AD, SZO SZERINT UGYANAZZAL A
 * LEKEPEZESSEL, MINT A TERFOGAT.
 */
test("a rossz alakú fogyasztás 400-at ad", async () => {
  const service = new ServiceAssetsService(
    repository({
      create: async () => {
        throw new AssetPowerConsumptionMalformedError();
      },
    }),
    new InMemoryDocumentStore(),
  );
  await assert.rejects(
    () =>
      service.create(
        {
          ownerType: "CUSTOMER",
          ownerId: "customer-1",
          kind: "COMPONENT",
          name: "Szivattyú",
          powerConsumption: "6,15/5,5",
        },
        "user-1",
        { kind: "internal" },
      ),
    (error: unknown) => {
      assert.ok(
        error instanceof BadRequestException,
        `400-at vartam, ez jott: ${String(error)}`,
      );
      assert.match(String(error.message), /A fogyasztás csak szám lehet/);
      return true;
    },
  );
});
