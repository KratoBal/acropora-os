import type {
  ConversationContextCard,
  ConversationContextType,
  MessageItem,
  ServiceJobStatusValue,
  WorksheetDisplayStatus,
} from "@acropora/types";
import { worksheetDisplayStatusLabel } from "@acropora/types";

import { serviceJobStatusLabel } from "@/components/service-jobs/service-job-labels";

/**
 * AZ ÜZENETEK 4. FÁZISÁNAK TISZTA SZABÁLYAI A WEBEN (terv:
 * uzenetek-4-fazis-terv.md, 2.4): a kapcsolt munkalap vagy hibajegy kártyája,
 * a lista alcíme és a rendszer-esemény sora. A képernyőn csak a bekötés marad.
 */

/** A lista és a fejléc alcíme (Figma 450:323). */
export function contextSubtitle(type: ConversationContextType): string {
  return type === "WORKSHEET"
    ? "Munkalaphoz kapcsolva"
    : "Hibajegyhez kapcsolva";
}

/** A kártya címkéje: „KAPCSOLT MUNKALAP”. */
export function contextCardTitle(type: ConversationContextType): string {
  return type === "WORKSHEET" ? "KAPCSOLT MUNKALAP" : "KAPCSOLT HIBAJEGY";
}

/**
 * A „Megnyitás” célja. Aki a szervizt nem látja (`restricted`), annak NINCS:
 * a beszélgetés nem lehet kiskapu a szerviz-adatokhoz (a terv 2.2).
 */
export function contextHref(card: ConversationContextCard): string | null {
  if (card.restricted) return null;
  const id = encodeURIComponent(card.id);
  return card.type === "WORKSHEET"
    ? `/szerviz/munkalapok/${id}`
    : `/szerviz/hibajegyek/${id}`;
}

/** Az állapot felirata; ismeretlen értéknél semmi (a szerver újabb lehet a kliensnél). */
export function contextStatusLabel(
  card: ConversationContextCard,
): string | null {
  if (!card.status) return null;
  const labels: Record<string, string> =
    card.type === "WORKSHEET"
      ? (worksheetDisplayStatusLabel as Record<WorksheetDisplayStatus, string>)
      : (serviceJobStatusLabel as Record<ServiceJobStatusValue, string>);
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

/** Kilépni és tagot hozzáadni csak csoportban lehet; a direkt beszélgetés két emberé. */
export function canManageMembers(type: "DIRECT" | "GROUP"): boolean {
  return type === "GROUP";
}
