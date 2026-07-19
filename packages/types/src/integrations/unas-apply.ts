export interface UnasApplySummary {
  batchId: string;
  status: "APPLIED";
  categoriesCreated: number;
  categoriesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  imagesSynchronized: number;
  categoryLinksSynchronized: number;
  relationsSynchronized: number;
  channelListingsSynchronized: number;
  externalReferencesSynchronized: number;
  domainEventsCreated: number;
  unresolvedBrandAssociations: number;
  durationMs?: number;
  appliedAt: string;
  appliedBy: string;
}

export interface UnasApprovalResult {
  batchId: string;
  status: "APPROVED";
  approvedAt: string;
  approvedBy: string;
  reviewedRows: number;
}
