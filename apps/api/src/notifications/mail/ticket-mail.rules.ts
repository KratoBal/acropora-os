/**
 * KINEK MEGY LEVEL A HIBAJEGYROL, ES MIKOR NEM -- TISZTA FUGGVENYEKBEN.
 *
 * Balazs dontese, 2026-09-21 11:25:35 UTC (Discord, fo csatorna, message_id
 * 1551554987992289302), szo szerint: "igen ertesitsuk, de a ticket@acropora.hu
 * cimet hasznaljuk".
 *
 * EZ A MODUL SEMMIT NEM IMPORTAL, es ez nem esztetika: a kuldes dontese igy
 * merheto adatbazis es halozat nelkul, es a Gmail letezeserol nem tud semmit.
 */

/**
 * A KAPU. ALAPERTELMEZESBEN ZARVA, ES NEM A TITKOK HIANYARA BIZZUK.
 *
 * acrobot elso kikotese (2026-09-21): a kuldes SOHA ne menjen ki tesztbol vagy
 * stagingbol valodi cimre. Kezenfekvo lenne azt mondani, hogy a hitelesito
 * adatok hianya amugy is megvedi -- DE azok egy staging kornyezetbe konnyen
 * atmasolodnak, es akkor az a vedelem CSENDBEN elesik. Egy kimondott kapcsolo
 * nem masolodik at veletlenul.
 *
 * AZ ISMERETLEN ERTEK ZARVA. Nem csak a hianyzo: egy elgepelt "liv" vagy egy
 * orokolt "true" NE nyisson kaput. A megengedo irany itt visszavonhatatlan
 * (a level a vevonel jelenik meg), a szigoru irany pedig hangos: valaki szol,
 * hogy nem ment ki a level.
 */
export type MailMode = "off" | "live";

export function mailModeOf(raw: string | undefined | null): MailMode {
  return raw?.trim().toLowerCase() === "live" ? "live" : "off";
}

/**
 * A NYITO, AKINEK A LEVEL SZOL.
 *
 * NEGY KIMENET VAN, NEM KETTO, es ezt merni kellett (nautilus, 2026-09-21):
 *
 *   openedById null           regi sorok: a migracio a keletkezes esemenyebol
 *                             toltott, es ott az aktor mar lehetett `null`
 *   openedById all, User NINCS  az `openedById`-n SZANDEKOSAN NINCS
 *                             IDEGENKULCS (lasd a sema fejlecet: egy torolt
 *                             kollega jegye igy is megtartja a nyitojat).
 *                             Tehat az azonosito mutathat NEM LETEZO sorra, es
 *                             ezt semmilyen adatbazis-megkotes nem zarja ki.
 *   a User INAKTIV            acrobot dontese: NEM kuldunk. Egy kilepett
 *                             kollega cimere kuldott level rosszabb a
 *                             hallgatasnal.
 *   van User es cim           kuldes. A `User.email` KOTELEZO es egyedi, tehat
 *                             ha a sor letezik, cim is van.
 *
 * A HAROM KIHAGYAS HAROM KULON OK, NEM EGY. acrobot kikotese: a kihagyas ne
 * legyen nema, es ne ugyanaz az ag legyen, mint a sikeres kuldes. Kulonben az
 * elso kerdesre ("miert nem kapott levelet?") megint csak annyit tudunk
 * mondani, hogy nem tudjuk.
 */
