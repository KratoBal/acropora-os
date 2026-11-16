"use client";

import { Alert, PilotBadge, PilotPageHeader } from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import {
  manufacturerClaimApi,
  type ManufacturerClaimView,
} from "@/lib/api/manufacturer-claims";

import {
  CLAIM_STATUS_TEXT,
  CLAIM_TYPE_TEXT,
  claimReasonText,
  OUTPUT_MODE_TEXT,
} from "./product-manufacturer-claims-card";

/**
 * THE REVIEW QUEUE OF THE MANUFACTURER CLAIMS (T5.3, spec point 4, "Ellenőrzésre vár"): by default
 * the unchecked claims, dosing and safety first (the API's order), each with a link to its product,
 * where the check is done next to the source. The whole list is one switch away.
 */
export function ManufacturerClaimQueuePage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CONTENT_VIEW),
  );
  const [claims, setClaims] = useState<ManufacturerClaimView[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [onlyWaiting, setOnlyWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setClaims(null);
    manufacturerClaimApi
      .list(token, onlyWaiting ? { status: "UNVERIFIED" } : {})
      .then((result) => {
        if (!active) return;
        setClaims(result.items);
        setTruncated(result.truncated);
      })
      .catch(
        (cause: unknown) =>
          active &&
          setError(
            cause instanceof Error
              ? cause.message
              : "A gyártói állítások nem tölthetők be.",
          ),
      );
    return () => {
      active = false;
    };
    // `token` is read, not watched: the session object changes identity
  }, [canView, onlyWaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a tartalmakhoz"
        description="A megnyitáshoz content.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Termékek"
        title="Gyártói állítások"
        description="Mit állítanak a gyártók a termékekről, és ki ellenőrizte; az adagolás és a biztonság elöl"
      />
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      <label className="flex items-center gap-2 text-sm text-dusk-700">
        <input
          type="checkbox"
          checked={onlyWaiting}
          onChange={(event) => setOnlyWaiting(event.target.checked)}
        />
        Csak az ellenőrzésre várók
      </label>
      {truncated ? (
        <Alert
          variant="info"
          title="A lista nem teljes"
          description="Az első 500 állítás látszik (az adagolás és a biztonság elöl). Szűkíts termékre a termék oldalán."
        />
      ) : null}
      {!claims ? (
        <p className="text-sm text-pilot-grey-500">Betöltés…</p>
      ) : claims.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          {onlyWaiting
            ? "Nincs ellenőrzésre váró állítás."
            : "Még nincs gyártói állítás."}
        </p>
      ) : (
        <ul className="space-y-2">
          {claims.map((claim) => (
            <li
              key={claim.id}
              data-testid={`claim-queue-${claim.id}`}
              className="rounded-lg border border-dusk-100 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/products/${encodeURIComponent(claim.productId)}`}
                  className="font-medium text-brand-600 underline"
                >
                  {claim.productName}
                </Link>
                <span className="flex flex-wrap gap-1">
                  <PilotBadge variant="grey">
                    {CLAIM_TYPE_TEXT[claim.claimType]}
                  </PilotBadge>
                  <PilotBadge variant="amber">
                    {CLAIM_STATUS_TEXT[claim.status]}
                  </PilotBadge>
                </span>
              </div>
              <p className="text-dusk-800">„{claim.claimText}”</p>
              <p className="text-xs text-dusk-500">
                {OUTPUT_MODE_TEXT[claim.output.mode]} · rögzítette{" "}
                {claim.recordedBy?.name ?? "?"}
              </p>
              {claim.output.reasons.length > 0 ? (
                <p className="text-xs text-amber-700">
                  {claim.output.reasons.map(claimReasonText).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PilotThemeRoot>
  );
}
