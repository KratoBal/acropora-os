import type { MaintenanceOrderFormDecimalInput } from "./maintenance-order-form-amounts.js";

/**
 * A MEGRENDELŐLAP BEMENETE -- LAPOS TS TÍPUS, ADATBÁZIS NÉLKÜL.
 *
 * === MI EZ, ÉS MI NEM ===
 *
 * Ez a karbantartási folyamat 2. szeletének (`exchange/codex-karbantartas-1-
 * szerzodes-2026-09-24.md`, "Later slices" rész) ÖNÁLLÓ MAGJA: a szerződés és
 * a tétel adatmodellje (Codexnél készül, `schema.prisma`, migráció) SEHOL nem
 * jelenik meg ebben a fájlban. A bekötés (a `Contract`/`ContractItem` sorból
 * ez a típus) egy KÉSŐBBI kör, amikor a modell megvan -- itt csak annyi áll,
 * amennyi a PDF-hez kell.
 *
 * === A MINTA: AZ ÜGYFÉL SAJÁT ŰRLAPJA, NEM A MI ARCULATUNK ===
 *
 * A Fővárosi Állat- és Növénykert saját belső megrendelőlapja
 * (`exchange/minta-megrendelolap-allatkert.docx`, szerződésszám
 * SZ2026/0000019). Ezt a lapot az ÜGYFÉL írja alá a saját szervezetén belül
 * (pénzügyi ellenjegyző, kötelezettségvállaló), tehát az ő űrlapjuk alakját
 * követi -- nem a hibajegy-PDF-ünk fejlécét vagy lábécét
 * (`documents/pdf/branded-document.ts`).
 *
 * === A MEZŐK, AMIKNEK NINCS FORRÁSA MA ===
 *
 * A minta-lapon több mező áll, amit sem a feladat, sem a mai adatmodell nem
 * nevez meg forrásként (szervezeti egység, terhelendő kód, leltárkörzet kód,
 * ügyintéző, iktatási szám, a forrás-nyilatkozat, a teljesítési/fizetési
 * határidő szövege, a raktár-egyeztetés). Ezek MIND OPCIONÁLIS bemenetek,
 * hiányukban a lap a minta ÜRES/pontozott alakját írja ki -- a teljes
 * felsorolás és indoklás a PR törzsében áll, ne itt: ez a fájl a MEZŐKET
 * sorolja, nem a döntés történetét.
 */

/** A megrendelőlapon szereplő vevő adatai. */
export interface MaintenanceOrderFormCustomer {
  name: string;
  address: string;
  /** "Szervezeti egység megnevezése". Nincs forrás a mai modellben. */
  organizationalUnitName?: string;
  /** "Terhelendő kód". Nincs forrás a mai modellben. */
  chargeCode?: string;
  /** "Leltárkörzet kódja (tárgyi eszköz esetén)". Nincs forrás a mai modellben. */
  inventoryZoneCode?: string;
  /** "Ügyintéző" -- az ÜGYFÉL saját kapcsolattartója, nem a miénk. */
  contactPersonName?: string;
  /**
   * "Iktatási száma" -- ez az ÜGYFÉL saját nyilvántartási száma. Jellemzően
   * ők adják meg, amikor a lapot kézhez veszik, tehát a mi kiállításunkkor
   * még nem ismert -- üresen, pontozott vonalként megy ki, hogy kézzel
   * kitölthető legyen.
   */
  registrationNumber?: string;
}

/** Egy kiválasztott karbantartási tétel a szerződésből. */
export interface MaintenanceOrderFormItem {
  /** "Tétel" -- a sor sorszáma a lapon, nem adatbázis-azonosító. */
  position: number;
  /** "Berendezés". */
  description: string;
  /** "Egységár 1db/alkalom". */
  unitPricePerOccasion: MaintenanceOrderFormDecimalInput;
  /**
   * "db". `MaintenanceOrderFormDecimalInput`, NEM sima `number` -- a
   * `ContractItem.quantity` a sémán `Decimal(19,6)` (törtmennyiség is lehet),
   * és egy `number`-re szűkített mező a bekötéskor `.toNumber()`-re
   * kényszerítené a hívót, pontosan azon a ponton, ahol a többi pénz- és
   * mennyiség-mező mindvégig Decimal marad (nautilus mérése, 2026-09-24,
   * a bekötés közben javítva -- lásd
   * exchange/nautilus-megrendelolap-lekepezesi-terv-2026-09-24.md, 1. pont).
   */
  quantity: MaintenanceOrderFormDecimalInput;
  /** "alk/év". */
  occasionsPerYear: number;
  /**
   * Tételenkénti ÁFA-kulcs. A mintán az összesítő csak EGY ÁFA-összeget mutat
   * (mert ma minden tétel 27%), a jövőbeli szerződés-tételek viszont eltérő
   * kulcsot is hordozhatnak (`ContractItem.vatRatePercent`) -- ezért a
   * függvény tételenként számol és összegez, nem egyetlen globális kulcsból.
   */
  vatRatePercent: MaintenanceOrderFormDecimalInput;
}

/** "Más forrás esetén" -- csak akkor releváns, ha NEM saját forrásból megy. */
export interface MaintenanceOrderFormOtherBudgetSource {
  projectName?: string;
  identifier?: string;
}

export interface MaintenanceOrderFormInput {
  customer: MaintenanceOrderFormCustomer;
  /** "Szerződés száma", pl. "SZ2026/0000019". */
  contractNumber: string;
  items: readonly MaintenanceOrderFormItem[];
  /**
   * A megrendelés által lefedett időszak (pl. "2026. év"). A minta-lapon
   * NINCS ehhez külön feliratú mező -- a lap "A megrendelés tárgya" sora alá
   * kerül, ha meg van adva. Nincs forrás a mai modellben.
   */
  period?: string;
  /** "kelt" -- ISO dátum, a lap kiállításának napja. */
  issuedAt: string;
  /**
   * A megrendelőlap SAJÁT sorszáma (a mi nyilvántartásunké, nem az ügyfél
   * "Iktatási száma" mezője, és nem a szerződésszám).
   */
  sequenceNumber: string;
  /** "A megrendelés tárgya". Hiányában egy semleges alapértelmezés megy ki. */
  subject?: string;
  /**
   * "A megrendelni kívánt áru / szolgáltatás forrása". Hiányában a minta
   * "saját forrás, igen" ágát írja ki -- ez a mai EGYETLEN szerződéses
   * ügyfélnél (Fővárosi Állat- és Növénykert) mindig ez volt a mintán.
   */
  ownBudgetSource?: boolean;
  otherBudgetSource?: MaintenanceOrderFormOtherBudgetSource;
  /** "Teljesítés határideje". Hiányában a minta szövege megy ki. */
  fulfillmentDeadlineText?: string;
  /** "Fizetési határidő". Hiányában a minta szövege megy ki. */
  paymentDeadlineText?: string;
  /**
   * "Raktárral egyeztetve: IGEN / NEM". `null`/hiány esetén MINDKÉT szó
   * kimegy, aláhúzás nélkül (ahogy a papíron kézzel jelölendő) -- ez NEM
   * hiba, hanem a minta saját, kézzel kitöltendő alakja.
   */
  warehouseCoordinated?: boolean | null;
}
