import { readPhotoPayload } from "./photo-queue";
import { queueDiscardEligibility } from "./queue-discard";
import { queueResendEligibility } from "./queue-resend";
import type { SyncQueueRow } from "./sync-queue";

/**
 * MI ALL A SORBAN, EMBERI ALAKBAN -- ES MIT LEHET VELE KEZDENI.
 *
 * === MIERT KELL EGYALTALAN ===
 *
 * 2026-09-03-tol egy felvitel MEG IS ALLHAT (a szerver sokadszorra is hibat
 * adott). Ezzel egy zsakutca keletkezett: a sav kimondja, hogy „segítség kell",
 * es a szerelonek nem volt hova mennie vele. A megallast en vezettem be, tehat
 * a kiutat is meg kell adni.
 *
 * === A DONTESEK ITT ALLNAK, NEM A KEPERNYON ===
 *
 * A mobilon nincs komponens-teszt: ami a keperno torzseben marad, azt csak
 * kezzel, telefonon lehet kiprobalni. Ami itt all: mibol MIT lat a szerelo,
 * melyik sort lehet ujraprobalni, es hogyan forditjuk emberre a hibaszoveget.
 */

/** A lista harom szakasza. A SORREND a teendo surgossege, nem az allapote. */
export type QueueSection = "stalled" | "conflict" | "waiting" | "discarded";

export interface QueueEntryView {
  id: string;
  section: QueueSection;
  /** MI EZ: „Eszköz", „Munkalap" vagy „Fénykép". */
  kind: string;
  /** MELYIK: az eszkoz neve, a lap targya, vagy a fajlnev. */
  title: string;
  /** Mikor keletkezett, ISO alakban -- a keperno formazza. */
  createdAt: string;
  attemptCount: number;
  /** Emberi mondat a hibarol, es a nyers szoveg kulon. */
  error: QueueErrorView;
  /**
   * MEGJELENJEN-E AZ UJRAPROBALAS GOMB.
   *
   * CSAK a megallt (`stalled`) soron. Egy `conflict` sornal ugyanaz a keres
   * ugyanazt a valaszt kapna, es a gomb AZT IGERNE, hogy megoldodik -- egy
   * gomb, ami nem tud segiteni, rosszabb a hianyanal.
   */
  canRetry: boolean;
  /**
   * MEGJELENJEN-E A JAVITAS GOMB.
   *
   * A `canRetry` PARJA, es szandekosan KIZARO: az ujraprobalas a megallt
   * (`stalled`) soron van, a javitas az ELAKADTON (`conflict`). A ket sor
   * teendoje MAS -- ott a szerverrel van baj es varni kell, itt a felvitelt
   * kell atirni --, es egy gomb, ami a rossz soron all, a rossz teendore
   * kuldi a szerelot.
   *
   * A dontes a `queue-resend.ts`-ben all, mert ott merheto, es mert ugyanaz a
   * szabaly kell a kepernyonek es a mentesnek.
   */
  canFix: boolean;
  /**
   * MEGJELENJEN-E AZ ELVETES GOMB.
   *
   * Ugyanazon a soron all, mint a `canFix`, es ez SZANDEKOS: az elakadt
   * felvitelnek KET kijarata van, es a szerelo valaszt kozottuk. A ket gomb
   * SULYA viszont nem egyforma -- a kepernyo dolga, hogy az elvetes ne legyen
   * ugyanolyan konnyen elerheto, mint a javitas.
   */
  canDiscard: boolean;
}

export interface QueueErrorView {
  /** Amit a szerelonek mondunk. `null`, ha nincs hiba (meg el sem indult). */
  message: string | null;
  /**
   * A NYERS SZOVEG, ha volt. Ez az IRODANAK szol: a forditas nem viheti el azt
   * az adatot, amivel a hibat meg lehet keresni.
   */
  raw: string | null;
}

/**
 * A HIBASZOVEG EMBERI ALAKJA -- ES AMIT SZANDEKOSAN NEM CSINAL.
 *
 * Merve 2026-09-03: a megallt sornal a legvaloszinubb szoveg az
 * `API request failed (500).`, mert egy 5xx tipikusan NEM JSON valasz (atjaro,
 * HTML hibaoldal, osszeomlott folyamat). Ez a szerelonek nem informacio.
 *
 * ISMERETLEN ALAKRA NEM TALAL KI MONDATOT. Ha nem ismeri fel, azt mondja, hogy
 * nem tudja ertelmezni, es mutatja a nyerset. Egy fordito, ami MINDENRE ad
 * valamit, ugyanaz a csapda, mint egy mero, ami mindenre ugyanazt mondja.
 */
