/**
 * RELATIV UT, NEM `@/` ALIAS -- es ezt a teszt-konfig fejlece koveteli meg.
 *
 * A `tsconfig.test.json` SZANDEKOSAN nem hordoz `paths` bejegyzest: a `tsc` a
 * kibocsatott specifikatort nem irja at, tehat a leforditott kodban maradna a
 * `@/...` alak, es a FUTAS hasalna el rajta. Amig egyetlen spec sem erte el ezt
 * a modult, a hiba nem latszott -- az elso spec, ami behuzza, TS2307-tel all
 * meg. A repo tobbi lib-modulja ezert ir relativ testver-utat.
 */
import type {
  ServiceJobStatusValue,
  ServiceJobTimelineEntry,
  ServiceJobWorksheetLink,
} from "./types";

/**
 * A HIBAJEGY ÁLLAPOTAINAK MAGYAR NEVE -- KÉZZEL KARBANTARTOTT TÜKÖR.
 *
 * A forrás: `apps/web/src/components/service-jobs/service-job-labels.ts`. Az
 * Expo app szándékosan nem húzza be a munkatér csomagjait, tehát importálni nem
 * lehet -- ugyanaz a helyzet, mint a matricakódnál és a teljesítmény-alaknál.
 *
 * ÉS EZ A TÜKÖR KEVESEBBET KOCKÁZTAT, MINT AZOK, ezért nincs mellette összevető
 * őrző: itt SZÖVEG áll, nem SZABÁLY. Ha egy felirat elcsúszik, a szerelő más
 * szót lát, mint az irodás -- kellemetlen, de LÁTHATÓ. Ha egy SZABÁLY csúszik
 * el (mit szabad lépni, mi az érvényes alak), a hiba néma, és a szerver utasítja
 * el azt, amit a telefon átengedett.
 *
 * AMI VISZONT NINCS ITT, ÉS SZÁNDÉKOSAN: a LÉPÉS-szabály. Azt a szerver küldi a
 * jegy mellett (`allowedSteps`), tehát nincs mit tükrözni.
 */
export const SERVICE_JOB_STATUS_LABELS: Record<ServiceJobStatusValue, string> =
  {
    NEW: "Új",
    TRIAGED: "Felmérve",
    SCHEDULED: "Ütemezve",
    IN_PROGRESS: "Folyamatban",
    WAITING_FOR_PARTS: "Alkatrészre vár",
    WAITING_FOR_CUSTOMER: "Ügyfélre vár",
    COMPLETED: "Elkészült",
    CANCELLED: "Elállt",
  };

/**
 * AZ ÁLLAPOT NEVE, VAGY MAGA A KÓD.
 *
 * ISMERETLEN ÉRTÉKRE A KÓDOT ADJA VISSZA, nem üres szöveget: ha a szerver egy új
 * állapotot vezet be, mielőtt ez a tükör bővül, a szerelő lásson VALAMIT. Egy
 * üres cella azt állítaná, hogy a jegynek nincs állapota.
 */
export function serviceJobStatusLabel(status: string): string {
  return SERVICE_JOB_STATUS_LABELS[status as ServiceJobStatusValue] ?? status;
}

/**
 * A HELYSZÍN ÚTJA EGY SORBAN.
 *
 * A szerver a teljes utat adja, a gyökértől lefelé (`departmentPath`). A telefon
 * képernyője keskeny, ezért a VÉGE a fontos: ahol a gép áll. Ha az út hosszabb
 * kettőnél, az eleje elmarad -- de a rövidítés LÁTSZIK (`...`), nem csendes.
 */
export function shortPath(path: readonly string[] | null): string | null {
  if (!path || path.length === 0) return null;
  if (path.length <= 2) return path.join(" / ");
  return `... / ${path.slice(-2).join(" / ")}`;
}

/**
 * A JEGYHEZ TARTOZÓ MUNKALAPOK, AZ IDŐVONALBÓL.
 *
 * MIÉRT NEM EGY MEZŐBŐL: a szerver válaszában NINCS `worksheets` kulcs -- a
 * munkalapok a `timeline` `kind: "worksheet"` bejegyzésein át jönnek, és a web
 * is onnan szedi össze őket. Az első alakom egy nem létező mezőt olvasott, és
 * az adatlap `undefined.length`-en omlott össze, MEGNYITÁSKOR.
 *
 * A SORREND A NAPLÓÉ MARAD (legújabb felül), mert az a jegy története; egy
 * külön rendezés itt azt állítaná, hogy a munkalapoknak saját sorrendjük van.
 */
export function worksheetsOf(
  timeline: readonly ServiceJobTimelineEntry[],
): ServiceJobWorksheetLink[] {
  return timeline
    .filter(
      (
        entry,
      ): entry is Extract<ServiceJobTimelineEntry, { kind: "worksheet" }> =>
        entry.kind === "worksheet",
    )
    .map((entry) => entry.worksheet);
}

/**
 * EGY MUNKALAP SORA A KÉPERNYŐN: a NEVE, a száma mellett.
 *
 * A szám `null`, amíg a lap piszkozat -- ilyenkor a web „Piszkozat" szót ír a
 * helyére, és a telefon ugyanazt mondja. Két felület, ugyanaz a szó: a szerelő
 * és az irodás ugyanarról a lapról beszél.
 */
export function worksheetLineLabel(sheet: ServiceJobWorksheetLink): string {
  return `${sheet.subject} (${sheet.number ?? "Piszkozat"})`;
}
