import type {
  MaterialRequestActions,
  MaterialRequestEventEntry,
  MaterialRequestPriorityValue,
  MaterialRequestStatusCounts,
  MaterialRequestSummary,
  MaterialRequestV2Item,
  MaterialRequestView,
  MaterialRequestReceiveItemsInput,
} from "./types";
import type { MaterialRequestStatusValue } from "../worksheets/material-request-presentation";

/**
 * ANYAGIGÉNY V2 ON THE PHONE: WHAT A REQUEST SAYS, AND HOW (Figma 404:369
 * list, 404:431 detail). The same rules as the web
 * (`apps/web/src/components/material-requests/material-request-v2-presentation.ts`);
 * the Expo app cannot import the web, so they are copied, and the pill words
 * are compared by the API's `mobile-status-labels.spec.ts`.
 *
 * Pure and free of React Native, so `node --test` covers every rule. The
 * server decides what the user may do (`actions`); nothing here re-derives
 * permission.
 */

/**
 * How often an open screen re-reads. Someone else may claim a request at any
 * moment; the same 30 s as the web, plus a re-read whenever the screen comes
 * back into focus and on pull-to-refresh.
 */
export const MATERIAL_REQUEST_REFRESH_MS = 30_000;

export type RequestTone = "warning" | "info" | "accent" | "success" | "neutral";

/** The Figma's pill words. */
export const MATERIAL_REQUEST_PILL_LABEL: Record<
  MaterialRequestStatusValue,
  string
> = {
  DRAFT: "PISZKOZAT",
  OPEN: "ÚJ",
  IN_PROGRESS: "INTÉZÉS ALATT",
  ORDERED: "MEGRENDELVE",
  PARTIALLY_RECEIVED: "RÉSZBEN BEÉRKEZETT",
  RECEIVED: "BEÉRKEZETT",
  CANCELLED: "VISSZAVONT",
};

export const MATERIAL_REQUEST_PILL_TONE: Record<
  MaterialRequestStatusValue,
  RequestTone
> = {
  DRAFT: "neutral",
  OPEN: "warning",
  IN_PROGRESS: "info",
  ORDERED: "accent",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CANCELLED: "neutral",
};

export const PRIORITY_LABEL: Record<MaterialRequestPriorityValue, string> = {
  NORMAL: "Normál",
  HIGH: "Magas",
  URGENT: "Sürgős",
};

/** The system's number format, as the web writes it. */
export function formatHuNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("hu-HU", { maximumFractionDigits: 3 })
    : value;
}

const BUDAPEST = "Europe/Budapest";
const dayKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUDAPEST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("hu-HU", {
  timeZone: BUDAPEST,
  hour: "2-digit",
  minute: "2-digit",
});
const shortDate = new Intl.DateTimeFormat("hu-HU", {
  timeZone: BUDAPEST,
  month: "short",
  day: "numeric",
});

/** "ma 08:12", "tegnap 15:48", else "szept. 30." (Budapest calendar days). */
export function formatWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const today = dayKey.format(now);
  const yesterday = dayKey.format(
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
  );
  const day = dayKey.format(at);
  if (day === today) return `ma ${timeOnly.format(at)}`;
  if (day === yesterday) return `tegnap ${timeOnly.format(at)}`;
  return shortDate.format(at);
}

