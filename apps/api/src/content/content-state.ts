/**
 * A TARTALOM ÚTJA: kilenc állapot, és mindegyik mellett az, hogy KIRE VÁR.
 *
 * MIÉRT A „KIRE VÁR" A LÉNYEG, ÉS NEM AZ ÁLLAPOT NEVE: a panasz, amiből ez a
 * felület készül, nem a jóváhagyásról szólt, hanem arról, hogy sem Balázs, sem
 * Luca nem látja, mi vár rájuk. Egy állapot, ami nem mondja meg, kinek kell
 * lépnie, ugyanaz a lista, ami ma három helyen áll és egyik sem frissül.
 *
 * A KÉP NEM ÁLLAPOT, HANEM FELTÉTEL, és ez a modell legfontosabb döntése.
 * Ma hat kész szövegű poszt vár kizárólag fotóra. Ha a „képre vár" állapot
 * lenne, azok ott állnának -- és ELVESZNE az az információ, hogy a szövegük már
 * jóvá van hagyva. Egy állapotgép, ami két független feltételt egy tengelyre
 * húz, mindig az egyiket felejti el. Az állapot a SZÖVEG útja; a kép külön
 * feltétel, és a „mi vár Lucára képért" ezért szűrés, nem állapot.
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

/**
 * KI AZ, AKIRE EGY TÉTEL VÁR.
 *
 * A `nobody` nem ugyanaz, mint a „kész": az ötlet is senkire vár, és a kiküldött
 * is. A különbséget az állapot mondja meg, ez a mező azt, hogy kell-e valakinek
 * MOST lépnie.
 */
export type ContentWaitsOn =
  | { on: "nobody" }
  | { on: "author" }
  | { on: "reviewer" }
  | { on: "approver" }
  | { on: "sender" }
  | { on: "schedule" };

export interface ContentItemState {
  state: ContentState;
  /** Kell-e kép ehhez a tételhez. A szövegtől FÜGGETLEN feltétel. */
  imageRequired: boolean;
  /** Megvan-e a kép. */
  imageAttached: boolean;
}

/**
 * MI HIÁNYZIK EGY TÉTELHEZ, AZ ÁLLAPOTÁN FELÜL.
 *
 * A kép külön szerepel, mert egy tétel egyszerre lehet jóváhagyott szövegű ÉS
 * képre váró. A hívó ezt a két adatot EGYÜTT mutatja, nem összevonva.
 */
export interface ContentBlockers {
  waitsOn: ContentWaitsOn;
  /** Igaz, ha a kép hiányzik és kell. A szöveg állapotától független. */
  waitsForImage: boolean;
}

const WAITS_ON: Record<ContentState, ContentWaitsOn["on"]> = {
  IDEA: "nobody",
  DRAFTING: "author",
  AWAITING_REVIEW: "reviewer",
  AWAITING_REVISION: "author",
  AWAITING_APPROVAL: "approver",
  READY_TO_SEND: "sender",
  SCHEDULED: "schedule",
  SENT: "nobody",
  DISCARDED: "nobody",
};

export function contentBlockers(item: ContentItemState): ContentBlockers {
  return {
    waitsOn: { on: WAITS_ON[item.state] },
    // A KÉP AKKOR IS HIÁNYOZHAT, HA A SZÖVEG KÉSZ, és akkor is megvan, ha a
    // szöveg még vázlat. A két kérdés nem metszi egymást, és a lista mindkettőt
    // mutatja.
    waitsForImage: item.imageRequired && !item.imageAttached,
  };
}

/**
 * AZ ÁTMENETEK. Ami itt nincs felsorolva, az nem megengedett.
 *
 * MIÉRT ZÁRT LISTA, ÉS NEM SZABAD MOZGÁS: a jóváhagyás kapu, nem címke. Balázs
 * szabálya szó szerint az, hogy egyelőre semmi nem mehet ki nélküle vagy Luca
 * nélkül; egy szabadon állítható állapotmező ezt a kaput az első kényelmes
 * pillanatban megkerülné.
 *
 * A VISSZAKÖR SZÁNDÉKOSAN ISMÉTELHETŐ: a lektorálás és a javítás között egy
 * tétel akárhányszor oda-vissza mehet. A mai menet mérése szerint ez egy
 * tételen háromszor is megtörténik, és egy egyirányú modell ezt hazugsággá
 * tenné.
 *
 * AZ ELVETÉS BÁRHONNAN ELÉRHETŐ, kivéve a már kiküldöttet: amit egyszer láttak,
 * azt nem lehet meg nem történtté tenni. Egy `SENT -> DISCARDED` átmenet épp azt
 * az egy tényt törölné, amit a legdrágább volt visszaszerezni.
 */
const TRANSITIONS: Record<ContentState, readonly ContentState[]> = {
  IDEA: ["DRAFTING", "DISCARDED"],
  DRAFTING: ["AWAITING_REVIEW", "DISCARDED"],
  AWAITING_REVIEW: ["AWAITING_REVISION", "AWAITING_APPROVAL", "DISCARDED"],
  AWAITING_REVISION: ["AWAITING_REVIEW", "DISCARDED"],
  AWAITING_APPROVAL: ["AWAITING_REVISION", "READY_TO_SEND", "DISCARDED"],
  READY_TO_SEND: ["SCHEDULED", "SENT", "AWAITING_REVISION", "DISCARDED"],
  // AZ ÜTEMEZÉS VISSZAVONHATÓ, amíg a poszt nem ment ki: a `SCHEDULED ->
  // READY_TO_SEND` az az út, amin egy ütemezett tétel visszakerül a sorba,
  // mielőtt a lejárata törölné.
  SCHEDULED: ["SENT", "READY_TO_SEND", "DISCARDED"],
  SENT: [],
  DISCARDED: ["DRAFTING"],
};

export function canMove(from: ContentState, to: ContentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedMoves(from: ContentState): readonly ContentState[] {
  return TRANSITIONS[from];
}
