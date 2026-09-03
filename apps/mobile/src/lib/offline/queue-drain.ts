import { describePhotoBacklog } from "./photo-queue";
import {
  canRetryState,
  classifyFailure,
  type SyncQueueRow,
} from "./sync-queue";

/**
 * A SOR KIURITESE: mi tortenjen EGY sorral, amikor van halozat.
 *
 * === MIERT KULON MODUL, ES MIERT EZ A LEGFONTOSABB FELE ===
 *
 * A rogzites ket iranyu, es a ket irany NEM egyforma sulyu:
 *
 *   a sor MEGTELIK   -> a felvitel nem veszett el. Ezt konnyu merni.
 *   a sor KIURUL     -> a felvitel tenyleg FELMENT. Ezt nehezebb, es EZ szamit.
 *
 * Egy felvitel, ami a sorban marad es sosem megy fel, a telefonon SIKERES
 * ROGZITESNEK latszik: a kollega latta, hogy elmentette, es tovabbment. A hiba
 * akkor derul ki, amikor valaki keresi az eszkozt -- napokkal kesobb, mashol.
 *
 * Ezert ez a modul a KIURULES szabalyait tartja, es a specje mind a ket iranyt
 * kulon allitassal koti le.
 */

/** Amit a sor egy soraval tenni kell, a szerver valasza utan. */
export type DrainOutcome =
  /** A szerver nyugtazta. A helyi bizonyitek TOROLHETO -- es csak ilyenkor. */
  | { type: "done" }
  /** Atmeneti hiba. A sor marad, a kiserletszam no, kesobb ujraprobalhato. */
  | { type: "retry"; attemptCount: number; lastError: string }
  /**
   * A szerver ELUTASITOTTA. A sor marad, de NEM probaljuk ujra: ember kell
   * hozza. Egy automatikus ujraprobalas itt vegtelen kort adna, es a
   * kepernyon MUNKANAK latszana.
   */
  | { type: "conflict"; lastError: string };

export interface DrainInput {
  row: Pick<SyncQueueRow, "id" | "state" | "attemptCount">;
  /** A szerver valaszanak HTTP kodja; `null`, ha el sem jutott odaig. */
  httpStatus: number | null;
  errorMessage: string | null;
}

/**
 * EGY SOR SORSA A VALASZ UTAN.
 *
 * A `null` statusz (a keres el sem jutott a szerverig) SZANDEKOSAN
 * ujraprobalhato: halozat nelkul epp ez a normalis allapot, es ha
 * konfliktuskent kezelnenk, minden offline felvitel azonnal emberi dontesre
 * varna.
 */
export function decideDrain(input: DrainInput): DrainOutcome {
  if (!canRetryState(input.row.state)) {
    /**
     * AMI NEM PROBALHATO UJRA, AZT NEM IS KULDJUK EL. A `conflict` emberre var,
     * a `syncing` mar fut. Enelkul egy masodik kiurites ujrakuldene azt, ami
     * epp uton van -- es a szerveren ket felvitel keletkezne ugyanabbol.
     */
    return { type: "conflict", lastError: "nem újrapróbálható állapot" };
  }
  if (
    input.httpStatus !== null &&
    input.httpStatus >= 200 &&
    input.httpStatus < 300
  ) {
    return { type: "done" };
  }
  if (input.httpStatus === null) {
    return {
      type: "retry",
      attemptCount: input.row.attemptCount + 1,
      lastError: input.errorMessage ?? "nem értem el a szervert",
    };
  }
  const besorolas = classifyFailure(input.httpStatus);
  if (besorolas === "conflict") {
    return {
      type: "conflict",
      lastError:
        input.errorMessage ?? `a szerver elutasította (${input.httpStatus})`,
    };
  }
  return {
    type: "retry",
    attemptCount: input.row.attemptCount + 1,
    lastError: input.errorMessage ?? `szerver hiba (${input.httpStatus})`,
  };
}

