import type { AuthenticatedUser } from "@acropora/types";

/**
 * HATOKORREL RENDELKEZO BEJELENTKEZETT FELHASZNALO, EGY HELYEN.
 *
 * === MIERT KOZOS, ES MIERT NEM `as AuthenticatedUser` MINDEN SPECBEN ===
 *
 * 2026-09-22-ig az eszkoz-szolgaltatas a KESZ hatokort (`PartnerScope`) kapta a
 * kontrollertol. Azota a USER-t kapja, es a hatokort meg a hozzarendelt
 * helyszineket maga oldja fel -- ugyanaz az alak, mint a
 * `serviceJobVisibilityFor` a hibajegyeknel. Ettol tizenharom spec epitett
 * hirtelen sajat felhasznalot.
 *
 * Ha mindegyik a sajat `{ id: "u1" } as AuthenticatedUser` alakjat irja meg, a
 * cast KIKAPCSOLJA az egyetlen ellenorzest, ami szamit: egy UJ KOTELEZO mezo
 * (mint a `customerId`, ami szandekosan nem elhagyhato) egyik masolatban sem
 * pirosodna ki. Tizenharom kulon-kulon helyes dupla, es a hivo megis mast kap,
 * mint amit hasznal.
 *
 * EZERT NINCS ITT CAST. A visszateresi tipus a valodi szerzodes, tehat egy uj
 * kotelezo mezo ITT all meg, egy helyen -- es nem a kepernyon.
 *
 * === A HAROM ALAK A HAROM HATOKORT FEDI ===
 *
 * A `partnerScopeOf` harom agat (`internal`, `customer`, `supplier`) a mezok
 * ketto-ketto kombinacioja donti el. A nevesitett alakok azert kellenek, hogy a
 * specekben ne egy `customerId: null` sor MELLEKHATASAkent alljon elo a belsos
 * hatokor -- ott az olvaso nem latna, hogy az szandek volt.
 */
function alap(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: "user-teszt",
    email: "teszt@acropora.hu",
    displayName: "Teszt Felhasználó",
    role: "ADMIN",
    customerId: null,
    supplierId: null,
    ...overrides,
  };
}

/** Sajat kollega: mindent lat, a hozzarendelt helyszinek nem szamitanak. */
export function belsosUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return alap({ role: "ADMIN", ...overrides });
}

/** Partner-oldali fiok egy VEVO nevében. */
export function vevoUser(
  customerId: string,
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return alap({
    id: `user-${customerId}`,
    role: "PARTNER_SERVICE",
    customerId,
    ...overrides,
  });
}

/** Partner-oldali fiok egy SZALLITO nevében. */
export function szallitoUser(
  supplierId: string,
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return alap({
    id: `user-${supplierId}`,
    role: "PARTNER_SERVICE",
    supplierId,
    ...overrides,
  });
}