export function describeQueueError(raw: string | null): QueueErrorView {
  if (!raw) return { message: null, raw: null };

  if (/^API request failed \(\d+\)\.?$/.test(raw))
    return {
      message:
        "A szerver hibát adott, és nem mondta meg, mi a baj. Ez nem a felvitellel van, hanem a szerverrel: szólj az irodának.",
      raw,
    };

  if (/^szerver hiba \(\d+\)$/.test(raw))
    return {
      message:
        "A szerver hibát adott. Ez nem a felvitellel van: szólj az irodának.",
      raw,
    };

  if (
    raw === "A szerver jelenleg nem érhető el." ||
    raw === "nem értem el a szervert"
  )
    return {
      message:
        "A telefon nem érte el a szervert. Ez magától rendbe jön, amint van rendes térerő.",
      raw,
    };

  /**
   * AMIT NEM ISMERUNK FEL, AZT NEM ERTELMEZZUK. A szerver sajat magyar
   * uzenetei (a NestJS `message` mezoje) IDE esnek, es ez helyes: azok mar
   * emberi mondatok, es a mi „forditasunk" csak rontana rajtuk.
   */
  return { message: raw, raw: null };
}

interface AssetPayloadLike {
  name?: unknown;
}

interface WorksheetPayloadLike {
  subject?: unknown;
}

/**
 * MI EZ A SOR, EGY SZOBAN ES EGY CIMBEN.
 *
 * A CIM A PAYLOADBOL JON, mert a szerelonek az mond valamit: „Szivattyú" vagy
 * „Szivattyú csere". Egy muvelet-azonosito (`asset-create:V2196:...`) technikai
 * adat, amivel az iroda tud dolgozni, a helyszinen allo ember nem.
 */
export function describeQueueEntry(row: SyncQueueRow): {
  kind: string;
  title: string;
} {
  if (row.operation === "upload-photo") {
    const payload = readPhotoPayload(row.payloadJson);
    return { kind: "Fénykép", title: payload?.name ?? "ismeretlen kép" };
  }
  if (row.entityType === "worksheet") {
    const payload = parse<WorksheetPayloadLike>(row.payloadJson);
    return {
      kind: "Munkalap",
      title:
        typeof payload?.subject === "string" && payload.subject.trim()
          ? payload.subject
          : "tárgy nélkül",
    };
  }
  const payload = parse<AssetPayloadLike>(row.payloadJson);
  return {
    kind: "Eszköz",
    title:
      typeof payload?.name === "string" && payload.name.trim()
        ? payload.name
        : "név nélkül",
  };
}

/**
 * A SOROK HAROM SZAKASZBAN, A TEENDO SZERINT.
 *
 * A `stalled` es a `conflict` KULON MARAD, es ez nem rendezesi izles: a
 * teendojuk MAS. A conflictnal a FELVITELT kell javitani (a szerver
 * elutasitotta), a stallednel varni vagy szolni kell (a szerverrel van baj).
 * Egy kozos listaban a szerelo a sajat adatat kezdene javitani egy szerver-hiba
 * miatt.
 */
export function toQueueEntries(
  rows: readonly SyncQueueRow[],
): QueueEntryView[] {
  return rows.map((row) => {
    const { kind, title } = describeQueueEntry(row);
    const section = sectionOf(row.state);
    return {
      id: row.id,
      section,
      kind,
      title,
      createdAt: row.createdAt,
      attemptCount: row.attemptCount,
      error: describeQueueError(row.lastError),
      canRetry: section === "stalled",
      canFix: queueResendEligibility(row).ok,
      canDiscard: queueDiscardEligibility(row).ok,
    };
  });
}

function sectionOf(state: SyncQueueRow["state"]): QueueSection {
  if (state === "stalled") return "stalled";
  if (state === "conflict") return "conflict";
  /**
   * AZ ELVETETT SOR SAJAT SZAKASZBA MEGY, ES EZ NEM RENDEZESI IZLES.
   *
   * A fuggveny alapertelmezese a "waiting", tehat egy uj allapot MAGATOL oda
   * esne -- es a kollega azt latna, hogy az altala ELVETETT felvitel "vár
   * feltöltésre". A fordito errol NEM szol (a `SyncState` bovulesetol ez a
   * fuggveny tovabbra is lefordul), tehat a hallgatasa nem bizonyitek.
   */
  if (state === "discarded") return "discarded";
  return "waiting";
}

/** A szakaszok fejlece es a hozza tartozo teendo, egy helyen. */
export const QUEUE_SECTIONS: {
  section: QueueSection;
  title: string;
  hint: string;
}[] = [
  {
    section: "stalled",
    title: "Megállt",
    hint: "A szerver többször hibát adott. A rögzítés megvan a telefonon: szólj az irodának, és ha rendben van, próbáld újra.",
  },
  {
    section: "conflict",
    title: "Elakadt",
    hint: "A szerver elutasította. Ezen az újrapróbálás nem segít: a felvitelt kell javítani, vagy elvetni.",
  },
  {
    section: "waiting",
    title: "Vár feltöltésre",
    hint: "Ezek magukat küldik fel, amint van térerő. Nincs velük teendő.",
  },
  {
    /**
     * A SZAKASZ AZERT LETEZIK, MERT A HIANYA HAZUDNA. Egy sor, ami eltunik a
     * listarol, kivulrol ugyanugy nez ki, mintha felment volna -- ugyanaz a
     * felvitel hianyzik a szerverrol, es senki nem tudja megmondani, hogy
     * elvetettek-e vagy elveszett.
     */
    section: "discarded",
    title: "Elvetve",
    hint: "Ezeket te vetetted el: nem mennek fel, és nem is fognak. Azért látszanak, hogy ne tűnjenek el nyomtalanul.",
  },
];

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
