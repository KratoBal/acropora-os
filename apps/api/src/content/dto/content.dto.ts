import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

import type { ContentState } from "../content-state.js";
import type { ContentViewerRole } from "../content-filter.js";

const VIEWER_ROLES = ["author", "reviewer", "approver", "sender"] as const;

const CONTENT_STATES = [
  "IDEA",
  "DRAFTING",
  "AWAITING_REVIEW",
  "AWAITING_REVISION",
  "AWAITING_APPROVAL",
  "READY_TO_SEND",
  "SCHEDULED",
  "SENT",
  "DISCARDED",
] as const;

export class ContentWaitingQueryDto {
  @IsIn(VIEWER_ROLES)
  role!: ContentViewerRole;
}

export class ContentCalendarQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

/**
 * A `from` KÖTELEZŐ, ÉS EZ A DTO LEGFONTOSABB MEZŐJE.
 *
 * A hívó kimondja, MILYEN ÁLLAPOTBAN LÁTTA a tételt, amikor döntött. Enélkül
 * két ember egyszerre dönthetne ugyanarról, és a második írás csendben
 * felülírná az elsőt -- úgy, hogy az első továbbra is azt hiszi, az ő döntése
 * áll.
 *
 * Opcionálisként ez a védelem az első kényelmes pillanatban eltűnne: aki nem
 * küldi, az nem is tudná, hogy lemondott róla.
 */
export class ContentMoveDto {
  @IsIn(CONTENT_STATES)
  from!: ContentState;

  @IsIn(CONTENT_STATES)
  to!: ContentState;

  /**
   * Az elvetés oka. A DTO-ban opcionális, mert csak az elvetéshez tartozik --
   * a KÖTELEZŐSÉGÉT a szolgáltatás őrzi, ott, ahol a célállapot is ismert.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  discardReason?: string;

  /**
   * A visszaküldés felvetése: mit kell javítani. A DTO-ban opcionális, mert csak
   * ehhez az egy lépéshez tartozik -- a KÖTELEZŐSÉGÉT a szolgáltatás őrzi, ott,
   * ahol a célállapot is ismert. Ugyanaz a felosztás, mint az elvetés okánál.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  revisionNote?: string;
}

export class ContentCommentDto {
  @IsString()
  @MinLength(1)
  body!: string;
}

const CONTENT_CHANNELS = [
  "FACEBOOK_POST",
  "FACEBOOK_AD",
  "ARTICLE",
  "OTHER",
] as const;

/**
 * EGY UJ TETEL BEMENETE.
 *
 * A cim es a csatorna kotelezo, mert a Prisma modellben is azok. Minden mas
 * elhagyhato: egy vazlat attol vazlat, hogy meg nincs kesz.
 *
 * A KEZDO ALLAPOT NEM SZEREPEL ITT, ES EZ SZANDEKOS. A hivo nem valaszthatja
 * meg, hova kerul a tetel: az allapot a szolgáltatasban dol el, egy helyen. Egy
 * szabadon allithato allapotmezo ugyanaz a kapu-megkerules lenne, amit az
 * atmenet-tablazat fejlece mar egyszer nevesitett.
 */
/**
 * A GEPI JAVITAS BEMENETE, ES SZANDEKOSAN KEVESEBB, MINT EGY LETREHOZASE.
 *
 * Nincs benne `channel`, `imageRequired` es `plannedFor`: ez az ut a SZOVEGET
 * javitja, nem a tetel besorolasat. Egy csatorna-valtoztatas mas dontes, es ha
 * ide is beferne, egy elgepelt mezo csendben atsorolna a tetelt.
 *
 * Mind a ketto opcionalis, mert kulon-kulon is javithato -- de legalabb az
 * egyiknek jonnie kell, es ezt a szolgaltatas ellenorzi (a DTO szintjen egy
 * "legalabb egy" szabaly nem fejezheto ki tisztan).
 */
export class ContentAgentReviseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}

export class ContentCreateDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsIn(CONTENT_CHANNELS)
  channel!: (typeof CONTENT_CHANNELS)[number];

  @IsOptional()
  @IsString()
  body?: string;

  /**
   * Kell-e kep. Kulon mezo, nem allapot -- lasd a content-state fejlecét: a kep
   * a szovegtol FUGGETLEN feltetel, es a ketto osszevonasa az egyiket elfelejti.
   */
  @IsOptional()
  @IsBoolean()
  imageRequired?: boolean;

  @IsOptional()
  @IsISO8601()
  plannedFor?: string;
}

/**
 * EGY OTLET BEMENETE, ES SZANDEKOSAN KEVESEBB, MINT EGY VAZLATE.
 *
 * Nincs torzs, nincs kep-jelolo, nincs tervezett nap. Aki egy temat jegyez fel,
 * meg nem tudja ezeket -- es egy urlap, ami keri oket, arra tanit, hogy az
 * otlet rogzitese nagyobb munka, mint amekkora. A tobbit a kidolgozas lepese
 * utan lehet megadni.
 *
 * A cim es a csatorna azert marad, mert a Prisma modellben kotelezoek.
 */
export class ContentIdeaDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsIn(CONTENT_CHANNELS)
  channel!: (typeof CONTENT_CHANNELS)[number];
}
