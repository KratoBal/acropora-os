/**
 * A LEZART HIBAJEGY KIKULDESE: KI KAPJA MEG.
 *
 * Balazs specje, 2026-09-18 11:29 UTC, szo szerint: az elkuld gomb "elkuldi a
 * HELYSZINT BIRTOKLOKNAK emailben".
 *
 * === A LANC, MERVE (nem levezetve), main=234b91cc ===
 *
 *     ServiceJob.departmentId -> WorksheetDepartment.customerId -> Customer
 *     Customer <- User.customerId   (relacio: "CustomerPortalUser")
 *
 * A "helyszin" a munkalap-alegyseg (`WorksheetDepartment`), es a birtokosa az
 * a vevo, akihez az alegyseg tartozik. A cimzettek ennek a vevonek az AKTIV
 * portal-fiokjai.
 *
 * === ES AMI AGGALY VOLT, DE NEM AZ: A SZERVIZ PARTNER Supplier ===
 *
 * A `Supplier.customerId` egyedi mezo, a relacio neve "PartnerWorksheetMirror",
 * es a sema sajat kommentje mondja ki: "The customer row that carries this
 * partner's worksheets". A partnernek TUKOR-VEVO sora van, es az alegyseg arra
 * mutat -- tehat a lanc partner-jegyen is vegigmegy, nem szakad meg.
 *
 * === MIERT KULON FUGGVENY, ES NEM A MEGLEVO `customerContacts` ===
 *
 * Az a lekerdezes (`WorksheetsRepository.customerContacts`) UGYANEZT a kort
 * adja, de `id` es `displayName` mezovel -- CIM NELKUL, mert az alairo-valaszto
 * nem kuld levelet. A cim felvetele oda azt jelentene, hogy egy valaszto-lista
 * vegpontja e-mail cimeket kezd szallitani a portalra. Ezert all itt kulon
 * szabaly, es a lekerdezes is kulon: a ket felulet MAS adatot lat, szandekosan.
 */

/** Egy jelolt cimzett, ugy, ahogy az adatbazisbol jon. */
export interface HandoverRecipient {
  readonly email: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

export type HandoverMailSkipReason =
  "mode-off" | "no-department" | "no-customer" | "no-recipient";

export type HandoverMailDecision =
  | {
      readonly kind: "send";
      readonly to: readonly { readonly email: string; readonly name: string }[];
    }
  | { readonly kind: "skip"; readonly reason: HandoverMailSkipReason };

/**
 * A KAPU ALL ELOL, MINDEN MAS ELOTT -- ugyanaz a sorrend, mint a szomszed
 * `ticketMailDecision`-ben, es ugyanabbol az okbol: ha a cimzett-feloldas
 * futna eloszor, egy zart kapu melletti futas is "nincs kinek" okot adna, es
 * az a naploban ugy nezne ki, mintha a JEGYEN lenne a baj, nem a kornyezeten.
 *
 * A NEGY KIHAGYASI OK NEGY KULON SOR, NEM EGY. Mindegyikhez MAS a teendo:
 *
 *     mode-off        a kapcsolo zarva      -> uzemeltetes
 *     no-department   a jegyen nincs helyszin -> a jegy adata hianyos
 *     no-customer     a helyszinnek nincs gazdaja -> torzsadat-hiba
 *     no-recipient    a gazdanak nincs AKTIV portal-fiokja -> a vevonel
 *                     nincs kinek kikuldeni, es ez NEM a mi hibank
 *
 * Egy kozos "nem ment ki" ok mind a negyre raillene, es az elso kerdesre
 * ("miert nem kapott levelet?") megint csak annyit tudnank mondani, hogy nem
 * tudjuk.
 */
export function handoverMailDecision(input: {
  mode: "off" | "live";
  departmentId: string | null;
  customerId: string | null;
  recipients: readonly HandoverRecipient[];
}): HandoverMailDecision {
  if (input.mode !== "live") return { kind: "skip", reason: "mode-off" };
  if (input.departmentId === null)
    return { kind: "skip", reason: "no-department" };
  if (input.customerId === null) return { kind: "skip", reason: "no-customer" };

  /*
    AZ AKTIV SZURES ITT ALL, NEM A LEKERDEZESBEN -- ES EZ SZANDEKOS.

    Igy a szabaly MEGMERHETO egy inaktiv fiokot tartalmazo bemeneten, adatbazis
    nelkul. Ha a szures a `where` zaradekban allna, a viselkedesre CSAK eles
    adaton lehetne allitast tenni, es a Postgres-fuggo blokk helyben kimarad.
  */
  const elok = input.recipients.filter((jelolt) => jelolt.isActive);
  /*
    EZ AZ ELSO RETEG AZ URES CIMZETT-LISTA ELLEN, es ELOSZOR EZ SZOLAL MEG.

    A MASODIK a `buildMimeMessage`-ben all (`MAIL_NO_RECIPIENT`). A ketto NEM
    ugyanaz ketszer: ez a HELYES OKOT adja ("ennek a vevonek nincs aktiv
    portal-fiokja"), a masik azt zarja ki, hogy egy jovobeli hivo megkerulje.
    A reszletes bontas a `mime.ts` megfelelo pontjan all.
  */
  if (elok.length === 0) return { kind: "skip", reason: "no-recipient" };

  return {
    kind: "send",
    to: elok.map((jelolt) => ({
      email: jelolt.email,
      name: jelolt.displayName,
    })),
  };
}

/**
 * MIT MOND A NAPLO, ES MIT NEM.
 *
 * A SZOMSZED `mailAuditNote` CIMET NEM IR KI, csak a tenyt, es ez a fuggveny
 * ugyanazt a dontest koveti. AZ INDOK VISZONT NEM AZ, AMIT ELOSZOR IDE IRTAM.
 *
 * Atvettem az fb945858 mereset ("a valasz szo szerint ugyanaz a partnernek es
 * a belsosnek"), es UGYANAZON A NAPON mar nem volt igaz: a
 * `partnerServiceJobDetail` sajat alakot vetit, amiben a `note` NINCS benne.
 * Visszamerve 2026-09-22-en, a fo agon.
 *
 * A HELYES INDOK: ennek a mezonek a lathatosaga egy nap alatt KETSZER
 * valtozott. Egy cim, ami egyszer bekerul egy naplo szovegebe, onnantol
 * minden jovobeli feluletnel egyutt utazik -- fuggetlenul attol, hogy ma
 * melyik alak megy ki.
 *
 * AMI ITT TOBB: a DARABSZAM. Egy cim nem kerul be, de az, hogy HANY cimzettnek
 * ment ki, a partnernek is a sajat kore -- es enelkul a "kiment" sor nem
 * kulonboztetne meg az egy cimzettet a ottol.
 *
 * ACROBOT AZT KERTE, hogy legyen megmondhato, "kinek mit kuldtunk ki". A
 * cimzettek CIMET ez a sor szandekosan nem viszi: az a kerdes nyitva all a
 * kartyan, mert egy masik, mar meghozott dontesbe utkozik.
 */
export function handoverMailAuditNote(decision: HandoverMailDecision): string {
  if (decision.kind === "skip")
    return `A lezárt hibajegy nem ment ki e-mailben (${decision.reason}).`;
  return `A lezárt hibajegy kiküldve e-mailben, ${decision.to.length} címzettnek.`;
}
