import { commonStateOf, commonStateText } from "../service-jobs/common-status";
import { SERVICE_JOB_STATUS_LABELS } from "../service-jobs/service-job-status";
import type { WorksheetDisplayStatus } from "../worksheets/worksheet-presentation";
import { WORKSHEET_DISPLAY_COMMON } from "../worksheets/worksheet-state";
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

/**
 * A kapcsolt lap neve a lap fajtája szerint (hibajegy-maradek lista, 4. fejezet, acrobot 56196; Balázs 2026-11-18: a karbantartásnak semmi köze a hibajegyekhez): a szerver a kártyán
 * `jobKind`-ot küld, a karbantartási lap a saját nevén szerepel. A fajta nélküli kártya (régi válasz) hibajegynek számít, ahogy a szerver is mondja.
 */
export function contextSubtitle(
  type: ConversationContextType,
  jobKind?: "REPAIR" | "MAINTENANCE" | null,
): string {
  if (type === "WORKSHEET") return "Munkalaphoz kapcsolva";
  return jobKind === "MAINTENANCE"
    ? "Karbantartási laphoz kapcsolva"
    : "Hibajegyhez kapcsolva";
}

export function contextCardTitle(
  type: ConversationContextType,
  jobKind?: "REPAIR" | "MAINTENANCE" | null,
): string {
  if (type === "WORKSHEET") return "KAPCSOLT MUNKALAP";
  return jobKind === "MAINTENANCE"
    ? "KAPCSOLT KARBANTARTÁSI LAP"
    : "KAPCSOLT HIBAJEGY";
}

/** A kapcsolás képernyőjének szövegei: a keresés a hibajegyeket ÉS a karbantartási lapokat együtt keresi (`kind=ALL`). */
export const LINK_COPY = {
  lead: "Keresd meg a munkalapot, a hibajegyet vagy a karbantartási lapot a száma szerint.",
  serviceJobTab: "Hibajegy / karbantartás",
  serviceJobPlaceholder: "a hibajegy vagy a karbantartási lap száma",
  dataScreenLink:
    "Kapcsolás munkalaphoz, hibajegyhez vagy karbantartási laphoz",
} as const;

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
  // a hibajegy kártyáján a KÖZÖS állapot az okkal, ha a szerver hozza (kártya 7f23785c, 5. szelet); munkalapnál és régi válasznál a mai felirat
  if (card.type !== "WORKSHEET") {
    const common = commonStateOf(card);
    if (common) return commonStateText(common);
  }
  // a munkalap kártyája a közös szavakkal (kártya 7f23785c, acrobot 62402): a válasz a megjelenített állapot kulcsát hozza
  if (card.type === "WORKSHEET")
    return Object.hasOwn(WORKSHEET_DISPLAY_COMMON, card.status)
      ? commonStateText(
          WORKSHEET_DISPLAY_COMMON[card.status as WorksheetDisplayStatus],
        )
      : null;
  const labels: Record<string, string> = SERVICE_JOB_STATUS_LABELS;
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
