"use client";

import { Alert, Badge, PilotPageHeader } from "@acropora/ui";
import { hasPermission, PERMISSIONS } from "@acropora/types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { doseEffectApi, type DoseEffectView } from "@/lib/api/dose-effects";

import { parameterLabel, refusalText } from "./product-dose-effects-card";

/**
 * THE WHOLE PRODUCT DOSE LIST (ReefClub plan v6.1, 6.2; slice 7), for the
 * second colleague: by default only the rows waiting for a check, each with a
 * link to its product, where the check is done. The checking itself is on the
 * product's card, next to the numbers it confirms.
 */
export function DoseEffectListPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const [rows, setRows] = useState<DoseEffectView[] | null>(null);
  const [onlyWaiting, setOnlyWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    doseEffectApi
      .list(token)
      .then((result) => active && setRows(result.items))
      .catch(
        (cause: unknown) =>
          active &&
          setError(
            cause instanceof Error
              ? cause.message
              : "Az adag-hatás lista nem tölthető be.",
          ),
      );
    return () => {
      active = false;
    };
    // `token` is read, not watched: the session object changes identity
  }, [canView]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékekhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );

  const shown = (rows ?? []).filter(
    (row) => !onlyWaiting || row.refusals.includes("NOT_VERIFIED"),
  );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Termékek"
        title="Adag-hatás lista"
        description="Termékenként mennyit változtat egy adagegység 100 liter vízben; két kolléga ellenőrzi"
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
      {!rows ? (
        <p className="text-sm text-pilot-grey-500">Betöltés…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">
          {onlyWaiting
            ? "Nincs ellenőrzésre váró sor."
            : "Még nincs adag-hatás sor."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-dusk-100 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/products/${encodeURIComponent(row.productId)}`}
                  className="font-medium text-brand-600 underline"
                >
                  {row.productName}
                </Link>
                {row.usable ? (
                  <Badge variant="success">Használható</Badge>
                ) : (
                  <Badge variant="warning">Nem használható</Badge>
                )}
              </div>
              <p className="text-dusk-700">
                {parameterLabel(row.parameterCode)}{" "}
                {row.direction === "EMEL" ? "emel" : "csökkent"} · {row.version}
                . változat · rögzítette {row.recordedBy?.name ?? "?"}
              </p>
              {row.refusals.length > 0 ? (
                <p className="text-xs text-amber-700">
                  {row.refusals.map(refusalText).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PilotThemeRoot>
  );
}
