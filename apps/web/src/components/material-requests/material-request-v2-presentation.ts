import type {
  MaterialRequestEventEntry,
  MaterialRequestItem,
  MaterialRequestPriorityValue,
  MaterialRequestStatusValue,
  MaterialRequestSummary,
  MaterialRequestView,
} from "@acropora/types";

/**
 * The system's number format, as the product pages write it
 * (`toLocaleString("hu-HU")`). The shared helper of the JEV work (#1407) is
 * not on main yet; once it is, this becomes that call.
 */
function formatHuNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("hu-HU", { maximumFractionDigits: 3 })
    : value;
}

/**
 * ANYAGIGÉNY V2: WHAT A REQUEST SAYS, AND HOW (Figma 404:533,
 * docs/material-requests/v2-discovery.md). Pure, so every rule is tested
 * without rendering. The server decides what the caller may do
 * (`actions` on the detail); nothing here re-derives permission.
 */

export type RequestTone = "warning" | "info" | "accent" | "success" | "neutral";

/** The Figma's pill words. */
export const STATUS_LABEL: Record<MaterialRequestStatusValue, string> = {
  DRAFT: "PISZKOZAT",
  OPEN: "ÚJ",
  IN_PROGRESS: "INTÉZÉS ALATT",
  ORDERED: "MEGRENDELVE",
  PARTIALLY_RECEIVED: "RÉSZBEN BEÉRKEZETT",
  RECEIVED: "BEÉRKEZETT",
  CANCELLED: "VISSZAVONT",
};

export const STATUS_TONE: Record<MaterialRequestStatusValue, RequestTone> = {
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
export function itemQuantity(item: MaterialRequestItem): string {
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
  item: MaterialRequestItem,
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

/** The card's footer left: "2 tétel · határidő: okt. 5." */
export function cardFooter(request: MaterialRequestSummary): string {
  const parts = [`${request.items.length} tétel`];
  if (request.neededBy)
    parts.push(`határidő: ${formatNeededBy(request.neededBy)}`);
  if (request.priority && request.priority !== "NORMAL")
    parts.push(PRIORITY_LABEL[request.priority].toLowerCase());
  return parts.join(" · ");
}

/** The card's sub-line: worksheet number, requester, when. */
export function cardByline(request: MaterialRequestSummary, now: Date): string {
  const parts = [request.worksheetNumber ?? "piszkozat munkalap"];
  if (request.requestedByName) parts.push(`kérte: ${request.requestedByName}`);
  if (request.submittedAt) parts.push(formatWhen(request.submittedAt, now));
  return parts.join(" · ");
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
 * ahead on the usual path shown greyed with "—" (Figma 404:342). Nothing is
 * read from the status: the rows are the history.
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

// ---------------------------------------------------------------------------
// The overview's filters (Figma 404:110).

export const OVERVIEW_FILTERS = [
  "active",
  "mine",
  "open",
  "in-progress",
  "ordered",
  "received",
  "cancelled",
] as const;
export type OverviewFilter = (typeof OVERVIEW_FILTERS)[number];

export const OVERVIEW_FILTER_LABEL: Record<OverviewFilter, string> = {
  active: "Aktív igények",
  mine: "Saját beszerzéseim",
  open: "Új",
  "in-progress": "Intézés alatt",
  ordered: "Megrendelve",
  received: "Beérkezett",
  cancelled: "Visszavont",
};

/** One filter as the server's query: a view, and a status inside it. */
export function filterQuery(filter: OverviewFilter): {
  view: MaterialRequestView;
  status?: MaterialRequestStatusValue;
} {
  switch (filter) {
    case "active":
      return { view: "active" };
    case "mine":
      return { view: "mine" };
    case "open":
      return { view: "active", status: "OPEN" };
    case "in-progress":
      return { view: "active", status: "IN_PROGRESS" };
    case "ordered":
      return { view: "active", status: "ORDERED" };
    case "received":
      return { view: "received" };
    case "cancelled":
      return { view: "cancelled" };
  }
}

export const EMPTY_MESSAGE: Record<OverviewFilter, string> = {
  active: "Nincs aktív anyagigény.",
  mine: "Nincs saját beszerzésed.",
  open: "Nincs új anyagigény.",
  "in-progress": "Nincs intézés alatt álló anyagigény.",
  ordered: "Nincs megrendelt, beérkezésre váró anyagigény.",
  received: "Nincs beérkezett anyagigény.",
  cancelled: "Nincs visszavont anyagigény.",
};
