import { readQueuedAssetUpdate } from "./asset-update-queue";
import { readPhotoPayload } from "./photo-queue";
import { queueDiscardEligibility } from "./queue-discard";
import {
  queueResendEligibility,
  queueResolveEligibility,
} from "./queue-resend";
import type { SyncEntityType, SyncOperation, SyncQueueRow } from "./sync-queue";
import { readQueuedWorksheetLine } from "../worksheets/worksheet-line";

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
  /**
   * MI EZ A SOR, GEPI ALAKBAN.
   *
   * A `kind` az EMBERNEK szol („Eszköz módosítás"), es szovegkent nem szabad
   * donteni belole. Az elvetes megerosito szovege viszont muveletenkent MAS
   * (`queueDiscardConfirmation`), tehat a kepernyonek szuksege van a muveletre
   * magara -- kulonben a `kind` szovegere kellene illesztenie.
   */
  operation: SyncOperation;
  /** MI EZ: „Eszköz", „Munkalap", „Munkalap-tétel" vagy „Fénykép". */
  kind: string;
  /** MELYIK: az eszkoz neve, a lap targya, a tetel megnevezese, vagy a fajlnev. */
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
  /**
   * MEGJELENJEN-E A FELOLDAS GOMB.
   *
   * A `canFix` PARJA, es szandekosan KIZARO: a javitas a felvitel torzsenek
   * atirasa, a feloldas pedig mezonkenti valasztas ket ertek kozott. Egy
   * elakadt MODOSITASNAL a javitas soha nem tudna sikerulni (az elavult verzio
   * miatt), tehat ott a feloldas az EGYETLEN ut, ami at tud menni.
   */
  canResolve: boolean;
  /**
   * MIERT NINCS ITT JAVITAS GOMB -- CSAK AZ ELAKADT SOROKON.
   *
   * `null` mindenhol maszhol, es ez nem opcionalis reszlet: egy varakozo soron
   * a „nincs mit javitani rajta" mondat ZAJ, es a valodi teendot (varni) nyomna
   * el. Az ELAKADT soron viszont a hianyzo gomb magyarazat nelkul ugy nez ki,
   * mint egy hiba a programban -- a szerelo latja, hogy baj van, es nem latja,
   * hogy mit tehet.
   *
   * Acrobot dontese, 2026-09-04: a munkalap-tetel elakadasat ELFOGADJUK
   * (az egyetlen kijarat az elvetes), DE a keperno mondja meg, MIERT, es azt is,
   * hogy a beirt szoveg megmarad, amig el nem veti.
   */
  fixHint: string | null;
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
 * A FAJTA NEVE, KIMERITO LEKEPEZESSEL -- ES EZ NEM STILUS.
 *
 * Korabban a fajta egy `if`-lanc ALAPERTELMEZESEBOL jott: ami nem fenykep es
 * nem munkalap, az „Eszköz". Egy HARMADIK fajta igy MAGATOL eszkoz nevet
 * kapott volna, es a szerelo a sorban egy munkalap-tetelt eszkozkent latott
 * volna. A fordito errol nem szolt volna: a fuggveny a bovulestol tovabbra is
 * lefordul, csak MAST mond.
 *
 * `Record`, tehat egy NEGYEDIK fajta felvetele forditasi hiba. Ugyanaz az alak,
 * amit a szerveren a `document-store.ts` kapott, ugyanezert.
 */
const FAJTA_NEVE: Record<SyncEntityType, string> = {
  asset: "Eszköz",
  worksheet: "Munkalap",
  "worksheet-line": "Munkalap-tétel",
};

/**
 * MI EZ A SOR, EGY SZOBAN ES EGY CIMBEN.
 *
 * A CIM A PAYLOADBOL JON, mert a szerelonek az mond valamit: „Szivattyú" vagy
 * „Szivattyú csere". Egy muvelet-azonosito (`asset-create:V2196:...`) technikai
 * adat, amivel az iroda tud dolgozni, a helyszinen allo ember nem.
 *
 * A FAJTA ISMERT: a sorok a `queue-store.ts` `ismertSor` szuresen at jonnek,
 * ami ismeretlen `entity_type` erteket ki sem enged. Ezert nincs itt „ismeretlen
 * fajta" ag: az az ag SOHA nem futna le, tehat merni sem lehetne.
 */
