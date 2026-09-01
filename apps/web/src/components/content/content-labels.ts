import type { ContentState, ContentViewerRole } from "@acropora/types";

/**
 * AZ ÁLLAPOTOK MAGYAR NEVE, ÉS AMI MELLETTÜK ÁLL: KIRE VÁR.
 *
 * A kettő EGYÜTT jelenik meg, mert a lista attól használható, hogy nem kell
 * fejben lefordítani egy állapotnevet cselekvéssé. Balázs panasza szó szerint
 * az volt, hogy nem látja, mi vár rá -- egy „AWAITING_APPROVAL" felirat ezen
 * nem segít.
 */
export const CONTENT_STATE_LABELS: Record<ContentState, string> = {
  IDEA: "ötlet",
  DRAFTING: "vázlat készül",
  AWAITING_REVIEW: "lektorálásra vár",
  AWAITING_REVISION: "javításra vár",
  AWAITING_APPROVAL: "jóváhagyásra vár",
  READY_TO_SEND: "kiküldésre kész",
  SCHEDULED: "ütemezve",
  SENT: "kiküldve",
  DISCARDED: "elvetve",
};

/**
 * KIRE VÁR, EMBERI ALAKBAN.
 *
 * Az „ütemezve" nem senkire vár, hanem az IDŐRE, és ez nem szójáték: ez az
 * egyetlen állapotunk, amiben a semmittevésnek határideje van (a 25. napon a
 * poszt törlődik, ha a dátum változatlan). Egy „senkire" felirat itt épp azt
 * sugallná, hogy nincs teendő.
 */
export const CONTENT_WAITS_ON_LABELS: Record<ContentState, string> = {
  IDEA: "senkire",
  DRAFTING: "a szerzőre",
  AWAITING_REVIEW: "a lektorra",
  AWAITING_REVISION: "a szerzőre",
  AWAITING_APPROVAL: "jóváhagyásra",
  READY_TO_SEND: "a kiküldőre",
  SCHEDULED: "a határidőre",
  SENT: "senkire",
  DISCARDED: "senkire",
};

export const CONTENT_ROLE_LABELS: Record<ContentViewerRole, string> = {
  author: "amit írok",
  reviewer: "amit lektorálok",
  approver: "amit jóváhagyok",
  sender: "amit kiküldök",
};

/**
 * A KÉP ÁLLAPOTA HÁROM ESET, NEM KETTŐ.
 *
 * A „nem kell kép" és a „megvan a kép" mindkettő rendben van, de MÁS: az első
 * esetben nincs is mit várni. Ha a lista csak azt mutatná, hogy hiányzik-e,
 * minden szöveges tétel örökre „rendben"-ként állna, és a különbség eltűnne.
 */
export function contentImageLabel(item: {
  imageRequired: boolean;
  imageAttachedAt: string | null;
}): { text: string; waiting: boolean } {
  if (!item.imageRequired) return { text: "nem kell kép", waiting: false };
  if (item.imageAttachedAt) return { text: "kép megvan", waiting: false };
  return { text: "képre vár", waiting: true };
}

/**
 * MENNYI IDEJE ÁLL EGY TÉTEL, EMBERI ALAKBAN.
 *
 * MIÉRT KELL KÜLÖN CÍMKE, ÉS MIÉRT NEM ELÉG A SZEKCIÓ: ma a hét hete álló és a
 * két napja készült tétel EGYFORMA jelvénnyel áll egymás mellett. A szekció
 * LÉTEZÉSE kiemeli a hat tételt, az egymáshoz képesti sürgősségük viszont nem
 * látszik -- azt megint soronként kell kiolvasni, pontosan az, amit el akartunk
 * kerülni.
 *
 * A HATÁR HÉT NAP, ÉS EZ DÖNTÉS: egy heti kör alatt minden tétel megkap egy
 * pillantást, tehát ami annál régebben áll, az KIMARADT valamiből. Nem
 * mérésből jön, hanem a munka ritmusából, és ezért mondom ki: ha kiderül, hogy
 * a kör nem heti, ez a szám az első, amit át kell írni.
 */
export const CONTENT_STALE_DAYS = 7;

export function contentAgeLabel(
  updatedAt: string,
  now: Date = new Date(),
): { text: string; stale: boolean; days: number } {
  const days = Math.floor(
    (now.getTime() - new Date(updatedAt).getTime()) / (24 * 60 * 60 * 1000),
  );

  // A JÖVŐBELI DÁTUM NEM HIBA, HANEM ÓRAELTÉRÉS. Egy „-2 napja" felirat a
  // felületen bizalmat visz el; a „ma" mindkét irányban helyes válasz arra,
  // amit a felhasználó lát.
  if (days <= 0) return { text: "ma", stale: false, days: 0 };
  if (days === 1) return { text: "1 napja", stale: false, days };
  if (days < 7) return { text: `${days} napja`, stale: false, days };

  const weeks = Math.floor(days / 7);
  return {
    text: weeks === 1 ? "1 hete" : `${weeks} hete`,
    stale: days >= CONTENT_STALE_DAYS,
    days,
  };
}

/**
 * A LEGRÉGEBBI TÉTEL KORA EGY LISTÁBAN, az összegző csíkhoz.
 *
 * ÜRES LISTÁRA `null`, nem nulla: a „0 napja" azt állítaná, hogy van egy tétel,
 * ami ma keletkezett -- holott nincs egy sem.
 */
export function oldestAge(
  items: readonly { updatedAt: string }[],
  now: Date = new Date(),
): ReturnType<typeof contentAgeLabel> | null {
  if (items.length === 0) return null;
  return items
    .map((item) => contentAgeLabel(item.updatedAt, now))
    .reduce((oldest, current) =>
      current.days > oldest.days ? current : oldest,
    );
}

/**
 * A LEGRÉGEBBI ELÖL. A képre váró listában ez a sorrend maga az információ: a
 * hét hete álló tétel nem keveredhet a tegnapiak közé.
 */
export function oldestFirst<T extends { updatedAt: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
  );
}
