/**
 * A TARTALOM-SOR MEGOSZTOTT TÍPUSAI.
 *
 * A `ContentState` és a „kire vár" fogalma az API oldalán tiszta függvényekben
 * él (`apps/api/src/content/content-state.ts`), ahol mérve is van. Ez a fájl
 * csak a DRÓTON átmenő alakot írja le, hogy a web ne találgassa.
 */
export type ContentState =
  | "IDEA"
  | "DRAFTING"
  | "AWAITING_REVIEW"
  | "AWAITING_REVISION"
  | "AWAITING_APPROVAL"
  | "READY_TO_SEND"
  | "SCHEDULED"
  | "SENT"
  | "DISCARDED";

export type ContentChannel =
  "FACEBOOK_POST" | "FACEBOOK_AD" | "ARTICLE" | "OTHER";

/** Melyik szerep szemével kérdezzük, hogy „mi vár rám". */
export type ContentViewerRole = "author" | "reviewer" | "approver" | "sender";

/**
 * EGY SOR A LISTÁBAN.
 *
 * A `body` SZÁNDÉKOSAN HIÁNYZIK: egy lista sosem mutatja a teljes szöveget, és
 * ami nem látszik, azt nem is kell átküldeni.
 *
 * A KÉP KÉT MEZŐ, NEM EGY. Az `imageRequired` azt mondja meg, kell-e, az
 * `imageAttachedAt` azt, hogy megvan-e. Egy összevont „hiányzik a kép" jelző
 * elveszítené azt az esetet, ahol nem is kell -- és a listát tele lenne
 * hamis figyelmeztetéssel.
 */
export interface ContentListItem {
  id: string;
  title: string;
  channel: ContentChannel;
  state: ContentState;
  imageRequired: boolean;
  imageAttachedAt: string | null;
  authorId: string | null;
  reviewerId: string | null;
  plannedFor: string | null;
  scheduledFor: string | null;
  scheduleAnchoredAt: string | null;
  sentAt: string | null;
  externalUrl: string | null;
  updatedAt: string;
}

export type ContentListResponse = ContentListItem[];
