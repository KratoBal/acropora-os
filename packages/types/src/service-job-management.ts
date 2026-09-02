/**
 * A HIBAJEGY, AHOGY A FELÜLET LÁTJA.
 *
 * A nyolc belső állapot tükre. NEM a Prisma enumot importáljuk: ez a csomag a
 * kliensé is, és nem függhet az adatbázis-klienstől. A tükör viszont
 * ELCSÚSZHAT, ezért a szerveroldalon áll egy fordítási idejű őrző
 * (`service-job-status.ts`), ami `Record<ServiceJobStatus, ...>` alakban
 * kényszeríti ki, hogy a két lista ugyanaz maradjon. Ha valaki új állapotot
 * vesz fel a sémába, ott hasal el, nem itt - és nem a felhasználó előtt.
 */
export type ServiceJobStatusValue =
  | "NEW"
  | "TRIAGED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "WAITING_FOR_PARTS"
  | "WAITING_FOR_CUSTOMER"
  | "COMPLETED"
  | "CANCELLED";

/** A négy állapot, amit a partner lát. A nyolc ennek a részletezése. */
export type ServiceJobPartnerStatus =
  "NEW" | "IN_PROGRESS" | "COMPLETED" | "CLOSED";

export interface ServiceJobListItem {
  id: string;
  jobNumber: string;
  title: string;
  status: ServiceJobStatusValue;
  partnerStatus: ServiceJobPartnerStatus;
  partnerStatusLabel: string;
  customerName: string | null;
  worksheetCount: number;
  createdAt: string;
}

export interface ServiceJobListResponse {
  items: ServiceJobListItem[];
}

/**
 * EGY LÉPÉS A JEGYEN, AHOGY A NAPLÓ MUTATJA.
 *
 * A `fromStatus` `null` a keletkezésnél: annak nincs előzménye. Az `actorName`
 * is `null` lehet, mert egy törölt felhasználó nem viheti magával a naplót -
 * ami történt, megtörtént.
 */
export interface ServiceJobStatusEvent {
  id: string;
  fromStatus: ServiceJobStatusValue | null;
  toStatus: ServiceJobStatusValue;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

/** Egy munkalap a jegy mögött. A szám `null`, amíg a lap piszkozat. */
export interface ServiceJobWorksheetLink {
  id: string;
  number: string | null;
  createdAt: string;
  handedOverAt: string | null;
}

/** Egy eszköz, amit a jegy érint. */
export interface ServiceJobAssetLink {
  id: string;
  assetId: string;
  assetNumber: string;
  assetName: string;
  attachedAt: string;
}

/**
 * A RÉSZLETLAP VÁLASZA: EGY ÖSSZEFÉSÜLT SOR, A SZERVER RENDEZI.
 *
 * NEM három lista, és ezt megmértük, nem elvből döntöttük el. Az összefésülés
 * sorrendje SZABÁLY (mi számít egyidejűnek, mi jön előbb azonos bélyegnél), és
 * egy szabály ne lakjon két helyen. Egy közös tiszta függvény ezt csak akkor
 * oldaná meg, ha MINDKÉT kliens el tudná érni - a mobil csomag viszont NEM
 * függ a `@acropora/types`-tól (mérve 2026-09-02, a web igen, a mobil nem),
 * tehát ott a fésülés újraíródna. A kliens rajzol, nem dönt.
 *
 * Ha valaha típusra kell szűrni, az a végpont paramétere legyen, ne
 * kliens-oldali válogatás.
 */
export interface ServiceJobDetail {
  id: string;
  jobNumber: string;
  title: string;
  description: string | null;
  status: ServiceJobStatusValue;
  partnerStatus: ServiceJobPartnerStatus;
  partnerStatusLabel: string;
  customerName: string | null;
  createdAt: string;
  /**
   * A TERVEZETT IDŐPONT MEZŐ MARAD, ÉS NEM SZÁRMAZTATOTT.
   *
   * Más természetű, mint a másik kettő: ez TERV, nem esemény. Valaki
   * BEÁLLÍTJA, jövőbeli időpontra, és a naplóból soha nem vezethető le, mert
   * nem történt meg semmi.
   */
  scheduledAt: string | null;
  /**
   * MA MINDKETTŐ MINDEN JEGYEN `null`, ÉS EZ SZÁNDÉKOS.
   *
   * Az időpontok FORRÁSA a napló: a `timeline` státusz-bejegyzéseiből derül ki,
   * mikor lépett a jegy `IN_PROGRESS`-be és mikor `COMPLETED`-be. A lépés
   * NEM írja ezt a két mezőt, mert az második írót csinálna egy tényre, és
   * két elcsúszott időpont NÉMA hiba: két képernyő, két válasz, és senki nem
   * keresi.
   *
   * A mezők attól szerepelnek a válaszban, hogy a séma hordozza őket, és egy
   * kihagyott mező később csendes hiánynak látszana. A séma megjegyzése mondja
   * meg, mi hozná vissza a mezős irányt (indexelt lekérdezés a számlázáshoz).
   */
  startedAt: string | null;
  completedAt: string | null;
  /** Amit a jegy tehet innen. Üres, ha a jegy lezárult. */
  allowedSteps: ServiceJobStatusValue[];
  /** A három forrás egy időrendben, legújabb felül. A szerver rendezte. */
  timeline: ServiceJobTimelineEntry[];
}

export type ServiceJobTimelineEntry =
  | {
      kind: "status";
      at: string;
      sortKey: string;
      event: ServiceJobStatusEvent;
    }
  | {
      kind: "worksheet";
      at: string;
      sortKey: string;
      worksheet: ServiceJobWorksheetLink;
    }
  | { kind: "asset"; at: string; sortKey: string; asset: ServiceJobAssetLink };

/**
 * A HÁROM FORRÁS EGY IDŐRENDI NAPLÓVÁ, LEGÚJABB FELÜL (Balázs, 2026-09-02).
 *
 * A SORREND DETERMINÁLT, és ez nem szőrszálhasogatás: azonos időbélyegnél (egy
 * tranzakcióban keletkezett sorok, vagy másodperc-pontosságú import) a
 * rendezés magától nem stabil, és ugyanaz a jegy két lekérdezésen más
 * sorrendben adná vissza ugyanazokat a sorokat. A másodlagos kulcs a fajta,
 * a harmadlagos az azonosító - mindkettő állandó.
 */
export function serviceJobTimeline(detail: {
  events: ServiceJobStatusEvent[];
  worksheets: ServiceJobWorksheetLink[];
  assets: ServiceJobAssetLink[];
}): ServiceJobTimelineEntry[] {
  const entries: ServiceJobTimelineEntry[] = [
    ...detail.events.map((event): ServiceJobTimelineEntry => ({
      kind: "status",
      at: event.createdAt,
      sortKey: event.id,
      event,
    })),
    ...detail.worksheets.map((worksheet): ServiceJobTimelineEntry => ({
      kind: "worksheet",
      at: worksheet.createdAt,
      sortKey: worksheet.id,
      worksheet,
    })),
    ...detail.assets.map((asset): ServiceJobTimelineEntry => ({
      kind: "asset",
      at: asset.attachedAt,
      sortKey: asset.id,
      asset,
    })),
  ];

  return entries.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.sortKey === b.sortKey) return 0;
    return a.sortKey < b.sortKey ? -1 : 1;
  });
}
