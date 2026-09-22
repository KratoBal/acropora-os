import type { PartnerScope } from "../auth/partner-scope.util.js";

/**
 * MI LEGYEN A VALASZ EGY BEOLVASOTT MATRICAKODRA -- TISZTA FUGGVENYBEN.
 *
 * HAROM VILAG-ALLAPOT VAN, ES CSAK KETTO KAP KULON VALASZT:
 *
 *     a kod egy LATHATO eszkozon all   -> az eszkoz
 *     a kod SZABAD (kiadott, de nincs  -> kulon valasz, DE csak annak, aki
 *       eszkozhoz rendelve)               belso hatokoru ES irhat
 *     minden mas                       -> "nincs ilyen", egyetlen alakban
 *
 * A HARMADIK SOR A LENYEG, ES NEM EGYSZERUSITES. Egyben fedi azt, hogy a kod
 * NEM LETEZIK, es azt, hogy LETEZIK, de a hivo nem lathatja az eszkozt. Ha a
 * ketto kulonbozne, a matricakod LETEZES-TESZT lenne idegen eszkozokre: egy
 * betu es negy szam, 260 ezer lehetoseg, vegigprobalhato.
 *
 * === MIERT NEM ELEG A JOGOSULTSAG A SZABAD VALASZHOZ ===
 *
 * A szabad keszlet LISTAJA (`GET labels/free`) SETTINGS_MANAGE moge van zarva,
 * es a sajat kommentje kimondja, miert: aki latja, az latja, mely kodok
 * leteznek, es pont ez az az adat, amibol egy vegigprobalas indul. Egy
 * "ez a kod szabad" valasz ugyanannak az adatnak az EGYENKENTI lekerdezese.
 *
 * ES A SZEREP-TABLA MERESE DONTOTTE EL, hogy a hatokor is kell (2026-09-22):
 *
 *     SERVICE           service.manage: IGEN
 *     PARTNER_SERVICE   service.manage: IGEN    <- partner-hatokoru szerep
 *
 * A `PARTNER_SERVICE` PARTNER felhasznaloe, es VAN irasi joga. Ha a szabad
 * valasz csak a jogon allna, egy partner vegigprobalhatna a MI
 * matrica-keszletunket. Ezert all itt KET feltetel, es nem egy.
 *
 * AMIT EZ ELVESZ: partner-hatokoru felhasznalonak a szabad kod ugy nez ki,
 * mint egy ismeretlen kod. Ez szandekos -- a szabad matrica a mi keszletunk --,
 * es ha valaha kell nekik, az KULON dontes.
 *
 * A KET IRANY ARA NEM EGYFORMA: egy tul szuk valasz HANGOS (valaki keri, es egy
 * sorral feloldhato), egy tul bo valasz NEMA (a keszlet szivarog, es senki nem
 * veszi eszre).
 */
export type ScanLabelOutcome =
  { kind: "ASSET" } | { kind: "FREE" } | { kind: "NOT_FOUND" };

export function scanLabelOutcome(input: {
  /** Latott-e a hivo eszkozt ezzel a koddal. A hatokort a lekerdezes mar alkalmazta. */
  visibleAsset: boolean;
  /** Letezik-e KIADOTT, de eszkozhoz NEM rendelt matrica ezzel a koddal. */
  freeLabel: boolean;
  scope: PartnerScope;
  /** `service.manage` -- a FEL 2 mindket aga IR, tehat enelkul a valasz hasztalan. */
  canManage: boolean;
}): ScanLabelOutcome {
  if (input.visibleAsset) return { kind: "ASSET" };
  if (input.freeLabel && input.scope.kind === "internal" && input.canManage)
    return { kind: "FREE" };
  return { kind: "NOT_FOUND" };
}
