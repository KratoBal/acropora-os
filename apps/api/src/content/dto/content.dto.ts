import {
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
}

export class ContentCommentDto {
  @IsString()
  @MinLength(1)
  body!: string;
}