/**
 * A SOR ALLAPOTA EMBERNEK, ES EZ NEM DISZ.
 *
 * A telefonon a kollega azt latja, hogy "elmentve". Ha a sorban marad valami,
 * azt KI KELL MONDANI -- kulonben a felvitel sikeresnek latszik, es a hiba
 * napokkal kesobb, mashol derul ki.
 */
export function describeQueueState(counts: {
  pending: number;
  conflict: number;
}): string | null {
  if (counts.pending === 0 && counts.conflict === 0) return null;
  const reszek: string[] = [];
  if (counts.pending > 0)
    reszek.push(`${counts.pending} felvitel még nem ment fel`);
  if (counts.conflict > 0)
    reszek.push(
      `${counts.conflict} elakadt, mert a szerver elutasította - ezekhez döntés kell`,
    );
  return `Feltöltésre vár: ${reszek.join("; ")}.`;
}

/**
 * AMI A SORBAN ALL, EGY MONDATBAN -- ES EZ AZ, AMI EDDIG SEHOL NEM LATSZOTT.
 *
 * A `describeQueueRun` egy FUTASROL szol (mi ment fel most). Ez az ALLAPOTROL:
 * mi var meg. A ketto nem helyettesiti egymast, mert a futas utani mondat
 * eltunik, a hatralek pedig marad.
 *
 * A `pending` erteket SZANDEKOSAN nem hasznaljuk: az a rogziteseket ES a
 * kepeket EGYUTT szamolja, tehat egy "2 felvitel var" mondat melle irt "2
 * fenykep var" ugyanazt a kettot ketszer mondana. A bontott szamok pontosabbak,
 * es epp a KEP-hatralekot teszik lathatova, ami kulonben "sikeres szinkronnak"
 * latszik.
 */
export function describeQueueBacklog(counts: {
  recordings: number;
  photos: number;
  conflict: number;
}): string | null {
  const varakozo = describePhotoBacklog({
    recordings: counts.recordings,
    photos: counts.photos,
  });
  const elakadt =
    counts.conflict > 0
      ? describeQueueState({ pending: 0, conflict: counts.conflict })
      : null;
  const reszek = [varakozo, elakadt].filter((r): r is string => r !== null);
  return reszek.length > 0 ? reszek.join(" ") : null;
}

/**
 * AMI ISMETELTEN ELBUKIK -- ES EZ EDDIG SEHOL NEM LATSZOTT.
 *
 * === MIERT KULON MONDAT A HATRALEK MELLETT ===
 *
 * A hatralek azt mondja meg, MENNYI var. Ez azt, hogy valamelyik NEM CSAK VAR:
 * mar tobbszor elindult, es mindannyiszor elbukott. A ketto kozott a szerelo
 * szamara ez a kulonbseg: az elsore varni kell, a masodikkal KEZDENI kell
 * valamit -- vagy legalabb tudni rola, hogy nem magatol fog megoldodni.
 *
 * A HIBA SZOVEGET IS KIIRJUK, akkor is, ha technikai. A `last_error` mezot a
 * sor eddig is tarolta, es senki nem latta. Egy technikai mondat, amit a
 * szerelo tovabb tud adni, tobbet er, mint egy sima "nem sikerult".
 *
 * `null`, ha nincs ilyen sor -- olyankor a felulet marad csendben.
 */
export function describeRepeatedFailures(input: {
  rows: number;
  maxAttempts: number;
  lastError: string | null;
}): string | null {
  if (input.rows === 0) return null;

  const mennyi = input.rows === 1 ? "Egy felvitel" : `${input.rows} felvitel`;
  const hiba = input.lastError
    ? ` Utolsó hiba: ${input.lastError}`
    : " A hiba szövege nem maradt meg.";

  return (
    `${mennyi} már ${input.maxAttempts} alkalommal nem ment fel.` +
    hiba +
    " Ez magától nem fog megoldódni: szólj, ha ismétlődik."
  );
}