export interface TicketOpener {
  readonly email: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

export type MailSkipReason =
  "mode-off" | "no-opener" | "opener-missing" | "opener-inactive";

export type MailDecision =
  | { readonly kind: "send"; readonly to: string; readonly name: string }
  | { readonly kind: "skip"; readonly reason: MailSkipReason };

/**
 * A KAPU ALL ELOL, MINDEN MAS ELOTT.
 *
 * Nem sorrendi izles: ha a cimzett-feloldas futna eloszor, egy zart kapu
 * melletti futas is "nincs kinek" okot adna -- es az a naploban ugy nezne ki,
 * mintha a jegyen lenne a baj, nem a kornyezeten.
 */
/**
 * UGYFEL NYITOTT JEGYET -- MEHET-E LEVEL, ES KINEK.
 *
 * KULON DONTES A NYITO-ERTESITES MELLETT, es nem ugyanaz mas cimzettel:
 *
 *   a nyito-ertesites   EGY cimzettet ismer, es a jegyrol vezet hozza
 *                       (`openedById` -> `opener`)
 *   ez                  TOBB cimzett, es a SZEREPBOL jon, nem a jegyrol
 *
 * AMI KOZOS: a `mode` kapu. Az ugyanaz a kornyezeti allapot, es szandekosan
 * ELOL all mind a kettonel -- ha a levelezes ki van kapcsolva, a cimzettek
 * lekerdezese is fölösleges munka lenne.
 *
 * AZ URES CIMZETT-LISTA SAJAT OK, nem „mode-off": a kulonbseg az, hogy az
 * elsot a kornyezet okozza, a masodikat az, hogy SENKINEL nincs bejelolve a
 * szerep. A masodik a felhasznalonak szol es javithato a beallitasokban; az
 * elso nem.
 */
export type ServiceJobOpenedMailDecision =
  | { readonly kind: "send"; readonly to: readonly string[] }
  | { readonly kind: "skip"; readonly reason: "mode-off" | "no-recipient" };

export function serviceJobOpenedMailDecision(input: {
  mode: MailMode;
  recipients: readonly { readonly email: string }[];
}): ServiceJobOpenedMailDecision {
  if (input.mode !== "live") return { kind: "skip", reason: "mode-off" };
  const cimek = input.recipients
    .map((cimzett) => cimzett.email.trim())
    .filter((email) => email.length > 0);
  if (cimek.length === 0) return { kind: "skip", reason: "no-recipient" };
  return { kind: "send", to: cimek };
}

export function ticketMailDecision(input: {
  mode: MailMode;
  openedById: string | null;
  opener: TicketOpener | null;
}): MailDecision {
  if (input.mode !== "live") return { kind: "skip", reason: "mode-off" };
  if (input.openedById === null) return { kind: "skip", reason: "no-opener" };
  if (input.opener === null) return { kind: "skip", reason: "opener-missing" };
  if (!input.opener.isActive)
    return { kind: "skip", reason: "opener-inactive" };
  return {
    kind: "send",
    to: input.opener.email,
    name: input.opener.displayName,
  };
}

/**
 * MIT MONDUNK A NAPLONAK, ES MIT NEM.
 *
 * A NAPLO-SOR CIMET NEM TARTALMAZ, CSAK A TENYT ES A DARABSZAMOT.
 *
 * AZ INDOK, ES EZ NEM AVUL EL: egy cim, ami egyszer bekerul egy naplo
 * SZOVEGEBE, onnantol minden jovobeli feluletnel egyutt utazik, es senki nem
 * fogja megkerdezni, szabad-e kiirni. A dontes tehat nem azon all, hogy MA
 * kimegy-e a naplo-sor a partnernek, hanem azon, hogy egy szovegbe irt cimet
 * kesobb mar nem lehet visszavenni.
 *
 * === AMI EBBOL A BEKEZDESBOL ELAVULT (visszamerve 2026-09-21 este) ===
 *
 * Itt korabban az allt, hogy a `/service/jobs/{id}` valasza SZO SZERINT
 * ugyanaz a partnernek es a belsos felhasznalonak (az fb945858 kartya
 * meresebol). Az a meres a sajat napjan igaz volt; MA MAR NEM AZ, es
 * ugyanazon a napon valt hamissa:
 *
 *   a reszletlap   `detail` a belsosnek a belso alakot adja, a partnernek
 *                  `partnerServiceJobDetail(belso)` alakot, es abbol a naplo-sor
 *                  MEGJEGYZESE (`note`) hianyzik. Balazs dontese, 2026-09-21
 *                  10:5x: "a megjegyzes nem kell a nev igen".
 *   a csomag       ugyanez: a megjegyzes a `scope.kind === "internal"`
 *                  kapcsolon all (`service-job-package.service.ts`).
 *
 * A HIVATKOZOTT TENY VALTOZOTT MEG, NEM A DONTES. Azert all itt mind a ketto,
 * mert egy kijelento alaku komment datum nelkul masnap is ugyanolyan
 * magabiztosan nez ki -- pontosan ez tortent ezzel a bekezdessel.
 */
export function mailAuditNote(decision: MailDecision): string {
  return decision.kind === "send"
    ? "Értesítő levél kiküldve a hibajegy nyitójának."
    : `Értesítő levél nem ment ki (${decision.reason}).`;
}
