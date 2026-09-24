import type { Prisma } from "@acropora/database";
import { hasPermission, INTERNAL_ROLES, PERMISSIONS } from "@acropora/types";

/**
 * KI VÁLASZTHATÓ AKVÁRIUM-KARBANTARTÓNAK.
 *
 * Balázs kérése (2026-09-24 14:41), szó szerint: "a belsős kollégák közül
 * lehessen választani akár többet is". KÉT feltétel, és egyik sem
 * helyettesíti a másikat -- ugyanaz a szerkezet, mint a
 * `common/service-assignment.ts` `assignableUserWhere()`-jénél: a szerep
 * TÍPUS-szintű tény (belsős-e, van-e joga az akváriumhoz), a PARTNER-KÖTÉS
 * viszont a SOR tulajdonsága (`customerId`, `supplierId`).
 *
 * SZÁNDÉKOSAN NEM AZ `assignableUserWhere()` ÚJRAFELHASZNÁLÁSA. Az a
 * függvény a SZERVIZ-MUNKA kiosztását fedi (`service.manage`), ez pedig az
 * akvárium-karbantartást (`aquariums.manage`) -- két külön jog, két külön
 * kérdés. Ha egyszer a két lista egybeesne, az véletlen lenne, nem
 * szabály: az `assignableUserWhere()` paraméterezése egy MÁSIK PR döntése,
 * nem ennyié.
 */
export function aquariumMaintainerUserWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    role: {
      in: [...INTERNAL_ROLES].filter((role) =>
        hasPermission(role, PERMISSIONS.AQUARIUMS_MANAGE),
      ),
    },
    customerId: null,
    supplierId: null,
  };
}
