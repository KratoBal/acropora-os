/**
 * EGY ELAKADT FELVITEL ELVETESE.
 *
 * === A MASODIK KIJARAT, ES SZANDEKOSAN A MASODIK ===
 *
 * A javitas es ujrakuldes elobb keszult el, es nem veletlenul: ha az elvetes
 * allt volna egyedul a kepernyon, a szerelo EGYETLEN gombja az lett volna,
 * hogy eldobja a sajat munkajat -- es a helyszinen siető ember meg is nyomta
 * volna, mert az van ott.
 *
 * === A SOR NEM TORLODIK, ES EZ A LENYEG ===
 *
 * Az elvetes ALLAPOTOT ir, nem sort torol. Ha egy sor egyszeruen eltunne a
 * listarol, az kivulrol MEGKULONBOZTETHETETLEN attol, mintha sikeresen kiment
 * volna: ugyanaz a felvitel hianyzik a szerverrol, es senki nem tudna
 * megmondani, hogy elvetettek-e vagy elveszett. Az allapot MAGA a nyom.
 *
 * === A MEGEROSITES MEGNEVEZI, MI VESZ EL ===
 *
 * Nem "biztos vagy benne?", hanem MELYIK felvitel es MI van benne. Egy
 * megerosites, ami nem nevezi meg a tartalmat, ugyanaz a nema veszteseg, csak
 * egy kattintassal tobb -- a kez ugyanaz, a masodperc ugyanaz.
 *
 * A tipusok SAJAT, szerkezeti alakok: ez a fajl a teszt-forditasba is bekerul.
 */

import type { SyncOperation } from "./sync-queue";

export interface DiscardableRowLike {
  state: string;
}

export type QueueDiscardEligibility =
  { ok: true } | { ok: false; message: string };

/**
 * CSAK AZ ELAKADT SOR VETHETO EL.
 *
 * Egy varakozo sor MEG UTON VAN: azt nem elvetni kell, hanem megvarni. Egy
 * megallt sor a SZERVER hibaja, es ott az ujraprobalas a teendo. Az elvetes
 * arra valo, amirol a szerver MAR dontott, es nemet mondott.
 */
export function queueDiscardEligibility(
  row: DiscardableRowLike,
): QueueDiscardEligibility {
  if (row.state === "discarded")
    return { ok: false, message: "Ezt a felvitelt már elvetetted." };
  if (row.state !== "conflict")
    return {
      ok: false,
      message:
        "Ez a felvitel nem akadt el, ezért nem lehet elvetni: vagy még úton van, vagy a szerverre kell várni.",
    };
  return { ok: true };
}

export interface QueueDiscardConfirmation {
  title: string;
  message: string;
  confirmLabel: string;
}

/**
 * A MEGEROSITES SZOVEGE, ES MIERT A TISZTA MODULBAN.
 *
 * Ez az utolso hely, ahol a szerelo elolvashatja, MIT dob el. A szoveg tehat
 * nem diszites, hanem maga a vedelem -- es a kepernyo torzseben semmi nem
 * merne, hogy tenyleg megnevezi-e a tartalmat.
 */
export function queueDiscardConfirmation(input: {
  /** „Eszköz", „Munkalap", „Fénykép" vagy „Eszköz módosítás" -- a `describeQueueEntry` adja. */
  kind: string;
  /** A neve vagy a targya, ugyanonnan. */
  title: string;
  /**
   * MI EZ A SOR: felvitel, modositas vagy kep.
   *
   * AZ ELVETES KOVETKEZMENYE MUVELETENKENT MAS, ES A KULONBSEG NEM ARNYALAT.
   * Egy felvitelnel a rekord SOHA nem fog letezni a szerveren; egy
   * modositasnal a rekord OTT VAN, es a JAVITAS nem megy fel. A ket mondat
   * MASROL szol, es a szerelo epp ebbol donti el, hogy elveti-e.
   */
  operation: SyncOperation;
}): QueueDiscardConfirmation {
  const szoveg = ELVETES_KOVETKEZMENYE[input.operation];
  return {
    title: szoveg.title,
    message:
      `${input.kind}: ${input.title}. ` +
      szoveg.body +
      " A listán elvetettként marad meg, hogy látszódjon, mi történt vele.",
    confirmLabel: "Elvetem",
  };
}

/**
 * MUVELETENKENT MI VESZ EL AZ ELVETESSEL -- ES MI NEM.
 *
 * `Record`, nem `if`-lanc, ugyanabbol az okbol, mint a javitas-elutasitasnal:
 * egy negyedik muvelet felvetele igy FORDITASI HIBA, nem csendes felreirat.
 *
 * A MODOSITAS SORA A LEGKONNYEBBEN FELREERTHETO. A felvitel mondata
 * („a szerveren nem fog létezni") egy szerkesztesrol HAMIS, es ijeszto is: a
 * szerelo azt olvashatna ki belole, hogy maga az ESZKOZ tunik el. Az eszkoz ott
 * marad, csak a javitas veszik el -- es epp ezt kell tudnia annak, aki dont.
 */
const ELVETES_KOVETKEZMENYE: Record<
  SyncOperation,
  { title: string; body: string }
> = {
  create: {
    title: "Elveted ezt a felvitelt?",
    body:
      "Ez a felvitel SOHA nem megy fel: nincs róla másik példány, és a " +
      "szerveren nem fog létezni.",
  },
  update: {
    title: "Elveted ezt a módosítást?",
    body:
      "A javítás SOHA nem megy fel. Az eszköz a rendszerben megmarad, de a " +
      "mostani, javítás előtti adatával -- amit itt beírtál, elveszik.",
  },
  "upload-photo": {
    title: "Elveted ezt a fényképet?",
    body:
      "Ez a fénykép SOHA nem megy fel: a rögzítés a szerveren marad, kép " +
      "nélkül.",
  },
};

/** Amit az elvetes a soron megvaltoztat. */
export interface QueueDiscardPatch {
  state: "discarded";
}

/**
 * AZ ELVETETT SOR ALLAPOTA.
 *
 * A TORZS ES A HIBAUZENET MARAD. Nem takaritas-lustasag: az elvetett sor
 * egyetlen ertelme, hogy MEGMONDJA, mi veszett el es miert -- egy ures sor
 * "elvetve" felirattal ugyanannyit mondana, mint a semmi.
 */
export function queueDiscardPatch(): QueueDiscardPatch {
  return { state: "discarded" };
}
