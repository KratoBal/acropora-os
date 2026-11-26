import type {
  ConversationContextCard,
  ConversationContextType,
  MessageItem,
} from "@acropora/types";
import { commonServiceStateText } from "@acropora/types";

import { serviceJobStatusLabel } from "@/components/service-jobs/service-job-labels";
import { commonStateOfDisplayStatus } from "@/components/worksheets/worksheet-labels";

/**
 * AZ ÜZENETEK 4. FÁZISÁNAK TISZTA SZABÁLYAI A WEBEN (terv:
 * uzenetek-4-fazis-terv.md, 2.4): a kapcsolt munkalap vagy hibajegy kártyája,
 * a lista alcíme és a rendszer-esemény sora. A képernyőn csak a bekötés marad.
 */

/** A kapcsolt jegy fajtája: a karbantartási lap nem hibajegy (Balázs, 2026-11-18 11:31 UTC; acrobot 56118). Hiányzó érték: hibajegy. */
type JobKind = "REPAIR" | "MAINTENANCE";

/** A lista és a fejléc alcíme (Figma 450:323). */
export function contextSubtitle(
  type: ConversationContextType,
  jobKind?: JobKind | null,
): string {
  if (type === "WORKSHEET") return "Munkalaphoz kapcsolva";
  return jobKind === "MAINTENANCE"
    ? "Karbantartási laphoz kapcsolva"
    : "Hibajegyhez kapcsolva";
}

/** A kártya címkéje: „KAPCSOLT MUNKALAP”. */
export function contextCardTitle(
  type: ConversationContextType,
  jobKind?: JobKind | null,
): string {
  if (type === "WORKSHEET") return "KAPCSOLT MUNKALAP";
  return jobKind === "MAINTENANCE"
    ? "KAPCSOLT KARBANTARTÁSI LAP"
    : "KAPCSOLT HIBAJEGY";
}

/**
 * A „Megnyitás” célja. Aki a szervizt nem látja (`restricted`), annak NINCS:
 * a beszélgetés nem lehet kiskapu a szerviz-adatokhoz (a terv 2.2).
 */
export function contextHref(card: ConversationContextCard): string | null {
  if (card.restricted) return null;
  const id = encodeURIComponent(card.id);
  if (card.type === "WORKSHEET") return `/szerviz/munkalapok/${id}`;
  return card.jobKind === "MAINTENANCE"
    ? `/szerviz/karbantartas/${id}`
    : `/szerviz/hibajegyek/${id}`;
}

/** Az állapot felirata; ismeretlen értéknél semmi (a szerver újabb lehet a kliensnél). */
export function contextStatusLabel(
  card: ConversationContextCard,
): string | null {
  if (!card.status) return null;
  // a jegy közös állapota (kártya 7f23785c), ha a szerver küldi: a karbantartási lapé is (Lezárt / Folyamatban, a saját szabályával)
  if (card.type === "SERVICE_JOB" && card.commonStatus)
    return commonServiceStateText({
      status: card.commonStatus,
      reason: card.commonReason ?? null,
    });
  // a karbantartási lapnak nincs hibajegy-állapota (Balázs, 2026-11-18 11:31 UTC): a kártya nem mond "Új"-at róla
  if (card.type === "SERVICE_JOB" && card.jobKind === "MAINTENANCE")
    return null;
  // a munkalap kártyája a közös szavakkal (kártya 7f23785c, acrobot 62402): a válasz a megjelenített állapot kulcsát hozza
  if (card.type === "WORKSHEET") {
    const common = commonStateOfDisplayStatus(card.status);
    return common ? commonServiceStateText(common) : null;
  }
  const labels: Record<string, string> = serviceJobStatusLabel;
  return labels[card.status] ?? null;
}

/** „2026. okt. 5.”, Budapest szerint. */
export function contextDateLabel(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("hu-HU", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * A kártya sora a cím után: szám, partner, állapot, dátum. Korlátozott
 * kártyánál csak a szám (a szerver a többit ki sem adja).
 */
export function contextCardParts(card: ConversationContextCard): string[] {
  const number = card.number ?? "szám nélkül";
  if (card.restricted) return [number];
  return [
    number,
    card.partnerName,
    contextStatusLabel(card),
    contextDateLabel(card.createdAt),
  ].filter((part): part is string => !!part);
}

/** A rendszer-esemény (csatolás, tag hozzáadása, kilépés): buborék és művelet-menü nélkül. */
export function isSystemMessage(message: Pick<MessageItem, "type">): boolean {
  return message.type === "SYSTEM";
}

/**
 * A HIBAJEGY PARTNERES BESZÉLGETÉSE (bd46ff05, a #1531 szerint): a belső
 * oldalon rögzített. Csatolmány, tag, kilépés, kötés és a BELE továbbítás a
 * szerveren 400, ezért a felület meg sem mutatja őket.
 */
export function isPartnerConversation(item: {
  audience?: string | null;
}): boolean {
  return item.audience === "PARTNER";
}

/** Kilépni és tagot hozzáadni csak csoportban lehet; a direkt beszélgetés két emberé. */
export function canManageMembers(type: "DIRECT" | "GROUP"): boolean {
  return type === "GROUP";
}
