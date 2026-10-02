import type { MaterialRequestStatusValue } from "../worksheets/material-request-presentation";

/**
 * ANYAGIGÉNY V2 TYPES ON THE PHONE. Copies of
 * `packages/types/src/material-request-management.ts`, field by field (the
 * Expo app does not pull the workspace packages); the API's
 * `mobile-response-mirror.spec.ts` compares the names, and
 * `mobile-request-body.spec.ts` the request bodies against the DTOs.
 *
 * No other imports, on purpose: the rules in `v2-presentation.ts` read these
 * types and are compiled by `node --test`, which cannot resolve `@/` paths.
 */

export type MaterialRequestPriorityValue = "NORMAL" | "HIGH" | "URGENT";
export type MaterialRequestView = "active" | "mine" | "received" | "cancelled";

/** One item as V2 reads it: the numeric value and the receipt beside the text. */
export interface MaterialRequestV2Item {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  /** The parsed number, `null` when the quantity is text ("kb 10"). */
  quantityValue: string | null;
  /** Numeric items: the total received so far. */
  receivedQuantity: string | null;
  receivedAt: string | null;
  arrived: boolean;
}

/** One overview row: the request with its worksheet context. */
export interface MaterialRequestSummary {
  id: string;
  worksheetId: string;
  status: MaterialRequestStatusValue;
  requestedByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  handlerId: string | null;
  handlerName: string | null;
  handlerAssignedAt: string | null;
  orderedAt: string | null;
  orderedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  note: string | null;
  neededBy: string | null;
  priority: MaterialRequestPriorityValue | null;
  items: MaterialRequestV2Item[];
  worksheetNumber: string | null;
  customerDisplayName: string;
  departmentName: string;
}

export interface MaterialRequestPage {
  items: MaterialRequestSummary[];
  nextCursor: string | null;
}

export interface MaterialRequestStatusCounts {
  open: number;
  inProgress: number;
  ordered: number;
  partiallyReceived: number;
  receivedLast7Days: number;
}

export type MaterialRequestEventKindValue =
  | "SUBMITTED"
  | "CLAIMED"
  | "REASSIGNED"
  | "ORDERED"
  | "ITEMS_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export interface MaterialRequestEventEntry {
  id: string;
  kind: MaterialRequestEventKindValue;
  fromStatus: MaterialRequestStatusValue | null;
  toStatus: MaterialRequestStatusValue | null;
  actorName: string | null;
  createdAt: string;
  previousHandlerName?: string | null;
  newHandlerName?: string | null;
}

export interface MaterialRequestCommentEntry {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

/** What THIS user may do now; the server computes it with the rules it enforces. */
export interface MaterialRequestActions {
  claim: boolean;
  reassign: boolean;
  order: boolean;
  receiveItems: boolean;
  receive: boolean;
  cancel: boolean;
  comment: boolean;
}

export interface MaterialRequestFullDetail extends MaterialRequestSummary {
  worksheetHref: string;
  events: MaterialRequestEventEntry[];
  comments: MaterialRequestCommentEntry[];
  actions: MaterialRequestActions;
}

export interface MaterialRequestHandlerOption {
  id: string;
  displayName: string;
}

/** Named, so `mobile-request-body.spec.ts` pairs it with the server DTO. */
export interface MaterialRequestReceiveItemsInput {
  items: {
    itemId: string;
    receivedQuantity?: string;
    arrived?: boolean;
  }[];
}

export interface MaterialRequestReassignInput {
  handlerId: string;
}

export interface MaterialRequestCommentInput {
  body: string;
}
