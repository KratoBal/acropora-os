/**
 * KI SZERKESZTHET EGY MUNKANAPLO-BEJEGYZEST.
 *
 * Balazs kerese, 2026-09-03, szo szerint: "Ha az nyitotta meg a bejegyzest aki
 * keszitette a munkalapot vagy a hibajegy letrehozoja, akkor lehessen
 * szerkeszteni."
 *
 * === EZ JOGOSULTSAGI SZABALY, NEM KEPERNYO-LOGIKA ===
 *
 * Ket helyen hat: a szerver ELUTASITJA az iras, a felulet pedig EL SEM MUTATJA
 * a gombot. Ha csak a feluleten allna, a vedelme latszolagos lenne -- a
 * vegpontot barki hivhatna kozvetlenul. Ezert all itt, tiszta fuggvenykent, es
 * ezert HASZNALJA MIND A KETTO ugyanezt: a szerver a beengedesnel, es ugyanez
 * adja a valaszban a `canEdit` mezot, amibol a keperno dont.
 *
 * A KEPERNYO NEM SZAMOLJA UJRA. A mobil nem huzza be a munkater csomagjait,
 * tehat egy kozos fuggvenyt nem tudna importalni -- ket masolat pedig
 * elcsuszna. Igy a szabaly EGY helyen all, a valasz pedig megmondja az
 * eredmenyet.
 *
 * === A SZERZO NEM SZEREPEL A FELTETELBEN, ES EZ SZO SZERINTI OLVASAT ===
 *
 * Balazs a lap KESZITOJET es a jegy LETREHOZOJAT nevezte meg. Ebbol az
 * kovetkezik, hogy egy bejegyzes SAJAT SZERZOJE nem feltetlenul szerkesztheti
 * a sajat bejegyzeset -- peldaul egy masik szerelo, aki a helyszinen irta. Igy
 * epult meg, mert ezt kerte; ha nem erre gondolt, egy `||` ag a kulonbseg.
 *
 * === ES A HARMADIK ESET, AMI NEM HIBA, DE KI KELL MONDANI ===
 *
 * MIND A KET AZONOSITO ELHAGYHATO a semaban (`Worksheet.createdById` SetNull,
 * `ServiceJob.openedById` idegenkulcs nelkul). Van tehat olyan lap, amit SENKI
 * nem szerkeszthet: regi sor, vagy azota torolt kollega. A felulet ezt MONDJA
 * MEG, nem elrejti -- egy hianyzo gomb magyarazat nelkul ugy nez ki, mint hiba
 * a programban.
 */

export interface WorksheetEntryEditorContext {
  /** A kero azonositoja. */
  userId: string;
  /** A munkalap keszitoje. `null`, ha ismeretlen (torolt kollega). */
  worksheetCreatedById: string | null;
  /** A mogotte allo hibajegy nyitoja. `null`, ha nincs jegy vagy ismeretlen. */
  serviceJobOpenedById: string | null;
}

export function canEditWorksheetEntry(
  context: WorksheetEntryEditorContext,
): boolean {
  /**
   * A `null` AZONOSITO SOSEM EGYEZIK, es ezt kulon ki kell mondani: egy
   * `userId === worksheetCreatedById` osszehasonlitas ket `null` erteknel
   * IGAZAT adna, ha a kero azonositoja is hianyozhatna. Ma nem hianyozhat (a
   * kero mindig bejelentkezett), de a feltetel akkor is a MEGLETRE szur, nem az
   * egyezesre -- igy egy kesobbi valtozas nem tud csendben kaput nyitni.
   */
  if (!context.userId) return false;
  return (
    context.userId === context.worksheetCreatedById ||
    context.userId === context.serviceJobOpenedById
  );
}

/**
 * MIERT NEM SZERKESZTHETO -- EMBERI MONDATBAN.
 *
 * `null`, ha szerkesztheto. A ket eset SZANDEKOSAN kulon mondatot kap: az
 * egyikben VAN kit megkerni, a masikban NINCS, es a szerelonek ez a kulonbseg
 * a teendo.
 */
export function describeEntryEditRefusal(
  context: WorksheetEntryEditorContext,
): string | null {
  if (canEditWorksheetEntry(context)) return null;
  if (!context.worksheetCreatedById && !context.serviceJobOpenedById)
    return (
      "Ezt a bejegyzést nem lehet szerkeszteni: a munkalap készítője és a hibajegy " +
      "létrehozója sem ismert (például azóta törölt kolléga). Ez nem hiba a programban."
    );
  return (
    "Ezt a bejegyzést a munkalap készítője vagy a hibajegy létrehozója tudja " +
    "szerkeszteni. Ha javítani kell rajta, szólj nekik."
  );
}
