// A DTO dekoratorai `Reflect`-en at olvassak a metaadatot, amit az alkalmazas a
// `main.ts`-ben telepit. Egy unit teszt e nelkul indul, tehat az importnak a DTO
// modul kiertekelese ELOTT kell allnia.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { UpsertProductShippingProfileDto } from "./dto/upsert-product-shipping-profile.dto.js";
import {
  type ProductShippingProfileDatabase,
  ProductShippingProfileRepository,
} from "./product-shipping-profile.repository.js";

const TELJES = {
  pickupOnly: true,
  foxpostForbidden: false,
  isHeavy: true,
  isFrozen: false,
};

const profil = (overrides: Record<string, unknown> = {}) => ({
  id: "profile-1",
  productId: "product-1",
  createdAt: new Date("2026-09-07T10:00:00.000Z"),
  updatedAt: new Date("2026-09-07T10:00:00.000Z"),
  ...TELJES,
  ...overrides,
});

function fixture(existing: ReturnType<typeof profil> | null) {
  const hivasok: Array<{ muvelet: string; args: unknown }> = [];
  const transaction = {
    productShippingProfile: {
      findUnique: async () => existing,
      upsert: async (args: unknown) => {
        hivasok.push({ muvelet: "upsert", args });
        return profil();
      },
    },
    auditLog: {
      create: async (args: unknown) => {
        hivasok.push({ muvelet: "audit", args });
        return {};
      },
    },
    domainEvent: {
      create: async (args: unknown) => {
        hivasok.push({ muvelet: "event", args });
        return {};
      },
    },
  };
  const database = {
    product: { findUnique: async () => ({ id: "product-1" }) },
    productShippingProfile: { findUnique: async () => existing },
    $transaction: async <T>(
      operation: (tx: typeof transaction) => Promise<T>,
    ) => operation(transaction),
  } as unknown as ProductShippingProfileDatabase;
  return {
    repository: new ProductShippingProfileRepository(database),
    hivasok,
  };
}

const metadata = (hivasok: Array<{ muvelet: string; args: unknown }>) =>
  (
    hivasok.find((h) => h.muvelet === "audit")?.args as {
      data: { metadata: Record<string, unknown> };
    }
  ).data.metadata;

/**
 * A NEGY JELZO EGYUTT ALL VAGY SEHOGY.
 *
 * A tablan egyik oszlopnak SINCS alapertelmezett erteke, mert a hianyzo ertek
 * nem "nem", hanem "meg senki nem nezte meg". Ha a DTO barmelyik mezot
 * opcionalissa tenne, ez a dontes CSENDBEN felborulna.
 */
describe("a szállítási profil bemenete", () => {
  const uzenetek = (input: unknown) =>
    validateSync(
      plainToInstance(UpsertProductShippingProfileDto, input),
    ).flatMap((error) => Object.values(error.constraints ?? {}));

  it("mind a négy jelzővel elfogadja", () => {
    assert.deepEqual(uzenetek(TELJES), []);
  });

  it("HIÁNYZÓ jelzővel elutasítja, nem egészíti ki hamisra", () => {
    const { isFrozen: _elhagyva, ...harom } = TELJES;

    const hibak = uzenetek(harom);

    assert.equal(hibak.length, 1);
    assert.match(hibak[0]!, /isFrozen/);
  });
});

describe("a szállítási profil tárolója", () => {
  /**
   * A HIANYZO PROFIL `null`, ES EZ A TABLA EGESZ ERTELME.
   *
   * Ha itt egy "minden hamis" alapertelmezes allna, egy MEG NEM VIZSGALT termek
   * ugyanugy nezne ki, mint egy megvizsgalt, amelyikre semmi nem all.
   */
  it("profil nélkül NULL-t ad vissza, nem négy hamisat", async () => {
    const { repository } = fixture(null);

    assert.equal(await repository.findByProductId("product-1"), null);
  });

  it("új profilnál a napló ELŐTTE állapota null", async () => {
    const { repository, hivasok } = fixture(null);

    await repository.upsert("product-1", TELJES, "user-1");

    assert.equal(metadata(hivasok).before, null);
    assert.deepEqual(metadata(hivasok).after, TELJES);
  });

  /**
   * A NAPLO A TELJES ALLAPOTOT VISZI, NEM A VALTOZAS-LISTAT: minden iras mind a
   * negy jelzot beallitja, tehat a "mi valtozott" kevesebbet mondana, mint a
   * "mire allitotta".
   */
  it("meglévő profilnál MINDKÉT állapot a naplóba kerül", async () => {
    const regi = profil({ pickupOnly: false, isHeavy: false });
    const { repository, hivasok } = fixture(regi);

    await repository.upsert("product-1", TELJES, "user-1");

    assert.deepEqual(metadata(hivasok).before, {
      pickupOnly: false,
      foxpostForbidden: false,
      isHeavy: false,
      isFrozen: false,
    });
    assert.deepEqual(metadata(hivasok).after, TELJES);
  });

  it("a napló eseménye megkülönbözteti a létrehozást a módosítástól", async () => {
    const ujnal = fixture(null);
    await ujnal.repository.upsert("product-1", TELJES, "user-1");
    const meglevonel = fixture(profil());
    await meglevonel.repository.upsert("product-1", TELJES, "user-1");

    const esemeny = (h: typeof ujnal.hivasok) =>
      (
        h.find((x) => x.muvelet === "event")?.args as {
          data: { eventType: string };
        }
      ).data.eventType;

    assert.equal(esemeny(ujnal.hivasok), "product_shipping_profile.created");
    assert.equal(
      esemeny(meglevonel.hivasok),
      "product_shipping_profile.updated",
    );
  });
});
