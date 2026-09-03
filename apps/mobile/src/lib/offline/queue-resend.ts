/**
 * EGY ELAKADT FELVITEL JAVITASA ES UJRAKULDESE.
 *
 * === MI A BAJ MA, ES MIERT EZ AZ ELSO LEPES ===
 *
 * Egy `conflict` allapotu sornak MA NINCS KIJARATA. A szerelo latja a
 * sorban, olvassa a hibauzenetet, es nem tud vele csinalni semmit: a sor ott
 * marad a keszuleken, a szamlalo eg, es a kovetkezo kiuriteskor sem indul el
 * (helyesen -- ugyanaz a keres ugyanazt a valaszt kapna).
 *
 * KET KIJARAT LEHETSEGES, es a sorrendjuk NEM izles kerdese (acrobot dontese,
 * 2026-09-03): eloszor a JAVITAS ES UJRAKULDES, es csak azutan az ELVETES.
 * Ha az elvetes keszulne el eloszor, a keperno EGYETLEN gombja az lenne, hogy
 * a szerelo eldobja a sajat munkajat -- es a helyszinen siető ember meg is
 * nyomna, mert az van ott. A beirt adat NEMAN veszne el: a sor kiurul, a
 * keperno zold, es a munkalapon egyszeruen nem lesz ott, amit felvettek.
 * A forditott sorrendben a rosszabbik eset az, hogy egy utkozes BENT RAGAD,
 * amig az elvetes is meglesz -- az viszont LATHATO, es szolni fognak rola.
 *
 * === A MUVELET-AZONOSITO MEGMARAD, ES EZ MERVE VAN ===
 *
 * A sor kulcsa (`operationId`, egyben a szerver `clientOperationId` mezoje)
 * NEM valtozik a javitastol. Merve a szerveren 2026-09-03: a
 * `clientOperationId`-t a szerver CSAK SIKERES beszurasnal rogziti, es a
 * sajat kommentje ki is mondja, hogy egy matricakod-utkozes VALODI hiba,
 * nem idempotencia-talalat. Egy 409 utan tehat SEMMI nem jott letre, es a
 * kulcs szabad.
 *
 * AMIT EZ MEGNYER: a javitas nem torol sort, tehat NEM fugg az elvetestol --
 * a ket szelet fuggetlen. Es ha maga az ujrakuldes szakad meg, a
 * duplikacio-vedelem tovabbra is all. Uj kulcs TISZTABBNAK latszana, es
 * pontosan ezt a ket dolgot venne el.
 *
 * === A HATAR, AMI SZANDEKOS, ES AMEDDIG TART ===
 *
 * Ez a valtozat CSAK az ESZKOZ-felvitelt engedi javitani. Az indok nem
 * kenyelem: a valodi utkozes ott keletkezik (matricakod-utkozes, a szerver
 * szandekosan 409-cel valaszol ra). A MUNKALAP-felvitel ugyanugy elakadhat,
 * es addig lathato marad, de nem feloldhato.
 *
 * EZ NEM HIANY, HANEM IDOZITETT HATAR, es azert all itt kiirva, hogy a
 * kovetkezo olvaso ne hianynak nezze es ne irja meg megegyszer. Akkor esik ki,
 * amikor a munkalap-felvitel is kap szerkesztot -- vagy amikor kiderul, hogy
 * ott a gyakorlatban nem keletkezik utkozes, es akkor ez a sor marad, de az
 * indoka valtozik.
 *
 * A tipusok SAJAT, szerkezeti alakok: ez a fajl a teszt-forditasba is bekerul,
 * az pedig nem ismeri az `@/` aliast.
 */

/** Amennyit egy sorbol ez a modul olvas. */
export interface ResendableRowLike {
  state: string;
  operation: string;
  entityType: string;
}

export type QueueResendRefusal =
  /** Nem elakadt sor: nincs mit feloldani rajta. */
  | "not-conflicted"
  /** Fenykep-sor: nincs szerkesztheto torzse. */
  | "not-a-create"
  /** Munkalap: a fenti idozitett hatar. */
  | "unsupported-entity";

export type QueueResendEligibility =
  { ok: true } | { ok: false; reason: QueueResendRefusal; message: string };

export function queueResendEligibility(
  row: ResendableRowLike,
): QueueResendEligibility {
  /**
   * A SORREND SZANDEKOS: eloszor az allapot, azutan a fajta.
   *
   * Egy VARAKOZO fenykep-sorrol ne azt mondjuk, hogy "nincs szerkesztheto
   * torzse" -- az igaz, de nem az a baja: egyszeruen meg el sem indult. Az
   * elso mondat, amit a szerelo lat, arrol szoljon, ami MOST all fenn.
   */
  if (row.state !== "conflict")
    return {
      ok: false,
      reason: "not-conflicted",
      message: "Ez a felvitel nem akadt el: nincs mit javítani rajta.",
    };

  if (row.operation !== "create")
    return {
      ok: false,
      reason: "not-a-create",
      message:
        "Ez egy fénykép, nincs mit átírni rajta. A képet a rögzítés után lehet újra feltölteni.",
    };

  if (row.entityType !== "asset")
    return {
      ok: false,
      reason: "unsupported-entity",
      message:
        "Ezt a felvitelt egyelőre csak az irodából lehet feloldani. Szándékos szűkítés: ma az eszköz-felvitel javítható a telefonon.",
    };

  return { ok: true };
}

/** Amit az ujrakuldes a soron megvaltoztat. */
export interface QueueResendPatch {
  payloadJson: string;
  state: "pending";
  attemptCount: 0;
  lastError: null;
}

/**
 * A JAVITOTT SOR ALLAPOTA.
 *
 * A KISERLETSZAM NULLAZODIK, es ez nem kozombos: a sor a szerver-hibak miatt
 * MAR GYUJTOTT kiserleteket, es ha azok megmaradnanak, a javitott felvitel
 * egy-ket probalkozas utan azonnal a megallasi hatarba futna -- ugy, hogy
 * kozben MAS torzset kuld, mint amivel a hibak keletkeztek. Az uj torzs uj
 * felvitel a szerver szemszogebol; a regi kiserletek rola semmit nem mondanak.
 *
 * A HIBAUZENET IS TORLODIK, ugyanabbol az okbol: egy megmarado `lastError` a
 * kepernyon a REGI bukast magyarazna egy MAR ATIRT sor mellett.
 *
 * A KULCS (`id`) NEM SZEREPEL ITT, es ez a lenyeg -- lasd a fejlecet.
 */
export function queueResendPatch(payloadJson: string): QueueResendPatch {
  return {
    payloadJson,
    state: "pending",
    attemptCount: 0,
    lastError: null,
  };
}
