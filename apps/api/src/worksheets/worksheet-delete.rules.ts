/**
 * AZ ÖNÁLLÓ, NEM LEZÁRT MUNKALAP VÉGLEGES TÖRLÉSÉNEK SZABÁLYA (a hibajegy-törlés 2. szelete; Balázs 2026-11-18; acrobot 55770). Tiszta függvények, mint a jegy-törlés szabálya
 * (`service-jobs/service-job-delete.rules.ts`): tiltás-mondat vagy `null`, és figyelmeztetések.
 *
 * Csak a jegyhez NEM tartozó lap törölhető innen: a jegy alatti lapot a jegy törlése viszi (az 1. szelet), vagy előbb le kell választani, hogy a jegy naplója ne maradjon
 * lyukas. Nem törölhető az aláírt, a lezárt (számozott), az ügyfélnek átadott lap; az a lap, amit egy másik lap folytat; és ahol az anyagigény a beszerzésig jutott vagy készletmozgás
 * kötődik hozzá (a készlet nem tűnhet el csendben, acrobot 55770).
 */
export interface WorksheetDeleteFacts {
  /** Hibajegy alatt áll (a `serviceJobId` nem üres). */
  hasServiceJob: boolean;
  /** A lezárt lap teljes száma; a piszkozatnak nincs. */
  number: string | null;
  handedOver: boolean;
  /** Valamelyik verziója aláírt. */
  signed: boolean;
  /** A legutóbbi verziója aláírásra vár. */
  awaitingSignature: boolean;
  /** Egy másik lap folytatja. */
  continuedByOther: boolean;
  procuredMaterialRequests: number;
  stockMovements: number;
}

export function worksheetDeleteRefusal(
  facts: WorksheetDeleteFacts,
): string | null {
  if (facts.hasServiceJob)
    return "Ez a munkalap hibajegyhez tartozik: előbb le kell választani a jegyről, vagy a jegyet kell törölni.";
  if (facts.signed) return "Aláírt munkalap nem törölhető.";
  if (facts.number !== null)
    return "Lezárt (számozott) munkalap nem törölhető.";
  if (facts.handedOver) return "Az ügyfélnek átadott munkalap nem törölhető.";
  if (facts.continuedByOther)
    return "Ezt a munkalapot egy másik munkalap folytatja, ezért nem törölhető.";
  if (facts.procuredMaterialRequests > 0)
    return "A munkalaphoz tartozó anyagigény már a beszerzésig jutott, ezért nem törölhető.";
  if (facts.stockMovements > 0)
    return "A munkalaphoz készletmozgás tartozik, ezért nem törölhető: a készlet nem tűnhet el csendben.";
  return null;
}

export function worksheetDeleteWarnings(facts: WorksheetDeleteFacts): string[] {
  return facts.awaitingSignature
    ? ["A munkalap aláírásra vár: az ügyfél aláírási hivatkozása megszűnik."]
    : [];
}
