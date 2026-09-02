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
 * A RÉSZLETLAP VÁLASZA: HÁROM KÜLÖN LISTA, NEM EGY ÖSSZEFÉSÜLT SOR.
 *
 * Ez a ház mintája: a `GET /service/worksheets/:id` is külön, tipizált
 * listákat ad (`versions`, `assignees`, `continuedBy`), és a felület rakja
 * össze. Az összefésülést viszont NEM hagyjuk a kliensre, mert a hibajegynél a
 * három forrás EGY időrendi naplóvá áll össze - ott van egy sorrend-szabály, és
 * két kliens (web, mobil) külön-külön fésülve két helyen tartaná ugyanazt.
 * Ezért van a `serviceJobTimeline` itt, ebben a csomagban.
 *
 * AZ IDŐPONTOK A NAPLÓBÓL JÖNNEK, nem a jegy `startedAt` / `completedAt`
 * mezőiből. Azokat ma semmi nem írja, és ha a lépés írná őket, két írónk lenne
 * egy tényre: ha elcsúsznának, az néma hiba - két különböző időpont két
 * képernyőn, és senki nem keresi.
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
  /** Amit a jegy tehet innen. Üres, ha a jegy lezárult. */
  allowedSteps: ServiceJobStatusValue[];
  events: ServiceJobStatusEvent[];
  worksheets: ServiceJobWorksheetLink[];
  assets: ServiceJobAssetLink[];
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