export function describeQueueEntry(row: SyncQueueRow): {
  kind: string;
  title: string;
} {
  switch (row.operation) {
    case "upload-photo": {
      const payload = readPhotoPayload(row.payloadJson);
      return { kind: "Fénykép", title: payload?.name ?? "ismeretlen kép" };
    }
    case "update": {
      /**
       * A MODOSITAS NEM FELVITEL, ES EZ NEM SZOHASZNALAT.
       *
       * A ket sor teendoje MAS. Egy varakozo felvitelnel a szerelo tudja, hogy
       * az eszkoz MEG NINCS a rendszerben; egy varakozo modositasnal az eszkoz
       * OTT VAN, csak a javitas nem ment fel. Ha mind a ketto "Eszköz" neven
       * allna a listaban, ugyanaz a cimke ket kulon allapotot takarna.
       *
       * A CIM AZ ESZKOZ NEVE, es azert all kulon a sor torzseben, mert a
       * szervernek meno patch CSAK a valtozott mezoket viszi: aki a helyszint
       * irta at, annak a torzseben nev nincs.
       */
      const payload = readQueuedAssetUpdate(row.payloadJson);
      return {
        kind: `${FAJTA_NEVE[row.entityType]} módosítás`,
        title: payload?.assetName.trim()
          ? payload.assetName
          : "olvashatatlan módosítás",
      };
    }
    case "create":
      return leirasFelvitelrol(row);
  }
}

/**
 * A FELVITEL SORANAK CIME, FAJTANKENT. Kulon fuggveny, mert a fenti `switch`
 * kimerito -- egy NEGYEDIK muvelet felvetele igy FORDITASI HIBAT ad (a
 * fuggveny nem ad vissza erteket minden agon), nem csendes alapertelmezest.
 */
function leirasFelvitelrol(row: SyncQueueRow): {
  kind: string;
  title: string;
} {
  const kind = FAJTA_NEVE[row.entityType];
  if (row.entityType === "worksheet") {
    const payload = parse<WorksheetPayloadLike>(row.payloadJson);
    return {
      kind,
      title:
        typeof payload?.subject === "string" && payload.subject.trim()
          ? payload.subject
          : "tárgy nélkül",
    };
  }
  if (row.entityType === "worksheet-line") {
    /**
     * A TETEL CIME A MENNYISEGET IS VISZI, es ez nem diszites: ugyanaz a munka
     * ket kulon tetelkent is allhat a soron („Szivattyú csere, 2 óra" es
     * „Szivattyú csere, 1 óra"). Egy csupasz megnevezes mellett a szerelo nem
     * tudna kozottuk valasztani, amikor elvet valamelyiket.
     */
    const payload = readQueuedWorksheetLine(row.payloadJson);
    return {
      kind,
      title: payload
        ? `${payload.description} (${payload.quantity} ${payload.unit})`
        : "olvashatatlan tétel",
    };
  }
  const payload = parse<AssetPayloadLike>(row.payloadJson);
  return {
    kind,
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
    const javitas = queueResendEligibility(row);
    return {
      id: row.id,
      section,
      operation: row.operation,
      kind,
      title,
      createdAt: row.createdAt,
      attemptCount: row.attemptCount,
      error: describeQueueError(row.lastError),
      canRetry: section === "stalled",
      canFix: javitas.ok,
      canDiscard: queueDiscardEligibility(row).ok,
      canResolve: queueResolveEligibility(row).ok,
      /**
       * A MONDAT MAR MEGVOLT, CSAK SENKI NEM OLVASTA. A `queueResendEligibility`
       * minden elutasitashoz irt egy emberi indoklast, es a keperno eddig CSAK
       * az `ok` mezot hasznalta belole -- vagyis a magyarazat keszen allt, es a
       * szerelohoz nem jutott el. Ugyanaz a szakadas-alak, mint amikor egy
       * vegpont letezik, es senki nem hivja.
       */
      /**
       * A MONDAT AKKOR IS KELL, HA VAN FELOLDAS GOMB: az mondja meg, MIERT nem
       * javitas all ott. Egy magyarazat nelkuli masik gomb ugyanolyan
       * kerdojel, mint a hianyzo.
       */
      fixHint: section === "conflict" && !javitas.ok ? javitas.message : null,
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
