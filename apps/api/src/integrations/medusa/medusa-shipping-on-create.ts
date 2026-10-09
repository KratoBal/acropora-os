import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { liveAnimalSubtreeIds } from "./medusa-livestock.policy.js";
import type { ShippingAttributesCliDatabase } from "./medusa-shipping-attributes.cli.js";
import type {
  MedusaShippingAttributesService,
  ShippingAttributesOutcome,
} from "./medusa-shipping-attributes.service.js";
import type { OsShippingProfile } from "./medusa-shipping-attributes.policy.js";
import { unasShippingProfile } from "./medusa-unas-shipping.policy.js";

/**
 * AZ ÚJ TERMÉK SZÁLLÍTÁSA, MÁR A LÉTREHOZÁSKOR (kártya 2a7f2313, a #1546
 * követő része; acrobot 27153).
 *
 * Két dolog, és mindkettő azért kell, mert a #1546 parancsai csak a MÁR KINT
 * LÉVŐ termékeket javítják, a vetítés által később létrehozottat nem:
 *
 *   1. A PROFIL. A Medusa csak olyan terméket enged megrendelni, amelyik
 *      szállítási profilhoz kötött, és a bolt összes szállítási módja az
 *      alapértelmezett profilon áll (commerce `initial-data-seed.ts`). Ezért a
 *      létrehozás ezt a profilt kapja. Ha nem pontosan egy van, nem választunk:
 *      a termék profil nélkül születik, és a kimenet kimondja.
 *
 *   2. AZ OSZTÁLY. Ugyanazokból a forrásokból, ugyanabban a sorrendben, mint a
 *      `medusa-shipping-attributes` parancs (acrobot 27099 döntései):
 *        - a kézzel kitöltött szállítási-jellemző sor ERŐSEBB a UNAS-nál;
 *        - különben a UNAS szállítási felülírása (`unasShippingProfile`: a
 *          „csak Foxpost” tétel, köztük a Modern Reef, bolti átvétel; a „csak
 *          GLS házhoz” Foxpost-tiltás);
 *        - az élő állat a KATEGÓRIÁBÓL bolti átvétel, bármit mond a UNAS.
 *      A frissen létrehozott terméknek kötés-sora van, tehát SKU-párosítás itt
 *      nem kell: a kötés pontos.
 *
 * Az OS-be NEM ír. A jelzők 2026-10-09 óta az OS-ben is élnek (a82ed229: a
 * UNAS-szinkron és a kézi írás tartja őket); a UNAS-ból számolt érték itt már
 * csak a még sor nélküli terméknél dönt.
 */
export interface ShippingOnCreate {
  /** A bolt alapértelmezett szállítási profilja; `null`: nem pontosan egy van. */
  defaultProfileId(): Promise<string | null>;
  /** Az osztály kiírása a frissen létrehozott, már kötött termékre. */
  afterCreate(osProductId: string): Promise<ShippingAttributesOutcome>;
}

/** A forrás-sorrend egy termékre, adatbázis nélkül mérhetően. */
export function shippingSourceFor(input: {
  handRow: OsShippingProfile | null;
  unasPayload: unknown;
  liveAnimal: boolean;
}): { profile: OsShippingProfile | null; derivedPickupOnly: boolean } {
  return {
    profile: input.handRow ?? unasShippingProfile(input.unasPayload) ?? null,
    derivedPickupOnly: input.liveAnimal,
  };
}

export class MedusaShippingOnCreate implements ShippingOnCreate {
  constructor(
    private readonly database: ShippingAttributesCliDatabase,
    private readonly medusa: Pick<
      MedusaAdminClient,
      "defaultShippingProfileId"
    >,
    private readonly attributes: Pick<
      MedusaShippingAttributesService,
      "project"
    >,
  ) {}

  /** Egy futásban egyszer kérdezzük; a sikertelen kérdést nem tartjuk meg. */
  private profileId: Promise<string | null> | undefined;
  private liveAnimalCategories: Promise<Set<string>> | undefined;

  defaultProfileId(): Promise<string | null> {
    this.profileId ??= this.medusa.defaultShippingProfileId().catch((error) => {
      this.profileId = undefined;
      throw error;
    });
    return this.profileId;
  }

  private liveAnimalIds(): Promise<Set<string>> {
    this.liveAnimalCategories ??= this.database.category
      .findMany({ select: { id: true, name: true, parentId: true } })
      .then((rows) => liveAnimalSubtreeIds(rows))
      .catch((error) => {
        this.liveAnimalCategories = undefined;
        throw error;
      });
    return this.liveAnimalCategories;
  }

  async afterCreate(osProductId: string): Promise<ShippingAttributesOutcome> {
    const liveIds = await this.liveAnimalIds();
    const [placements, handRows, unasRows] = await Promise.all([
      liveIds.size
        ? this.database.productCategory.findMany({
            where: { productId: osProductId, categoryId: { in: [...liveIds] } },
            select: { productId: true, categoryId: true },
          })
        : Promise.resolve([]),
      this.database.productShippingProfile.findMany({
        where: { productId: osProductId },
        select: {
          productId: true,
          pickupOnly: true,
          foxpostForbidden: true,
          isHeavy: true,
          isFrozen: true,
        },
      }),
      this.database.unasProductSnapshot.findMany({
        where: { productId: osProductId },
        select: { productId: true, rawPayload: true },
      }),
    ]);
    const { profile, derivedPickupOnly } = shippingSourceFor({
      handRow: handRows[0] ?? null,
      unasPayload: unasRows[0]?.rawPayload ?? null,
      liveAnimal: placements.length > 0,
    });
    return this.attributes.project(
      osProductId,
      profile,
      true,
      derivedPickupOnly,
    );
  }
}
