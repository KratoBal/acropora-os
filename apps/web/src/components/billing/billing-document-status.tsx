"use client";

import { PilotBadge } from "@acropora/ui";
import {
  BILLING_DOCUMENT_STATUS_LABELS,
  BILLING_EMAIL_STATUS_LABELS,
  type BillingDocumentStatus as Status,
  type BillingEmailStatus,
} from "@acropora/types";

const STATUS_VARIANT: Record<Status, "grey" | "amber" | "success" | "danger"> =
  {
    DRAFT: "grey",
    ISSUING: "amber",
    ISSUED: "success",
    ISSUE_FAILED: "danger",
  };

/**
 * A BIZONYLAT ÁLLAPOTA ÉS, KÜLÖN SORBAN, A KIKÜLDÉSÉ (brief 4. és 20. pont). A
 * kettő nem keveredik: egy kiállított számla, amelynek a levele elbukott,
 * "Kiállítva" marad, és alatta áll, hogy a kiküldés sikertelen. A kiküldés
 * sora csak akkor látszik, ha van mondanivalója (küldés alatt, elküldve,
 * sikertelen); a "nem szükséges" és a "kiküldésre vár" a lista zaja lenne.
 */
export function BillingDocumentStatus({
  status,
  emailStatus,
}: {
  status: Status;
  emailStatus: BillingEmailStatus | null;
}) {
  const showEmail =
    emailStatus === "SENDING" ||
    emailStatus === "SENT" ||
    emailStatus === "FAILED";
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <PilotBadge variant={STATUS_VARIANT[status]}>
        {BILLING_DOCUMENT_STATUS_LABELS[status]}
      </PilotBadge>
      {showEmail && emailStatus ? (
        <span
          className={`text-xs ${
            emailStatus === "FAILED"
              ? "font-medium text-pilot-red-700"
              : "text-pilot-blue-700"
          }`}
        >
          {BILLING_EMAIL_STATUS_LABELS[emailStatus]}
        </span>
      ) : null}
    </span>
  );
}
