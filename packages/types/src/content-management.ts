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
 * EGY LÉPÉS, AHOGY A DRÓTON ÁTJÖN.
 *
 * A SZABÁLYOK A SZERVEREN ÉLNEK (`apps/api/src/content/content-state.ts`), és
 * ez a típus csak azt írja le, ami átjön belőlük. A felület NEM tartja a saját
 * listáját arról, mi a megengedett lépés: ha itt tartaná, egy nap a szerver
 * változna és a felület nem, és a különbség egy olyan gombban jelenne meg, ami
 * elutasításba fut.
 *
 * A `blockedByExternalWork` azért van itt, hogy a felület ELŐRE tudja
 * megmondani, ha egy lépés ma nem hajtható végre (ütemezett poszt visszavonása
 * a Facebookon). Egy gomb, ami hibába fut, azt tanítja meg, hogy a gombok néha
 * nem működnek.
 */
export interface ContentMoveOption {
  to: ContentState;
  requiresApproval: boolean;
  blockedByExternalWork: string | null;
  /**
   * A FOLYAMATBAN ELŐRE VIVŐ LÉPÉS, állapotonként legfeljebb egy. A felület ezt
   * emeli ki, a többit halkítja -- de a rangsort a szerver adja, különben
   * minden képernyő maga találná ki, melyik a kézenfekvő lépés.
   */
  primary: boolean;
}

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
  /**
   * MIT LEHET EBBŐL A SORBÓL LÉPNI. A szerver számolja, a felület megjeleníti.
   *
   * A MEZŐ KÖTELEZŐ, MERT A SZERVER MINDIG KÜLDI -- de ez a fordító ígérete,
   * nem a dróté. A típus arról szól, mit ír a mi kódunk; hogy a JSON, ami
   * megérkezik, tartalmazza-e, azt egy régebbi szerver vagy egy köztes réteg
   * eldöntheti másképp. A felület ezért futásidőben is számol a hiányával, és
   * ilyenkor egyszerűen nem mutat lépést -- nem hasal el.
   */
  moves: readonly ContentMoveOption[];
}

export type ContentListResponse = ContentListItem[];

/**
 * A „MI VÁR RÁM" NÉZET VÁLASZA.
 *
 * NEM CSAK LISTA, ÉS EZ SZÁNDÉKOS: a `notCovered` megnevezi, mit NEM fed le ez a
 * nézet. Ma a `sender` szerep nem vezethető le semmiből (nincs mező, nincs jog),
 * és egy „mi vár rám" lista, ami erről hallgat, azt a hamis megnyugvást adná,
 * hogy minden ott van. Aki nem tudja, hogy hiányzik valami, a hiányzót nem
 * létezőnek hiszi.
 */
export interface ContentWaitingOnMeResponse {
  items: ContentListItem[];
  notCovered: { role: ContentViewerRole; reason: string }[];
}
