import { Prisma } from "@acropora/database";
import {
  MATERIAL_REQUEST_LEADER_ROLES,
  type MaterialRequestActions,
  type MaterialRequestStatusValue,
  type UserRole,
} from "@acropora/types";

/**
 * THE V2 MATERIAL-REQUEST STATE MACHINE (docs/material-requests/v2-discovery.md,
 * owner decisions of 2026-10-02). Pure: the service enforces it, and the
 * detail DTO's `actions` is computed from it, so the buttons a client shows
 * and the transitions the server accepts can never differ.
 *
 *   DRAFT ─submit─▶ OPEN ─claim─▶ IN_PROGRESS ─order─▶ ORDERED ─▶ PARTIALLY_RECEIVED ─▶ RECEIVED
 *                    │                │                   └──────────────────────────▶ RECEIVED
 *                    │                └── receive (in stock / bought locally) ───────▶ RECEIVED
 *                    └────────┴── cancel (requester or leader) ─────────────────────▶ CANCELLED
 *
 * Forward only. RECEIVED and CANCELLED are terminal. Only the handler or a
 * leader changes a claimed request's state.
 */

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type MaterialRequestAction = keyof MaterialRequestActions;

export interface WorkflowRequest {
  status: MaterialRequestStatusValue;
  requestedById: string | null;
  handlerId: string | null;
}

export interface WorkflowActor {
  id: string;
  role: UserRole;
  /** Holds the purchasing capability (`MATERIAL_REQUEST_MARK_RECEIVED`). */
  canHandle: boolean;
}

export function isLeader(role: UserRole): boolean {
  return (MATERIAL_REQUEST_LEADER_ROLES as readonly string[]).includes(role);
}

const CLAIMED_STATES: readonly MaterialRequestStatusValue[] = [
  "IN_PROGRESS",
  "ORDERED",
  "PARTIALLY_RECEIVED",
];

/** What this actor may do on this request now. */
export function availableActions(
  request: WorkflowRequest,
  actor: WorkflowActor,
): MaterialRequestActions {
  const leader = isLeader(actor.role);
  const handlerOrLeader = leader || request.handlerId === actor.id;
  const status = request.status;
  return {
    claim:
      status === "OPEN" &&
      request.handlerId === null &&
      (actor.canHandle || leader),
    reassign: CLAIMED_STATES.includes(status) && handlerOrLeader,
    order: status === "IN_PROGRESS" && handlerOrLeader,
    receiveItems:
      (status === "ORDERED" || status === "PARTIALLY_RECEIVED") &&
      handlerOrLeader,
    receive: CLAIMED_STATES.includes(status) && handlerOrLeader,
    cancel:
      (status === "OPEN" || status === "IN_PROGRESS") &&
      (leader || request.requestedById === actor.id),
    comment: status !== "DRAFT",
  };
}

/**
 * THE QUANTITY RULE, the same as the migration's backfill: a plain
 * non-negative number with at most one decimal comma or point, up to 9
 * integer digits and 3 decimals (it must fit DECIMAL(12,3) without rounding).
 * Returns a normalized decimal string ("2.5"), or `null` for anything else
 * ("10 méter", "kb 10", "2-3"), which stays text only.
 */
export function parseQuantityValue(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[0-9]{1,9}([.,][0-9]{1,3})?$/.test(trimmed)) return null;
  return new Decimal(trimmed.replace(",", ".")).toString();
}

export interface WorkflowItem {
  id: string;
  quantityValue: Decimal | null;
  receivedQuantity: Decimal | null;
  receivedAt: Date | null;
}

/** An item has arrived: numeric when the total reached the request, text when marked. */
export function itemArrived(item: WorkflowItem): boolean {
  if (item.quantityValue !== null)
    return (
      item.receivedQuantity !== null &&
      item.receivedQuantity.greaterThanOrEqualTo(item.quantityValue)
    );
  return item.receivedAt !== null;
}

/** Anything arrived at all (a partial quantity counts). */
function itemTouched(item: WorkflowItem): boolean {
  return (
    item.receivedAt !== null ||
    (item.receivedQuantity !== null && item.receivedQuantity.greaterThan(0))
  );
}

/** The status the items imply: every item arrived → RECEIVED, some → PARTIALLY_RECEIVED. */
export function statusFromItems(
  items: readonly WorkflowItem[],
): "RECEIVED" | "PARTIALLY_RECEIVED" | null {
  if (items.length > 0 && items.every(itemArrived)) return "RECEIVED";
  if (items.some(itemTouched)) return "PARTIALLY_RECEIVED";
  return null;
}

export interface ItemReceiptInput {
  itemId: string;
  receivedQuantity?: string;
  arrived?: boolean;
}

export type ItemReceiptResult =
  | { ok: true; items: WorkflowItem[]; changedItemIds: string[] }
  | { ok: false; message: string };

/**
 * Applies one receiving step to the items, without touching the database.
 * Numeric items take a new TOTAL that may not go down (forward only); text
 * items take the "megjött" mark. An input that changes nothing is refused,
 * so an accidental double submit cannot write an empty history row.
 */
export function applyItemReceipts(
  items: readonly WorkflowItem[],
  inputs: readonly ItemReceiptInput[],
  now: Date,
): ItemReceiptResult {
  const byId = new Map(items.map((item) => [item.id, { ...item }]));
  const changed = new Set<string>();
  for (const input of inputs) {
    const item = byId.get(input.itemId);
    if (!item)
      return { ok: false, message: "Ismeretlen tétel az anyagigényen." };
    if (item.quantityValue !== null) {
      if (input.receivedQuantity === undefined)
        return {
          ok: false,
          message:
            "Számmal megadott tételnél a beérkezett mennyiséget kell megadni.",
        };
      const parsed = parseQuantityValue(input.receivedQuantity);
      if (parsed === null)
        return { ok: false, message: "A beérkezett mennyiség nem szám." };
      const total = new Decimal(parsed);
      if (
        item.receivedQuantity !== null &&
        total.lessThan(item.receivedQuantity)
      )
        return {
          ok: false,
          message: "A beérkezett mennyiség nem csökkenhet.",
        };
      if (item.receivedQuantity !== null && total.equals(item.receivedQuantity))
        continue;
      item.receivedQuantity = total;
      if (item.receivedAt === null && itemArrived(item)) item.receivedAt = now;
      changed.add(item.id);
    } else {
      if (input.arrived !== true)
        return {
          ok: false,
          message:
            "Szöveges mennyiségű tételnél csak a „megjött” jelölés adható meg.",
        };
      if (item.receivedAt !== null) continue;
      item.receivedAt = now;
      changed.add(item.id);
    }
  }
  if (changed.size === 0)
    return { ok: false, message: "A megadott tételeken nincs mit rögzíteni." };
  return { ok: true, items: [...byId.values()], changedItemIds: [...changed] };
}

/** "Beérkezett": every remaining item arrives in full. */
export function receiveAllItems(
  items: readonly WorkflowItem[],
  now: Date,
): { items: WorkflowItem[]; changedItemIds: string[] } {
  const changed: string[] = [];
  const next = items.map((item) => {
    if (itemArrived(item)) return item;
    changed.push(item.id);
    return {
      ...item,
      receivedQuantity: item.quantityValue ?? item.receivedQuantity,
      receivedAt: item.receivedAt ?? now,
    };
  });
  return { items: next, changedItemIds: changed };
}
