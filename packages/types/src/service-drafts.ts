export type ServiceDraftStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export interface ServiceDraftItem {
  reporterPersonName?: string | null;
  id: string;
  title: string;
  originalProblem: string;
  reportDate: string;
  createdAt: string;
  status: ServiceDraftStatus;
  proposedDepartmentId: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  acceptedServiceJobId: string | null;
  mail: { originalText: string; subject: string | null; mailbox: string };
  attachments: Array<{
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }>;
  occurrence: number;
  earlier: Array<{
    id: string;
    reportDate: string;
    acceptedServiceJobId: string | null;
    status: ServiceDraftStatus;
  }>;
}
export interface ServiceDraftListResponse {
  items: ServiceDraftItem[];
  nextCursor: string | null;
  locations: Array<{
    id: string;
    parentId: string | null;
    name: string;
    customerId: string;
  }>;
  openedBy: { id: string; name: string } | null;
}
export interface ServiceDraftSyncStatus {
  enabled: boolean;
  switchReason: string;
  configured: boolean;
  mailbox: string;
  query: string;
  intervalMinutes: number;
  description: string;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
}
