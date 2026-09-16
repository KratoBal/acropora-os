/**
 * EGY MUNKALAP EGY HIBAJEGY ALATT -- A TISZTA RESZ.
 *
 * A kepernyo `worksheets/new.tsx` ket kulonbozo alakban kaphatja meg a jegyet,
 * es a KETTO NEM CSERELHETO FEL:
 *
 *   serviceJobId           a jegy MAR FENT VAN, szerver-oldali azonositoval
 *   serviceJobOperationId  a jegy MEG A SORBAN all, azonositoja MEG NEM LETEZIK
 *
 * MIERT KULON MODUL: a kepernyore nincs komponens-teszt ebben az appban, es ez
 * a nehany dontes az, amitol a lanc mukodik vagy csendben elromlik.
 */

export type TicketLink =
  /** A lap nem tartozik jegyhez. Ez a rendes ut, nem hiany. */
  | { kind: "none" }
  /** A jegy fent van: az azonositoja mehet a TORZSBEN. */
  | { kind: "server"; serviceJobId: string }
  /**
   * A jegy a sorban all: a lap a jegy MUVELET-azonositojara var, es az
   * `attachRecordingResult` irja be a payload `serviceJobId` kulcsara, amint a
   * jegy felment.
   */
  | { kind: "queued"; operationId: string };

function elso(ertek: string | string[] | undefined): string | null {
  const nyers = Array.isArray(ertek) ? ertek[0] : ertek;
  return nyers?.trim() ? nyers.trim() : null;
}

/**
 * MELYIK ALAKBAN JOTT A JEGY.
 *
 * A KETTO EGYSZERRE HIBA, es nem hallgatjuk el: az azt jelentene, hogy a hivo
 * maga sem tudja, letezik-e mar a jegy. Ilyenkor a SORBAN ALLO alak nyer --
 * az a szigorubb (nem kuldunk fel semmit, amig a jegy nincs meg), es a ket
 * tevedes ara nem egyforma: a felesleges varakozas hangos, egy jegy NELKUL
 * felkerult lap viszont nema.
 */
export function ticketLinkFromParams(params: {
  serviceJobId?: string | string[];
  serviceJobOperationId?: string | string[];
}): TicketLink {
  const sorban = elso(params.serviceJobOperationId);
  if (sorban !== null) return { kind: "queued", operationId: sorban };
  const fent = elso(params.serviceJobId);
  if (fent !== null) return { kind: "server", serviceJobId: fent };
  return { kind: "none" };
}

/**
 * EL SZABAD-E KULDENI A LAPOT MOST, VAGY A SORBA KELL TENNI.
 *
 * === EZ A MODUL LEGFONTOSABB DONTESE ===
 *
 * A `saveOrQueue` alapertelmezesben ELOSZOR a szervernek kuld, es csak halozati
 * hibanal teszi sorba. Egy SORBAN ALLO jegy alatt ez csendben rosszat tenne: a
 * hivas sikerulne, csak epp `serviceJobId` NELKUL -- a lap letrejonne, es soha
 * nem kerulne a jegy ala. Se hiba, se uzenet.
 *
 * Ezert a sorban allo jegy alatt a lap MINDIG a sorba megy, terero ide vagy
 * oda: ott meg tudja varni a jegyet.
 */
export function mustQueue(link: TicketLink): boolean {
  return link.kind === "queued";
}

/**
 * MIT MOND A KEPERNYO A JEGYROL -- ELORE, NEM A KULDES UTAN.
 *
 * A PARTNER-FELTETEL A LENYEG. A szerver a jegy partneret a lapehoz meri
 * (`mayWorksheetJoinTicket`), es partner NELKULI jegy ala nem enged lapot. Ez
 * a telefonon valos eset: szallitoi gepnel a jegy a tukor-sor hianyaban partner
 * nelkul szuletik, es errol a jegy-kepernyo mar ma is szol.
 *
 * Ha ezt csak a kuldes utan mondanank el, a szerelo egy kesz lapot latna
 * elakadva a sorban, orakkal kesobb, a helyszintol tavol.
 */
export const JEGY_A_SORBAN =
  "Ez a munkalap egy olyan hibajegy alá kerül, ami maga is feltöltésre vár. Ezért a lap is a sorba megy, és a jegy után megy fel. Válaszd ugyanazt a partnert, mint a jegyen: eltérő partnernél a szerver visszautasítja, és a lap a sorban akad el.";

export const JEGY_FENT_VAN =
  "Ez a munkalap egy meglévő hibajegy alá kerül. Válaszd ugyanazt a partnert, mint a jegyen: eltérő partnernél a szerver visszautasítja.";

export function ticketNotice(link: TicketLink): string | null {
  if (link.kind === "queued") return JEGY_A_SORBAN;
  if (link.kind === "server") return JEGY_FENT_VAN;
  return null;
}
