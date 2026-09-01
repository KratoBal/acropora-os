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