/** A `YYYY-MM-DD` deadline as "okt. 5." */
export function formatNeededBy(day: string): string {
  const at = new Date(`${day}T12:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? day : shortDate.format(at);
}

/**
 * "10 m", or, once something arrived on a numeric item, "12/14 db". The ratio
 * appears only where the quantity is a number (owner decision): a text
 * quantity ("kb 10") stays as written.
 */
export function itemQuantity(item: MaterialRequestV2Item): string {
  if (
    item.quantityValue !== null &&
    item.receivedQuantity !== null &&
    !item.arrived
  )
    return `${formatHuNumber(item.receivedQuantity)}/${formatHuNumber(item.quantityValue)} ${item.unit}`.trim();
  return `${item.quantity} ${item.unit}`.trim();
}

/** The item's own line under its name. */
export function itemState(
  status: MaterialRequestStatusValue,
  item: MaterialRequestV2Item,
): string {
  if (item.arrived) return "Beérkezett";
  if (item.receivedQuantity !== null || item.receivedAt !== null)
    return "Részben beérkezett";
  switch (status) {
    case "OPEN":
      return "Beszerzésre vár";
    case "IN_PROGRESS":
      return "Nincs megrendelve";
    case "ORDERED":
    case "PARTIALLY_RECEIVED":
      return "Megrendelve";
    case "CANCELLED":
      return "Visszavonva";
    default:
      return "Piszkozat";
  }
}

/** "Nincs felelős" (amber) or "Intézi: Nagy Petra" (accent); nothing once closed. */
export function handlerLine(
  request: Pick<MaterialRequestSummary, "status" | "handlerName" | "handlerId">,
): { text: string; tone: "warning" | "accent" } | null {
  if (request.status === "CANCELLED" || request.status === "DRAFT") return null;
  if (request.handlerId === null)
    return request.status === "OPEN"
      ? { text: "Nincs felelős", tone: "warning" }
      : null;
  return {
    text: `Intézi: ${request.handlerName ?? "ismeretlen kolléga"}`,
    tone: "accent",
  };
}

/** The card's sub-line (Figma 404:369): "ML-2026-0148 · ma 08:12". */
export function cardByline(request: MaterialRequestSummary, now: Date): string {
  const parts = [request.worksheetNumber ?? "piszkozat munkalap"];
  if (request.submittedAt) parts.push(formatWhen(request.submittedAt, now));
  return parts.join(" · ");
}

/** The card's item line: "PVC cső 10 m · könyök 6 db", at most three, then "+2". */
export function cardItemsLine(request: MaterialRequestSummary): string {
  const shown = request.items
    .slice(0, 3)
    .map((item) => `${item.name} ${itemQuantity(item)}`);
  const rest = request.items.length - shown.length;
  return rest > 0 ? `${shown.join(" · ")} · +${rest}` : shown.join(" · ");
}

/** The detail's second line: "Kérte: Kovács Ádám · ma 08:12". */
export function requestedLine(
  request: MaterialRequestSummary,
  now: Date,
): string {
  const parts = [`Kérte: ${request.requestedByName ?? "ismeretlen kolléga"}`];
  if (request.submittedAt) parts.push(formatWhen(request.submittedAt, now));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The list's header and segments (Figma 404:369).

export const MOBILE_SEGMENTS = ["active", "mine", "received"] as const;
export type MobileSegment = (typeof MOBILE_SEGMENTS)[number];

export const MOBILE_SEGMENT_LABEL: Record<MobileSegment, string> = {
  active: "Aktív",
  mine: "Saját",
  received: "Beérkezett",
};

export function segmentView(segment: MobileSegment): MaterialRequestView {
  return segment;
}

export const MOBILE_EMPTY_MESSAGE: Record<MobileSegment, string> = {
  active: "Nincs aktív anyagigény.",
  mine: "Nincs saját beszerzésed.",
  received: "Nincs beérkezett anyagigény.",
};

/** "4 aktív · 1 új"; `null` while the counts are unknown, never a zero. */
export function headerSummary(
  counts: MaterialRequestStatusCounts | null,
): string | null {
  if (!counts) return null;
  const active =
    counts.open + counts.inProgress + counts.ordered + counts.partiallyReceived;
  return `${active} aktív · ${counts.open} új`;
}

/** "1 új anyagigény vár átvételre", only when there is one. */
export function newRequestsBanner(
  counts: MaterialRequestStatusCounts | null,
): string | null {
  if (!counts || counts.open === 0) return null;
  return `${counts.open} új anyagigény vár átvételre`;
}

// ---------------------------------------------------------------------------
// The detail's actions (Figma 404:431: one sticky primary action).

export type PrimaryAction = "claim" | "order" | "receive";

export const PRIMARY_ACTION_LABEL: Record<PrimaryAction, string> = {
  claim: "Én intézem a beszerzést",
  order: "Megrendeltem",
  receive: "Beérkezett",
};

/**
 * The one next step the sticky bar offers: claim, else order, else receive.
 * Only what `actions` allows; nothing when the server allows none of them
 * (the secondary steps stay in the "Beszerzés" card).
 */
export function primaryAction(
  actions: MaterialRequestActions,
): PrimaryAction | null {
  if (actions.claim) return "claim";
  if (actions.order) return "order";
  if (actions.receive) return "receive";
  return null;
}

/** The "Beszerzés" card's sentence (Figma 404:431). */
export function procurementSentence(
  request: Pick<MaterialRequestSummary, "status" | "handlerId" | "handlerName">,
  canClaim: boolean,
): { text: string; tone: "warning" | "neutral" } {
  if (request.status === "OPEN" && request.handlerId === null)
    return canClaim
      ? { text: "Még senki nem vállalta el.", tone: "warning" }
      : {
          text: "Még senki nem vállalta el. A beszerzést a beszerzési joggal rendelkező kollégák vállalhatják.",
          tone: "warning",
        };
  if (request.status === "CANCELLED")
    return { text: "Az igényt visszavonták.", tone: "neutral" };
  if (request.status === "RECEIVED")
    return { text: "Minden tétel beérkezett.", tone: "neutral" };
  return {
    text: `Intézi: ${request.handlerName ?? "ismeretlen kolléga"}`,
    tone: "neutral",
  };
}

/** The confirmation's text before a withdrawal. */
export function cancelConsequence(
  request: Pick<MaterialRequestSummary, "handlerId" | "handlerName">,
): string {
  return request.handlerId
    ? `A beszerzést ${request.handlerName ?? "a felelős kolléga"} intézi; értesítést kap, hogy nincs vele további teendő. A visszavont igény nem állítható vissza.`
    : "Az igény kikerül az aktív listából. A visszavont igény nem állítható vissza.";
}

/**
 * The partial receipt: a numeric item takes the new TOTAL that arrived, a
 * text item the "Megjött" mark. Only changed items are sent; `null` when
 * nothing changed (the button stays disabled).
 */
export function partialReceiptChanges(
  items: readonly MaterialRequestV2Item[],
  totals: Readonly<Record<string, string>>,
  marks: Readonly<Record<string, boolean>>,
): MaterialRequestReceiveItemsInput | null {
  const changes: MaterialRequestReceiveItemsInput["items"] = [];
  for (const item of items) {
    if (item.arrived) continue;
    if (item.quantityValue !== null) {
      const total = (totals[item.id] ?? "").trim().replace(",", ".");
      if (total && total !== (item.receivedQuantity ?? ""))
        changes.push({ itemId: item.id, receivedQuantity: total });
    } else if (marks[item.id]) {
      changes.push({ itemId: item.id, arrived: true });
    }
  }
  return changes.length ? { items: changes } : null;
}

// ---------------------------------------------------------------------------
// The history (Státusztörténet).

export function eventLabel(event: MaterialRequestEventEntry): string {
  switch (event.kind) {
    case "SUBMITTED":
      return "Igény beküldve";
    case "CLAIMED":
      return "Beszerzés átvéve";
    case "REASSIGNED":
      return event.newHandlerName
        ? `Átadva: ${event.newHandlerName}`
        : "Felelős módosítva";
    case "ORDERED":
      return "Megrendelve";
    case "ITEMS_RECEIVED":
      return event.toStatus === "PARTIALLY_RECEIVED"
        ? "Részben beérkezett"
        : "Tételek beérkeztek";
    case "RECEIVED":
      return "Beérkezett";
    case "CANCELLED":
      return "Visszavonva";
  }
}

export interface TimelineStep {
  key: string;
  label: string;
  detail: string;
  kind: "done" | "current" | "pending";
}

/**
 * The recorded steps, the last one marked current, then the steps still
 * ahead on the usual path, greyed with "—". Nothing is read from the status
 * but what is still ahead: the rows are the history.
 */
export function timeline(
  status: MaterialRequestStatusValue,
  events: readonly MaterialRequestEventEntry[],
  now: Date,
): TimelineStep[] {
  const steps: TimelineStep[] = events.map((event, index) => ({
    key: event.id,
    label: eventLabel(event),
    detail: [formatWhen(event.createdAt, now), event.actorName]
      .filter(Boolean)
      .join(" · "),
    kind: index === events.length - 1 ? "current" : "done",
  }));
  const ahead: [MaterialRequestStatusValue[], string][] = [
    [["OPEN", "IN_PROGRESS"], "Megrendelve"],
    [["OPEN", "IN_PROGRESS", "ORDERED", "PARTIALLY_RECEIVED"], "Beérkezett"],
  ];
  for (const [whileIn, label] of ahead)
    if (whileIn.includes(status))
      steps.push({
        key: `pending:${label}`,
        label,
        detail: "—",
        kind: "pending",
      });
  return steps;
}
