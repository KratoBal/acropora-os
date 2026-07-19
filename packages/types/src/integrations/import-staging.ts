export const IMPORT_ISSUE_SEVERITIES = ["INFO", "WARNING", "ERROR"] as const;
export type ImportIssueSeverity = (typeof IMPORT_ISSUE_SEVERITIES)[number];

export interface ImportIssue {
  severity: ImportIssueSeverity;
  code: string;
  message: string;
  field?: string;
}

export interface ImportRowResult<TRow> {
  sourceRowNumber: number;
  row: TRow;
  issues: ImportIssue[];
  transformedEntityIds: Record<string, string>;
  status: "VALID" | "INVALID";
}
