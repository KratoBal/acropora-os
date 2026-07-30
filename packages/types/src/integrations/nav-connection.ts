export type NavConnectionVerificationStatus =
  "NEVER" | "SUCCESS" | "FAILED" | "STALE";

export interface NavConnectionCredentialInput {
  technicalUserLogin: string;
  technicalUserPassword: string;
  technicalUserTaxNumber: string;
  technicalUserSignKey: string;
  softwareId: string;
  softwareDevName: string;
  softwareDevContact: string;
  softwareDevTaxNumber: string;
}

export interface NavConnectionView {
  configured: boolean;
  masked: "••••••••" | null;
  modifiedAt: string | null;
  verification: {
    status: NavConnectionVerificationStatus;
    checkedAt: string | null;
    code: string | null;
  };
}
