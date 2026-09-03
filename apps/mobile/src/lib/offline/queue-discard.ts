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
  /** „Eszköz", „Munkalap" vagy „Fénykép" -- a `describeQueueEntry` adja. */
  kind: string;
  /** A neve vagy a targya, ugyanonnan. */
  title: string;
}): QueueDiscardConfirmation {
  return {
    title: "Elveted ezt a felvitelt?",
    message:
      `${input.kind}: ${input.title}. ` +
      "Ez a felvitel SOHA nem megy fel: nincs róla másik példány, és a szerveren nem fog létezni. " +
      "A listán elvetettként marad meg, hogy látszódjon, mi történt vele.",
    confirmLabel: "Elvetem",
  };
}

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
