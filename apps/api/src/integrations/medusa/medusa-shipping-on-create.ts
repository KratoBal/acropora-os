import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { liveAnimalSubtreeIds } from "./medusa-livestock.policy.js";
import type { ShippingAttributesCliDatabase } from "./medusa-shipping-attributes.cli.js";
import type {
  MedusaShippingAttributesService,
  ShippingAttributesOutcome,
} from "./medusa-shipping-attributes.service.js";
import type { OsShippingProfile } from "./medusa-shipping-attributes.policy.js";

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
 *   2. AZ OSZTÁLY. Ugyanazokból a forrásokból, mint a `medusa-shipping-attributes`
 *      parancs: a szállítási-jellemző sor (a82ed229: az OS a jelzők gazdája, a
 *      UNAS-szinkron és a kézi írás tartja, az egyszeri feltöltő élesen is
 *      lefutott 2026-11-05-én), és az élő állat a KATEGÓRIÁBÓL bolti átvétel,
 *      bármit mond a sor. A UNAS nyers adatából számolt tartalék kikerült: sor
 *      nélkül a terméknek nincs korlátozása, ahogy a csak OS-ben élő terméknek.
 *      A frissen létrehozott terméknek kötés-sora van, tehát SKU-párosítás itt
 *      nem kell: a kötés pontos.
 *
 * Az OS-be NEM ír.
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
  liveAnimal: boolean;
}): { profile: OsShippingProfile | null; derivedPickupOnly: boolean } {
  return {
    profile: input.handRow,
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
    const [placements, handRows] = await Promise.all([
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
          lockerUnsuitable: true,
        },
      }),
    ]);
    const { profile, derivedPickupOnly } = shippingSourceFor({
      handRow: handRows[0] ?? null,
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
