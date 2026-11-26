import { PilotBadge, partnerStatusBadgeVariant } from "@acropora/ui";
import {
  PARTNER_STATUS_LABELS,
  partnerWorksheetRejectedLabel,
  partnerWorksheetState,
  type WorksheetVersionStatus,
} from "@acropora/types";

/**
 * A MUNKALAP JELVÉNYE A PARTNERNEK (kártya 7f23785c; acrobot 62704): a négy
 * partner-szó a közös állapotból, ahogy a hibajegyen, és az elutasított lap
 * második sora, ahogy a jegyen a Nem teljesült. A lista sora alá írja
 * (`inline` nélkül), az adatlap fejléce mellé (`inline`).
 */
export function PartnerWorksheetStatus({
  status,
  lineCount,
  inline = false,
}: {
  status: WorksheetVersionStatus;
  lineCount: number;
  inline?: boolean;
}) {
  const state = partnerWorksheetState(status, lineCount);
  return (
    <>
      <PilotBadge variant={partnerStatusBadgeVariant(state.status)}>
        {PARTNER_STATUS_LABELS[state.status]}
      </PilotBadge>
      {state.rejected ? (
        inline ? (
          <span className="text-xs text-pilot-grey-600">
            {partnerWorksheetRejectedLabel}
          </span>
        ) : (
          <p className="mt-1 text-xs text-pilot-grey-500">
            {partnerWorksheetRejectedLabel}
          </p>
        )
      ) : null}
    </>
  );
}
