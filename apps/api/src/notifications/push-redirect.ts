/**
 * A PUSH-ATIRANYITAS -- MINDEN ERTESITES EGY MEGADOTT FELHASZNALO(K)
 * ESZKOZEIRE MEGY A VALODI CIMZETTEK HELYETT.
 *
 * Balazs kerese, 2026-09-25 21:03 UTC (emlek 1842), a teszt szerverre: "a push
 * CSAK az o telefonjara" -- ugyanaz a szukseglet, mint a levelnel
 * (`ticket-mail.rules.ts` `mailRedirect`), csak a push-ut MAS adatot iranyit
 * at: nem egy cimet, hanem FELHASZNALO-AZONOSITOKAT, mert a kuldes innentol
 * az O ESZKOZEIT keresi meg, nem egy uj celpontot allit be.
 *
 * KULON FUGGVENY, NEM A MAIL-REDIRECT UJRAHASZNOSITASA: a ket ut kulonbozo
 * adatot hordoz (email cim kontra felhasznalo-azonosito), es egy kozos
 * fuggveny vagy az egyiket hamis tipusra kenyszeritene, vagy egy union-t
 * vezetne be, amit egyik hivo sem kerne teljes egeszeben.
 */
export type PushRedirect =
  | { readonly kind: "off" }
  | { readonly kind: "on"; readonly userIds: readonly string[] };

/**
 * A HIANYZO ERTEK "off"-OT AD, NEM DOB.
 *
 * === MIERT MAS EZ, MINT A LEVEL-ATIRANYITAS HARMADIK ALLAPOTA ===
 *
 * A `mailRedirect` hianyzo erteknel `block`-ot ad, es a hivo (`RedirectingMailSender`)
 * DOB, mert egy level KIKULDESE VISSZAFORDITHATATLAN -- a "nem tudjuk, hova
 * menne" alapertelmezese nem lehet a valodi cimzett.
 *
 * A push MAS: egy el nem kuldott ertesites ELVESZ, de nem jelenik meg
 * SENKINEL rossz helyen -- a `NotificationsService.deliver()` MA IS igy
 * viselkedik, ha egyik push-ut sincs beallitva (lasd a `routes.length === 0`
 * agat). A hianyzo ertek tehat ugyanazt jelenti, mint eddig: a MAI, valodi
 * cimzetteknek szolo viselkedes, mert elesben ez a valtozo SOHA nincs
 * beallitva.
 */
export function pushRedirect(raw: string | undefined | null): PushRedirect {
  const userIds = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return userIds.length === 0 ? { kind: "off" } : { kind: "on", userIds };
}

export const NOTIFICATIONS_ENV = Symbol("NOTIFICATIONS_ENV");
