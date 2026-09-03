import type { User } from "@acropora/database";
import type { UserDetail, UserSummary } from "@acropora/types";

/**
 * A FELHASZNALO SOR ATFORDITASA A KIADOTT ALAKRA.
 *
 * MIERT KULON FAJL ES MIERT TISZTA FUGGVENY. Ez a ket lekepezes eddig a
 * repository PRIVAT metodusa volt, tehat allitast csak ugy lehetett volna
 * tenni ra, hogy a repositoryt (es vele a Prisma klienst) peldanyositjuk. A
 * kovetkezmeny nem elmeleti: a lekepezes az EGYETLEN hely, ahol egy mezo
 * kimaradhat a valaszbol, es epp az volt merhetetlen. Ha egy mezo innen
 * kiesik, a hivo `undefined` erteket kap, a fordito hallgat (a Prisma sor
 * tobbet tud, mint a kiadott alak), es a kepernyon ures hely latszik.
 *
 * A hatara, kimondva: ez a fuggveny azt meri, MI KERUL A VALASZBA. Azt nem,
 * hogy a lekerdezes egyaltalan elhozta-e a sort -- az mas kerdes es mas helyen
 * dol el.
 */
export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    nickname: user.nickname,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    hasPassword: Boolean(user.passwordHash),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toUserDetail(user: User): UserDetail {
  return {
    ...toUserSummary(user),
    avatarUrl: user.avatarUrl ?? undefined,
    passwordUpdatedAt: user.passwordUpdatedAt?.toISOString(),
    /**
     * A `?? null` NEM DISZ: a Prisma az elhagyhato oszlopot `string | null`
     * alakban adja, a mienk viszont KOTELEZO mezo `null` ertekkel. A ketto
     * ma egybeesik, es epp ezert kell kiirni: ha a sema oldalan valaha
     * `undefined` allna itt, a mezo CSENDBEN eltunne a valaszbol.
     */
    supplierId: user.supplierId ?? null,
  };
}
