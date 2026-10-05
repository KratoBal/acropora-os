import { SERVICE_JOB_STATUS_LABELS } from "../service-jobs/service-job-status";
import { worksheetDisplayStatusLabel } from "../worksheets/worksheet-presentation";
import type {
  ConversationContextCard,
  ConversationContextType,
  MessageItem,
} from "./types";

/**
 * AZ ÜZENETEK 4. FÁZISÁNAK TISZTA SZABÁLYAI A TELEFONON (terv:
 * uzenetek-4-fazis-terv.md, 2.4), a webes `phase4.ts` párja: a kapcsolt
 * munkalap kártyája (Figma 450:697), a rendszer-esemény (450:710), a lista
 * alcíme. A képernyőn csak a bekötés marad.
 */

export function contextSubtitle(type: ConversationContextType): string {
  return type === "WORKSHEET"
    ? "Munkalaphoz kapcsolva"
    : "Hibajegyhez kapcsolva";
}

export function contextCardTitle(type: ConversationContextType): string {
  return type === "WORKSHEET" ? "KAPCSOLT MUNKALAP" : "KAPCSOLT HIBAJEGY";
}

/**
 * A „Megnyitás” képernyője a telefonon; korlátozott kártyánál nincs (a
 * beszélgetés nem lehet kiskapu a szerviz-adatokhoz).
 */
export function contextRoute(card: ConversationContextCard): {
  pathname: "/worksheets/[id]" | "/service-jobs/[id]";
  params: { id: string };
} | null {
  if (card.restricted) return null;
  return {
    pathname:
      card.type === "WORKSHEET" ? "/worksheets/[id]" : "/service-jobs/[id]",
    params: { id: card.id },
  };
}

/** Az állapot felirata; ismeretlen értéknél semmi, nem a nyers kód. */
export function contextStatusLabel(
  card: ConversationContextCard,
): string | null {
  if (!card.status) return null;
  const labels: Record<string, string> =
    card.type === "WORKSHEET"
      ? worksheetDisplayStatusLabel
      : SERVICE_JOB_STATUS_LABELS;
  return labels[card.status] ?? null;
}

const MONTHS = [
  "jan.",
  "febr.",
  "márc.",
  "ápr.",
  "máj.",
  "jún.",
  "júl.",
  "aug.",
  "szept.",
  "okt.",
  "nov.",
  "dec.",
];

/** Budapest naptári napja, `2026-10-05` alakban (a `v2-presentation` napkulcsa). */
const budapestDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** „2026. okt. 5.”, Budapest szerint; a hónapnév saját táblából, nem a futtató ICU-jából. */
export function contextDateLabel(value: string | null): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const [year, month, day] = budapestDay.format(at).split("-").map(Number);
  return `${year}. ${MONTHS[month! - 1]} ${day}.`;
}

/** A kártya sora: szám, partner, állapot, dátum; korlátozottnál csak a szám. */
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

/** A rendszer-esemény: középen, buborék és hosszú nyomásos menü nélkül. */
export function isSystemMessage(message: Pick<MessageItem, "type">): boolean {
  return message.type === "SYSTEM";
}

/** Tag hozzáadása és kilépés csak csoportban. */
export function canManageMembers(type: "DIRECT" | "GROUP"): boolean {
  return type === "GROUP";
}
