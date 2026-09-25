/**
 * The home page is assembled from independently authorised blocks. Optional
 * keys are intentional: an omitted key means the caller may not see that
 * subject at all, whereas an empty list means that they may see it and there
 * is nothing to report right now.
 */
export interface DashboardSummary {
  myWorksheets?: DashboardMyWorksheets;
  openTickets?: DashboardOpenTickets;
  aquariumAlerts?: DashboardAquariumAlerts;
  managerTiles?: DashboardManagerTiles;
  deadlines?: DashboardDeadlines;
  teamLoad?: DashboardTeamLoad;
  materialRequests?: DashboardMaterialRequests;
  purchasing?: DashboardPurchasing;
  inventoryDiscrepancies?: DashboardInventoryDiscrepancies;
  activity?: DashboardActivity;
  myTaskCount?: number;
  upcomingMaintenance?: DashboardUpcomingMaintenance;
}

export interface DashboardMyWorksheets {
  items: DashboardWorksheet[];
}

export interface DashboardWorksheet {
  id: string;
  number: string | null;
  subject: string;
  status: string;
  deadline: string | null;
}

export interface DashboardOpenTickets {
  count: number;
  items: DashboardTicket[];
}

export interface DashboardTicket {
  id: string;
  number: string;
  title: string;
  status: string;
  createdAt: string;
}

export interface DashboardAquariumAlerts {
  staleAfterDays: number;
  items: DashboardAquariumAlert[];
}

export interface DashboardAquariumAlert {
  aquariumId: string;
  aquariumName: string;
  reason: "OUT_OF_RANGE" | "STALE_MEASUREMENT";
  measuredAt: string | null;
  parameterCode?: string;
}

export interface DashboardManagerTiles {
  openTickets: number;
  worksheetsWaitingForSignature: number;
  materialRequestsWaiting: number;
  maintenanceOrderFormsWaitingForSignature: number;
}

export interface DashboardDeadlines {
  items: DashboardDeadline[];
}

export interface DashboardDeadline {
  kind: "WORKSHEET";
  id: string;
  number: string | null;
  subject: string;
  deadline: string;
}

export interface DashboardTeamLoad {
  items: DashboardAssigneeLoad[];
}

export interface DashboardAssigneeLoad {
  userId: string;
  displayName: string;
  openWorksheetCount: number;
}

export interface DashboardMaterialRequests {
  items: DashboardMaterialRequest[];
}

export interface DashboardMaterialRequest {
  id: string;
  worksheetId: string;
  worksheetNumber: string | null;
  customerName: string;
  submittedAt: string;
}

export interface DashboardPurchasing {
  items: DashboardPurchaseOrder[];
}

export interface DashboardPurchaseOrder {
  id: string;
  orderNumber: string;
  supplierName: string;
  status: string;
  expectedAt: string | null;
}

export interface DashboardInventoryDiscrepancies {
  count: number;
  items: DashboardInventoryDiscrepancy[];
}

export interface DashboardInventoryDiscrepancy {
  variantId: string;
  sku: string;
  warehouseCode: string;
  status: string;
}

export interface DashboardActivity {
  items: DashboardActivityItem[];
}

export interface DashboardActivityItem {
  kind: "TICKET_OPENED" | "WORKSHEET_CLOSED" | "MEASUREMENT_RECORDED";
  subject: string;
  actorName: string | null;
  occurredAt: string;
}

/**
 * "Esedékes karbantartások" a kezdőlapon -- az `Asset.nextServiceAt` mezőből,
 * nem egy külön karbantartás-ütemező táblából (ilyen ma nincs). Balázs
 * kérése (2026-09-25, a webes kezdőlap Figma-igazítása): a szervizesnek
 * lássa, mely eszközök szervize közeleg.
 */
export interface DashboardUpcomingMaintenance {
  items: DashboardUpcomingMaintenanceItem[];
}

export interface DashboardUpcomingMaintenanceItem {
  assetId: string;
  assetName: string;
  customerName: string | null;
  departmentName: string;
  nextServiceAt: string;
}
